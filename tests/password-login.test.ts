import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assistAmazonPasswordLogin } from "../packages/browser-runtime/password-login.js";

let browser: Browser;
let page: Page;
const signin = "https://www.amazon.com/ap/signin";
const form = (contents: string, action = signin) => `<title>Amazon Sign-In</title><form method="post" action="${action}">${contents}</form>`;
const email = '<input id="ap_email" name="email"><button id="continue">Continue</button>';
const password = '<input type="password" id="ap_password" name="password"><button id="signInSubmit">Sign in</button>';
const secrets = () => ({ username: "fixture@example.com", password: "synthetic-password-only" });

beforeAll(async () => { browser = await chromium.launch({ channel: "chromium", headless: true }); });
afterAll(async () => { await browser?.close(); });
beforeEach(async () => { page = await browser.newPage(); });
afterEach(async () => { await page.context().close(); });

async function show(html: string, url = signin): Promise<void> {
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(url);
}

describe("bounded Amazon password assistance", () => {
  it("follows the signed-out account link and handles Amazon's wrapped submit button", async () => {
    await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body:
      route.request().url().includes("homepage")
        ? `<a id="nav-link-accountList" onclick="location.href='${signin}?return=account'">Hello, sign in</a>`
        : form('<input id="ap_email_login"><span id="continue"><input type="submit"></span>', "https://www.amazon.com/ax/claim"),
    }));
    await page.goto("https://www.amazon.com/gp/css/homepage.html");
    const read = vi.fn(async () => { throw new Error("fixture-only-stop-before-filling"); });
    await expect(assistAmazonPasswordLogin(page, read)).rejects.toThrow("no credential details were logged");
    expect(read).toHaveBeenCalledTimes(1);
    expect(page.url()).toBe(`${signin}?return=account`);
  });

  it("submits an email/password flow once and clears the returned credential object", async () => {
    const submissions: string[] = [];
    await page.route("**/*", async (route) => {
      const data = route.request().postData();
      if (data) submissions.push(data);
      await route.fulfill({ contentType: "text/html", body: !data ? form(email)
        : data.includes("email=") ? form(password) : '<title>Your Account</title><span>Hello, Fixture</span>' });
    });
    await page.goto(signin);
    const credentials = secrets();
    const read = vi.fn().mockResolvedValue(credentials);
    expect(await assistAmazonPasswordLogin(page, read)).toBe("submitted");
    expect(read).toHaveBeenCalledTimes(1);
    expect(submissions).toHaveLength(2);
    expect(submissions[0]).toContain("email=fixture%40example.com");
    expect(submissions[1]).toContain("password=synthetic-password-only");
    expect(credentials).toEqual({ username: "", password: "" });
  });

  it("waits through the email-claim redirect before submitting the password", async () => {
    let passwordSubmissions = 0;
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      let body: string;
      if (url.pathname === "/ax/claim") body = '<script>setTimeout(() => location.replace("/ap/signin?step=password"), 100)</script>';
      else if (route.request().postData()?.includes("password=")) {
        passwordSubmissions++;
        body = '<title>Account</title><span id="nav-link-accountList-nav-line-1">Hello, Fixture</span>';
      } else body = url.searchParams.has("step") ? form(password) : form(email, "https://www.amazon.com/ax/claim");
      return route.fulfill({ contentType: "text/html", body });
    });
    await page.goto(signin);
    expect(await assistAmazonPasswordLogin(page, async () => secrets())).toBe("submitted");
    expect(passwordSubmissions).toBe(1);
  });

  it.each([signin, "https://www.amazon.com/ax/claim", "https://evil.test/ap/signin"])("validates the password form rendered directly at email claim: %s", async (action) => {
    let passwordSubmissions = 0;
    await page.route("**/*", (route) => {
      const request = route.request();
      const posted = request.postData();
      if (posted?.includes("password=")) passwordSubmissions++;
      return route.fulfill({ contentType: "text/html", body: posted?.includes("password=")
        ? '<span id="nav-link-accountList-nav-line-1">Hello, Fixture</span>'
        : new URL(request.url()).pathname === "/ax/claim"
          ? form(password, action) : form(email, "https://www.amazon.com/ax/claim") });
    });
    await page.goto(signin);
    expect(await assistAmazonPasswordLogin(page, async () => secrets())).toBe(action === signin ? "submitted" : "manual");
    expect(passwordSubmissions).toBe(action === signin ? 1 : 0);
    if (action !== signin) expect(await page.locator("#ap_password").inputValue()).toBe("");
  });

  it.each(["https://amazon.com.evil.test/ap/signin", "https://www.amazon.com/ap/register"])("does not retrieve credentials at %s", async (url) => {
    await show(form(email), url);
    const read = vi.fn();
    expect(await assistAmazonPasswordLogin(page, read)).toBe("manual");
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["https://evil.test/ap/signin", "http://www.amazon.com/ap/signin"])("rejects unsafe form action %s before requesting credentials", async (action) => {
    await show(form(email, action));
    const read = vi.fn();
    expect(await assistAmazonPasswordLogin(page, read)).toBe("manual");
    expect(read).not.toHaveBeenCalled();
  });

  it("rechecks the form after waiting for the password manager", async () => {
    await show(form(email));
    const credentials = secrets();
    const read = vi.fn(async () => {
      await page.locator("form").evaluate((element) => element.setAttribute("action", "https://evil.test/ap/signin"));
      return credentials;
    });
    expect(await assistAmazonPasswordLogin(page, read)).toBe("manual");
    expect(await page.locator("#ap_email").inputValue()).toBe("");
    expect(credentials.password).toBe("");
  });

  it.each([
    `${email}<input id="captchacharacters">`,
    `${email}<input name="otpCode">`,
    password,
  ])("leaves challenges and an unverified password-only account to the user", async (contents) => {
    await show(form(contents));
    const read = vi.fn();
    expect(await assistAmazonPasswordLogin(page, read)).toBe("manual");
    expect(read).not.toHaveBeenCalled();
  });

  it("stops after the email step when Amazon asks for MFA", async () => {
    let posts = 0;
    await page.route("**/*", (route) => {
      if (route.request().method() === "POST") posts++;
      return route.fulfill({ contentType: "text/html", body: posts ? '<input name="otpCode">' : form(email) });
    });
    await page.goto(signin);
    expect(await assistAmazonPasswordLogin(page, async () => secrets())).toBe("manual");
    expect(posts).toBe(1);
  });

  it("redacts errors that could include filled credentials", async () => {
    await show(form(email));
    await expect(assistAmazonPasswordLogin(page, async () => { throw new Error("private-credential"); }))
      .rejects.toThrow("no credential details were logged");
  });
});

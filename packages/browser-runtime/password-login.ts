import type { Locator, Page } from "playwright";
import type { LoginCredentials } from "../core/onepassword.js";
import { OnePasswordError } from "../core/onepassword.js";

export type PasswordLoginResult = "submitted" | "manual";
const CONTINUE = '#continue:is(input,button), #continue input[type="submit"], #continue button[type="submit"]';
const SIGN_IN = '#signInSubmit:is(input,button), #signInSubmit input[type="submit"], #signInSubmit button[type="submit"]';

function isAmazonSignIn(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password &&
      ["https://amazon.com", "https://www.amazon.com"].includes(url.origin) &&
      /^\/ap\/signin(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}

function isAmazonEmailClaim(raw: string): boolean {
  try {
    const url = new URL(raw);
    return ["https://amazon.com", "https://www.amazon.com"].includes(url.origin) &&
      !url.username && !url.password && url.pathname === "/ax/claim";
  } catch { return false; }
}

function isAmazonPasswordPage(raw: string): boolean {
  return isAmazonSignIn(raw) || isAmazonEmailClaim(raw);
}

async function needsHuman(page: Page): Promise<boolean> {
  return /captcha|robot check/i.test(await page.title()) ||
    await page.locator('#captchacharacters:visible, input[name="otpCode"]:visible, input[name="code"]:visible').count() > 0;
}

async function trustedForm(page: Page, field: Locator, submitSelector: string, allowEmailClaim = false): Promise<boolean> {
  if (!isAmazonPasswordPage(page.url()) || await page.locator(submitSelector).count() !== 1) return false;
  const action = await field.evaluate((element, selector) => {
    const input = element as HTMLInputElement;
    const submit = document.querySelector(selector) as HTMLInputElement | HTMLButtonElement | null;
    const form = input.form;
    if (!form || !submit || submit.form !== form || (submit.getAttribute("formmethod") ?? form.method).toLowerCase() !== "post") return "";
    return submit.hasAttribute("formaction") ? submit.formAction : form.action;
  }, submitSelector);
  let trustedAction = isAmazonSignIn(action);
  if (allowEmailClaim) trustedAction ||= isAmazonEmailClaim(action);
  return trustedAction && await page.locator(submitSelector).isVisible();
}

// One bounded credential attempt; failures, MFA, passkeys and unknown layouts
// stay in the visible handoff. Never log Playwright exceptions (fill call logs
// can contain the supplied value), URLs, DOM, screenshots or traces here.
export async function assistAmazonPasswordLogin(
  page: Page,
  readCredentials: () => Promise<LoginCredentials>,
): Promise<PasswordLoginResult> {
  let credentials: LoginCredentials | undefined;
  try {
    // Amazon can show the account landing page while signed out. Follow its
    // own sign-in link so the return destination and OpenID parameters survive.
    const current = new URL(page.url());
    if (["https://amazon.com", "https://www.amazon.com"].includes(current.origin) &&
        current.pathname === "/gp/css/homepage.html") {
      const link = page.locator("#nav-link-accountList");
      await link.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
      if (await link.count() === 1 && await link.isVisible() && /sign\s*in/i.test(await link.innerText())) {
        const href = await link.getAttribute("href");
        const destination = href ? new URL(href, current).href : "";
        // The current Amazon navigation link is wired by JavaScript and may
        // have no href yet. The next page is revalidated before any secret read.
        if (!href || isAmazonSignIn(destination)) {
          await link.click({ timeout: 15_000 });
          await page.waitForURL((url) => isAmazonSignIn(url.href), { waitUntil: "domcontentloaded", timeout: 15_000 });
        }
      }
    }
    if (!isAmazonSignIn(page.url()) || await needsHuman(page)) return "manual";
    await page.locator("#ap_email:visible, #ap_email_login:visible, #ap_password:visible").first()
      .waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    const email = page.locator("#ap_email:visible, #ap_email_login:visible");
    const password = page.locator("#ap_password:visible");
    if (await email.count() === 1) {
      const hasPassword = await password.count() === 1;
      const submit = hasPassword ? SIGN_IN : CONTINUE;
      if (!await trustedForm(page, email, submit, !hasPassword)) return "manual";
      credentials = await readCredentials();
      // Unlocking 1Password may take time: revalidate the page before filling.
      if (await needsHuman(page) || !await trustedForm(page, email, submit, !hasPassword)) return "manual";
      await email.fill(credentials.username, { timeout: 10_000 });
      if (!hasPassword) {
        if (!await trustedForm(page, email, submit, true)) return "manual";
        await page.locator(submit).click({ timeout: 15_000 });
        // Stop on an unexpected next screen instead of repeatedly submitting.
        await page.waitForFunction(() => {
          const visible = (selector: string) => Array.from(document.querySelectorAll(selector))
            .some((element) => (element as HTMLElement).offsetHeight > 0);
          // /ax/claim can render the password form or redirect to sign-in.
          // Wait for a visible next step instead of stopping on that URL.
          return visible('#ap_password, #captchacharacters, input[name="otpCode"], input[name="code"], #auth-error-message-box') ||
            /^\/ap\/(?:mfa|cvf)(?:\/|$)/.test(location.pathname) ||
            visible('#nav-link-accountList-nav-line-1');
        }, undefined, { timeout: 15_000 }).catch(() => undefined);
      }
    }
    if (!isAmazonPasswordPage(page.url()) || await needsHuman(page) || await password.count() !== 1 ||
        !await trustedForm(page, password, SIGN_IN)) return "manual";
    // A password-only screen may belong to another account. Do not fill it
    // unless this attempt supplied the username itself.
    if (!credentials) return "manual";
    if (await needsHuman(page) || !await trustedForm(page, password, SIGN_IN)) return "manual";
    await password.fill(credentials.password, { timeout: 10_000 });
    if (!await trustedForm(page, password, SIGN_IN)) return "manual";
    await page.locator(SIGN_IN).click({ timeout: 15_000 });
    await password.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
    return "submitted";
  } catch (error) {
    if (error instanceof OnePasswordError) throw error;
    throw new Error("Amazon login assistance stopped. Continue in the visible browser; no credential details were logged.");
  } finally {
    if (credentials) { credentials.username = ""; credentials.password = ""; }
  }
}

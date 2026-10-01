import { describe, expect, it, vi } from "vitest";
import { readAmazonLogin } from "../packages/core/onepassword.js";

const login = {
  id: "a".repeat(26), title: "Amazon", vault: { id: "v".repeat(26) },
  urls: [{ href: "https://www.amazon.com/" }],
};
const fields = [
  { label: "username", value: "fixture@example.com" },
  { label: "password", value: "synthetic-password-only" },
];

describe("1Password Amazon credentials", () => {
  it("resolves a unique Amazon Login and requests only its credential fields", async () => {
    const run = vi.fn().mockResolvedValueOnce(JSON.stringify([login])).mockResolvedValueOnce(JSON.stringify(fields));
    expect(await readAmazonLogin({}, run)).toEqual({ username: fields[0]!.value, password: fields[1]!.value });
    expect(run.mock.calls[1]![0]).toEqual([
      "item", "get", login.id, "--vault", login.vault.id,
      "--fields", "label=username,label=password", "--format", "json", "--reveal",
    ]);
    expect(JSON.stringify(run.mock.calls)).not.toContain(fields[1]!.value);
  });

  it("requires explicit selection when more than one Amazon account matches", async () => {
    const run = vi.fn().mockResolvedValue(JSON.stringify([login, { ...login, id: "b".repeat(26) }]));
    await expect(readAmazonLogin({}, run)).rejects.toThrow("Multiple Amazon logins");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("honors an exact selected ID and vault", async () => {
    const run = vi.fn().mockResolvedValueOnce(JSON.stringify([login, { ...login, id: "b".repeat(26) }])).mockResolvedValueOnce(JSON.stringify(fields));
    await readAmazonLogin({ item: login.id, vault: "Personal" }, run);
    expect(run.mock.calls[0]![0]).toContain("Personal");
    expect(run.mock.calls[1]![0][2]).toBe(login.id);
  });

  it("reads renamed built-in fields by stable ID instead of their display labels", async () => {
    const run = vi.fn().mockResolvedValueOnce(JSON.stringify([login])).mockResolvedValueOnce(JSON.stringify([
      { id: "username", purpose: "USERNAME", label: "email", value: "fixture@example.com" },
      { id: "password", purpose: "PASSWORD", label: "passwordNew", value: "synthetic-password-only" },
    ]));
    expect(await readAmazonLogin({}, run)).toEqual({ username: "fixture@example.com", password: "synthetic-password-only" });
  });

  it.each(["https://amazon.com.evil.test", "https://evilamazon.com", "http://www.amazon.com", "https://aws.amazon.com"])("rejects a wrong website %s before retrieving secrets", async (href) => {
    const run = vi.fn().mockResolvedValue(JSON.stringify([{ ...login, urls: [{ href }] }]));
    await expect(readAmazonLogin({ item: login.id }, run)).rejects.toThrow("No matching Amazon login");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "invalid_json", "missing_password"])("redacts %s failures", async (scenario) => {
    const run = vi.fn().mockResolvedValueOnce(JSON.stringify([login]));
    if (scenario === "error") run.mockRejectedValueOnce(new Error("private-password-from-stderr"));
    else run.mockResolvedValueOnce(scenario === "invalid_json" ? "private-password-invalid-json" : JSON.stringify([fields[0]]));
    await expect(readAmazonLogin({}, run)).rejects.toThrow("No credential details were logged");
  });
});

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { DomainError } from "../contracts/index.js";
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
    )
    .join(",")}}`;
}
export const digest = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function secureEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export class Vault {
  private readonly key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, "base64");
    if (this.key.length !== 32)
      throw new Error(
        "DATA_ENCRYPTION_KEY must encode exactly 32 random bytes",
      );
  }
  seal(value: unknown, owner: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(owner));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((b) => b.toString("base64"))
      .join(".");
  }
  open<T>(value: string, owner: string): T {
    try {
      const [iv, tag, body] = value
        .split(".")
        .map((v) => Buffer.from(v, "base64"));
      if (!iv || !tag || !body) throw new Error("bad ciphertext");
      const cipher = createDecipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(Buffer.from(owner));
      cipher.setAuthTag(tag);
      return JSON.parse(
        Buffer.concat([cipher.update(body), cipher.final()]).toString(),
      ) as T;
    } catch {
      throw new DomainError(
        "PRIVATE_DATA_UNAVAILABLE",
        "Encrypted data could not be opened",
        500,
      );
    }
  }
}

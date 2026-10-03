import { DomainError } from "../contracts/index.js";

const hosts = new Set([
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
  "images-eu.ssl-images-amazon.com",
  "images-fe.ssl-images-amazon.com",
]);
export function imageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError(
      "INVALID_IMAGE",
      "Expected an observed Amazon product image",
      400,
    );
  }
  if (
    url.protocol !== "https:" ||
    !hosts.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/images/I/") ||
    url.search ||
    url.hash
  )
    throw new DomainError(
      "INVALID_IMAGE",
      "Only observed product images on approved Amazon image hosts are supported",
      400,
    );
  return url;
}
export async function fetchProductImage(
  value: string,
  fetcher: typeof fetch = fetch,
) {
  const url = imageUrl(value);
  const response = await fetcher(url, {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "image/jpeg,image/png,image/webp" },
  });
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
  const limit = 4 * 1024 * 1024;
  if (
    !response.ok ||
    !response.body ||
    !["image/jpeg", "image/png", "image/webp"].includes(mimeType ?? "") ||
    Number(response.headers.get("content-length")) > limit
  ) {
    await response.body?.cancel();
    throw new DomainError(
      "IMAGE_UNAVAILABLE",
      "Image format or size is unsupported",
      400,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new DomainError("IMAGE_TOO_LARGE", "Image exceeds 4 MiB", 400);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const valid =
    mimeType === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mimeType === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid)
    throw new DomainError(
      "INVALID_IMAGE",
      "Image bytes do not match the declared format",
      400,
    );
  return {
    type: "image" as const,
    mimeType: mimeType!,
    data: bytes.toString("base64"),
  };
}

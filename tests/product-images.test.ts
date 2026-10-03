import { describe, expect, it, vi } from "vitest";
import {
  fetchProductImage,
  imageUrl,
} from "../packages/core/product-images.js";
const url = "https://m.media-amazon.com/images/I/fixture.png";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  "base64",
);
describe("bounded product image display", () => {
  it.each([
    "http://m.media-amazon.com/images/I/a.png",
    "https://evil.test/a.png",
    "https://m.media-amazon.com.evil.test/images/I/a.png",
    "https://user:pass@m.media-amazon.com/images/I/a.png",
    "https://127.0.0.1/images/I/a.png",
    "https://m.media-amazon.com/images/I/a.png?token=private",
    "https://m.media-amazon.com/other/a.png",
  ])("rejects an unsafe image source %s", (url) =>
    expect(() => imageUrl(url)).toThrow(),
  );
  it("returns native MCP image bytes with redirects and credentials disabled", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(png, { headers: { "content-type": "image/png" } }),
      );
    expect(await fetchProductImage(url, fetcher)).toEqual({
      type: "image",
      mimeType: "image/png",
      data: png.toString("base64"),
    });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
  });
  it("rejects spoofed MIME, excessive sizes and unsupported SVG", async () => {
    for (const response of [
      new Response("private page", {
        headers: { "content-type": "image/png" },
      }),
      new Response(png, {
        headers: { "content-type": "image/png", "content-length": "9000000" },
      }),
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
      new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
        headers: { "content-type": "image/png" },
      }),
    ]) {
      await expect(
        fetchProductImage(
          url,
          vi.fn<typeof fetch>().mockResolvedValue(response),
        ),
      ).rejects.toThrow();
    }
  });
});

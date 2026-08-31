// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { resolveFarmImageConfig } from "../image-config";
import {
  createCloudflareImageTransformer,
  createFarmImageHandler,
  isPrivateImageAddress,
  selectOutputFormat,
  type FarmImageTransformer,
} from "../image-server";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR42mNk+M/wHwAF/gL+X5WvWQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function optimizerUrl(source: string, width = 640, quality = 75): string {
  const query = new URLSearchParams({ url: source, w: String(width), q: String(quality) });
  return `https://app.example.test/_farm/image?${query}`;
}

function passthroughTransformer(spy = vi.fn()): FarmImageTransformer {
  return async (input) => {
    spy(input);
    return { body: input.source, contentType: input.sourceType };
  };
}

describe("Farm image optimizer", () => {
  it("optimizes allowed local images and serves cache validators", async () => {
    const transform = vi.fn();
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("cookie")).toBe(false);
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response(PNG, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(PNG.length) },
      });
    });
    const handler = createFarmImageHandler(resolveFarmImageConfig(undefined), {
      fetch: fetcher as typeof fetch,
      transform: passthroughTransformer(transform),
    });

    const response = await handler(
      new Request(optimizerUrl("/assets/product.png"), {
        headers: { accept: "image/webp", cookie: "session=secret" },
      }),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/png");
    expect(response?.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=60",
    );
    expect(response?.headers.get("vary")).toBe("Accept");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response?.arrayBuffer())?.byteLength).toBe(PNG.length);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledWith(
      expect.objectContaining({ width: 640, quality: 75, sourceType: "image/png" }),
    );

    const etag = response?.headers.get("etag");
    const cached = await handler(
      new Request(optimizerUrl("/assets/product.png"), {
        headers: { accept: "image/webp", "if-none-match": etag! },
      }),
    );
    expect(cached?.status).toBe(304);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("handles HEAD without returning image bytes", async () => {
    const handler = createFarmImageHandler(resolveFarmImageConfig(undefined), {
      fetch: vi.fn(async () => new Response(PNG)) as typeof fetch,
      transform: passthroughTransformer(),
    });

    const response = await handler(new Request(optimizerUrl("/photo.png"), { method: "HEAD" }));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-length")).toBe(String(PNG.length));
    expect((await response?.arrayBuffer())?.byteLength).toBe(0);
  });

  it("ignores requests outside the configured endpoint", async () => {
    const handler = createFarmImageHandler(resolveFarmImageConfig(undefined), {
      fetch: vi.fn() as typeof fetch,
      transform: passthroughTransformer(),
    });

    await expect(handler(new Request("https://app.example.test/products"))).resolves.toBeNull();
  });

  it("rejects methods, widths, qualities, and disallowed local paths", async () => {
    const handler = createFarmImageHandler(
      resolveFarmImageConfig({ localPatterns: [{ pathname: "/media/**" }] }),
      {
        fetch: vi.fn() as typeof fetch,
        transform: passthroughTransformer(),
      },
    );

    const post = await handler(new Request(optimizerUrl("/media/photo.png"), { method: "POST" }));
    const width = await handler(new Request(optimizerUrl("/media/photo.png", 641)));
    const quality = await handler(new Request(optimizerUrl("/media/photo.png", 640, 90)));
    const localPath = await handler(new Request(optimizerUrl("/private/photo.png")));
    const recursive = await handler(new Request(optimizerUrl("/_farm/image")));

    expect(post?.status).toBe(405);
    expect(post?.headers.get("allow")).toBe("GET, HEAD");
    expect(width?.status).toBe(400);
    expect(quality?.status).toBe(400);
    expect(localPath?.status).toBe(400);
    expect(recursive?.status).toBe(400);
  });

  it("requires remote allowlists and blocks literal private addresses", async () => {
    const noRemoteHandler = createFarmImageHandler(resolveFarmImageConfig(undefined), {
      fetch: vi.fn() as typeof fetch,
      transform: passthroughTransformer(),
    });
    const privateHandler = createFarmImageHandler(
      resolveFarmImageConfig({
        remotePatterns: [{ protocol: "http", hostname: "127.0.0.1", pathname: "/**" }],
      }),
      { fetch: vi.fn() as typeof fetch, transform: passthroughTransformer() },
    );

    const unconfigured = await noRemoteHandler(
      new Request(optimizerUrl("https://images.example.test/photo.png")),
    );
    const privateAddress = await privateHandler(
      new Request(optimizerUrl("http://127.0.0.1/admin.png")),
    );

    expect(unconfigured?.status).toBe(400);
    expect(privateAddress?.status).toBe(400);
  });

  it("revalidates every remote redirect", async () => {
    const validateRemoteUrl = vi.fn(async (url: URL) => {
      if (url.hostname === "private.example.test") throw new Error("private DNS target");
    });
    const fetcher = vi.fn(async () =>
      Response.redirect("https://private.example.test/internal.png", 302),
    );
    const handler = createFarmImageHandler(
      resolveFarmImageConfig({
        remotePatterns: [{ protocol: "https", hostname: "**.example.test", pathname: "/**" }],
      }),
      {
        fetch: fetcher as typeof fetch,
        transform: passthroughTransformer(),
        validateRemoteUrl,
      },
    );

    const response = await handler(
      new Request(optimizerUrl("https://images.example.test/photo.png")),
    );

    expect(response?.status).toBe(500);
    expect(validateRemoteUrl).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("transforms the final validated redirect destination", async () => {
    const validateRemoteUrl = vi.fn();
    const transform = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.redirect("https://cdn.example.test/final.png", 302))
      .mockResolvedValueOnce(new Response(PNG, { headers: { "content-type": "image/png" } }));
    const handler = createFarmImageHandler(
      resolveFarmImageConfig({
        remotePatterns: [{ protocol: "https", hostname: "**.example.test", pathname: "/**" }],
      }),
      {
        fetch: fetcher as typeof fetch,
        transform: passthroughTransformer(transform),
        validateRemoteUrl,
      },
    );

    const response = await handler(
      new Request(optimizerUrl("https://images.example.test/photo.png")),
    );

    expect(response?.status).toBe(200);
    expect(validateRemoteUrl).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(transform).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: new URL("https://cdn.example.test/final.png") }),
    );
  });

  it("caps streamed bodies and rejects SVG content by signature", async () => {
    const oversizedHandler = createFarmImageHandler(
      resolveFarmImageConfig({ maximumResponseBody: 16 }),
      {
        fetch: vi.fn(async () => new Response(new Uint8Array(17))) as typeof fetch,
        transform: passthroughTransformer(),
      },
    );
    const svgHandler = createFarmImageHandler(resolveFarmImageConfig(undefined), {
      fetch: vi.fn(
        async () =>
          new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
            headers: { "content-type": "image/png" },
          }),
      ) as typeof fetch,
      transform: passthroughTransformer(),
    });

    const oversized = await oversizedHandler(new Request(optimizerUrl("/large.png")));
    const svg = await svgHandler(new Request(optimizerUrl("/forged.png")));

    expect(oversized?.status).toBe(413);
    expect(svg?.status).toBe(415);
  });

  it("returns a sanitized cancellation response", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("stop", "AbortError"));
    const handler = createFarmImageHandler(resolveFarmImageConfig(undefined), {
      fetch: vi.fn() as typeof fetch,
      transform: passthroughTransformer(),
    });

    const response = await handler(
      new Request(optimizerUrl("/photo.png"), { signal: controller.signal }),
    );

    expect(response?.status).toBe(499);
    await expect(response?.text()).resolves.toBe("Image request cancelled");
  });
});

describe("image runtime adapters", () => {
  it("honors Accept quality values when selecting an output format", () => {
    const formats = ["image/avif", "image/webp"] as const;

    expect(selectOutputFormat("image/avif;q=0, image/webp;q=0.8", formats)).toBe("image/webp");
    expect(selectOutputFormat("image/avif;q=0.5, image/webp;q=1", formats)).toBe("image/webp");
    expect(selectOutputFormat("IMAGE/AVIF;Q=0.8, image/webp;q=0.8", formats)).toBe("image/avif");
    expect(selectOutputFormat("image/*,*/*;q=0.8", formats)).toBeUndefined();
  });

  it("uses Cloudflare's native image transform options", async () => {
    const fetcher = vi.fn(
      async () => new Response(PNG, { headers: { "content-type": "image/webp" } }),
    );
    const transform = createCloudflareImageTransformer(fetcher as typeof fetch);

    const result = await transform({
      source: PNG,
      sourceUrl: new URL("https://images.example.test/photo.png"),
      sourceType: "image/png",
      width: 828,
      quality: 75,
      accept: "image/avif,image/webp",
      formats: ["image/avif", "image/webp"],
      signal: new AbortController().signal,
    });

    expect(result.contentType).toBe("image/webp");
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://images.example.test/photo.png"),
      expect.objectContaining({
        cf: {
          image: { fit: "scale-down", width: 828, quality: 75, format: "avif" },
        },
      }),
    );
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("recognizes private address %s", (address) => {
    expect(isPrivateImageAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isPrivateImageAddress(address)).toBe(false);
  });
});

// @vitest-environment node
import { brotliCompress, brotliDecompressSync, gunzipSync, gzip } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compressFarmResponse } from "../plugins/compression";

vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return { ...actual, brotliCompress: vi.fn(actual.brotliCompress), gzip: vi.fn(actual.gzip) };
});

const text = "<p>cached shell</p>".repeat(256);
function serve(shell: { html: string }, encoding = "br", body = shell.html, policy = "public") {
  const request = new Request("https://farm.test/docs", {
    headers: { "accept-encoding": encoding },
  });
  const response = new Response(null, {
    headers: { "content-type": "text/html", "cache-control": policy },
  });
  return compressFarmResponse(request, response, body, true, shell);
}

describe("compression of a stored PPR shell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("compresses concurrent hits once per shell and encoding, with fresh headers and bytes", async () => {
    const shell = { html: text };
    const first = serve(shell);
    const second = serve(shell, "br", text, "private, no-store");
    const gz = serve(shell, "gzip");
    const chunk = await first.body!.getReader().read();
    expect(brotliDecompressSync(chunk.value!).toString()).toBe(text);
    chunk.value!.fill(0);
    expect(brotliDecompressSync(Buffer.from(await second.arrayBuffer())).toString()).toBe(text);
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(text);
    expect(gunzipSync(Buffer.from(await serve(shell, "gzip").arrayBuffer())).toString()).toBe(text);
    expect(first.headers.get("cache-control")).toBe("public");
    expect(second.headers.get("cache-control")).toBe("private, no-store");
    expect(second.headers.get("vary")).toBe("Accept-Encoding");
    expect(brotliCompress).toHaveBeenCalledTimes(1);
    expect(gzip).toHaveBeenCalledTimes(1);
  });

  it("retries a failed encoding and keeps a cancelled reader from cancelling another hit", async () => {
    const shell = { html: text };
    vi.mocked(brotliCompress).mockImplementationOnce(() => {
      throw new Error("encoding failed");
    });
    await expect(serve(shell).arrayBuffer()).rejects.toThrow("encoding failed");
    const cancelled = serve(shell);
    const active = serve(shell);
    await cancelled.body!.cancel();
    expect(brotliDecompressSync(Buffer.from(await active.arrayBuffer())).toString()).toBe(text);
    expect(brotliCompress).toHaveBeenCalledTimes(2);
  });

  it("recompresses replacement shells and bypasses reuse for changed response bodies", async () => {
    const shell = { html: text };
    const replacement = { html: text + "new" };
    const decode = async (response: Response) =>
      brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString();
    expect(await decode(serve(shell))).toBe(text);
    expect(await decode(serve(replacement))).toBe(replacement.html);
    expect(await decode(serve(shell, "br", "rewritten"))).toBe("rewritten");
    expect(await decode(serve(shell))).toBe(text);
    expect(brotliCompress).toHaveBeenCalledTimes(3);
  });
});

/**
 * Read a request body while enforcing a byte ceiling.
 *
 * `await request.text()` buffers the whole body before any size check can run,
 * so a `Content-Length` header is the only thing standing between an
 * unauthenticated caller and unbounded memory use — and that header is absent
 * for chunked uploads and can simply understate the real body. Reading through
 * the stream lets the limit be enforced as bytes arrive.
 */
export async function readTextWithLimit(
  request: Request,
  limit: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > limit) return { ok: false };
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

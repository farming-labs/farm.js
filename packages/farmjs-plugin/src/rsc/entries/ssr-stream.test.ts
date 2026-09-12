import { expect, it, vi } from "vitest";
import { generateSsrEntry } from "./ssr.js";

const entry = generateSsrEntry({
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
  deploymentId: "test",
  debug: false,
});
// Execute the emitted implementation, not a second copy of the algorithm.
const start = entry.indexOf("function injectBeforeStream(");
const end = entry.indexOf("/** Collect Node stream", start);
const inject = new Function(`${entry.slice(start, end)}; return injectBeforeStream;`)() as (
  marker: string,
  tag: string,
) => TransformStream<Uint8Array | string, Uint8Array>;
const encoder = new TextEncoder();

async function run(chunks: Array<Uint8Array | string>, marker: string, tag: string) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Uint8Array(await new Response(source.pipeThrough(inject(marker, tag))).arrayBuffer());
}

it.each(["</head>", "</body></html>"])("preserves every byte split around %s", async (marker) => {
  const input = `🍀<html><head>café 漢字</head><body>🍀 café 漢字</body></html>🍀`;
  const bytes = encoder.encode(input);
  const expected = encoder.encode(input.replace(marker, `<insert>é🍀</insert>${marker}`));
  for (let i = 0; i <= bytes.length; i++) {
    expect(
      await run(
        [bytes.slice(0, i), new Uint8Array(), bytes.slice(i)],
        marker,
        "<insert>é🍀</insert>",
      ),
    ).toEqual(expected);
  }
  expect(
    await run(
      Array.from(bytes, (byte) => new Uint8Array([byte])),
      marker,
      "<insert>é🍀</insert>",
    ),
  ).toEqual(expected);
});

it("preserves bytes when disabled or the marker is absent, including invalid UTF-8", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0xf0, 0x80]);
  expect(await run([bytes], "</head>", "x")).toEqual(bytes);
  expect(await run([bytes], "</head>", "")).toEqual(bytes);
  expect(await run([], "</head>", "x")).toEqual(new Uint8Array());
});

it("injects only once and handles marker-only and string chunks", async () => {
  expect(await run(["</head>", "🍀</head>"], "</head>", "x")).toEqual(
    encoder.encode("x</head>🍀</head>"),
  );
});

it("emits a bounded prefix before EOF and propagates cancellation", async () => {
  const cancel = vi.fn();
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("x".repeat(1024)));
    },
    cancel,
  });
  const reader = source.pipeThrough(inject("</head>", "x")).getReader();
  const first = await reader.read();
  expect(first.value?.length).toBe(1018);
  await reader.cancel("navigation cancelled");
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith("navigation cancelled"));
});

it("uses the same byte-safe injector for streaming and legacy client scripts", () => {
  expect(entry.match(/injectBeforeStream\('<\/body><\/html>', clientScriptTag\)/g)).toHaveLength(2);
  expect(entry).toContain("injectBeforeStream('</head>', tag)");
});

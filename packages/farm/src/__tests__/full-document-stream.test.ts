// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const universalBuildSource = fs.readFileSync(
  path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
  "utf-8",
);

// The production handler's runtime is emitted from a template literal: extract the function and
// un-escape it (\\ -> \, \` -> `, \$ -> $) to run it as the built server does.
function loadFullDocumentStream() {
  const start = universalBuildSource.indexOf("function createFarmFullDocumentStream(");
  const end = universalBuildSource.indexOf("\nfunction stripFarmDocumentWrappers", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = universalBuildSource.slice(start, end).replace(/\\([\\`$])/g, "$1");
  return new Function(
    "_resolveCurrentCspNonce",
    "_runWithFarmCspNonce",
    `${source}\nreturn createFarmFullDocumentStream;`,
  )(
    () => undefined,
    (_nonce: unknown, fn: () => unknown) => fn(),
  ) as (
    stream: ReadableStream<Uint8Array>,
    open: (opening: string) => string,
    close: (rootOpened: boolean) => Promise<string> | string,
    onComplete?: () => void,
  ) => ReadableStream<Uint8Array>;
}

function chunks(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

async function streamed(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const pieces: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return pieces;
    pieces.push(decoder.decode(value));
  }
}

describe("streamed full documents", () => {
  const createFarmFullDocumentStream = loadFullDocumentStream();
  const open = (opening: string) =>
    opening
      .replace("<head>", '<head><link rel="stylesheet" href="/app.css">')
      .replace(/<body([^>]*)>/, '<body$1><div id="root">');

  it("composes the head, streams the body, and keeps late Suspense content inside it", async () => {
    let completed = false;
    const pieces = await streamed(
      createFarmFullDocumentStream(
        chunks(
          '<div style="display:contents"><html><head><title>App</title></head><body class="x"><main>',
          '<h1>Shell</h1><!--$?--><template id="B:0"></template><p>loading</p><!--/$--></main></body></html></div>',
          '<div hidden id="S:0"><p>late</p></div><script>$RC("B:0","S:0")</script>',
        ),
        open,
        (rootOpened) => (rootOpened ? "</div>" : "") + "<script>client</script>",
        () => (completed = true),
      ),
    );
    const html = pieces.join("");
    expect(completed).toBe(true);
    // The head and the shell go out before the late content exists.
    expect(pieces[0]).toContain('<link rel="stylesheet" href="/app.css">');
    expect(pieces[0]).toContain('<body class="x"><div id="root"><main>');
    expect(html.indexOf("<p>loading</p>")).toBeLessThan(html.indexOf("<p>late</p>"));
    expect(html).toMatch(
      /<\/main><div hidden id="S:0"><p>late<\/p><\/div><script>\$RC\("B:0","S:0"\)<\/script><\/div><script>client<\/script><\/body>\n<\/html>$/,
    );
    expect(html.match(/<\/body>/g)).toHaveLength(1);
    expect(html.match(/<\/html>/g)).toHaveLength(1);
  });

  it("does not open #root twice when the layout's body already does", async () => {
    const html = (
      await streamed(
        createFarmFullDocumentStream(
          chunks('<html><head></head><body><div id="root"><p>page</p></div></body></html>'),
          (opening) => opening,
          (rootOpened) => (rootOpened ? "</div>" : "") + "<script>client</script>",
        ),
      )
    ).join("");
    expect(html).toBe(
      '<html><head></head><body><div id="root"><p>page</p></div><script>client</script></body>\n</html>',
    );
  });

  it("waits for the opening <body> across chunks before composing the head", async () => {
    const seen: string[] = [];
    const pieces = await streamed(
      createFarmFullDocumentStream(
        chunks("<html><he", "ad><title>A</title></head><bo", "dy><p>x</p></body></html>"),
        (opening) => {
          seen.push(opening);
          return opening;
        },
        () => "",
      ),
    );
    expect(seen).toEqual(["<html><head><title>A</title></head><body><p>x</p>"]);
    expect(pieces.join("")).toBe(
      "<html><head><title>A</title></head><body><p>x</p></body>\n</html>",
    );
  });
});

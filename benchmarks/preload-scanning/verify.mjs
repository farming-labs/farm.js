// Differential safety check for scanner changes; not a performance measurement.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const file = "packages/farm/src/preload.ts";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const revision = git(
  "rev-parse",
  "--verify",
  "--end-of-options",
  `${process.argv[2] || "74551c17b7d609cc88b3dd8b3b43a050e313f5c8"}^{commit}`,
).trim();
const beforeSource = git("show", `${revision}:${file}`);
const afterSource = readFileSync(new URL(file, new URL("../../", import.meta.url)), "utf8");
const load = (source) =>
  import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`
  );
const before = await load(beforeSource);
const after = await load(afterSource);
const hint = '<link rel="preload" as="image" href="/low.webp">';
const priority = '<LINK REL="alternate\tpreload" AS=image href=/hero.webp fetchpriority=high>';
const font = '<link rel="preload" as="font" href="/body.woff2">';
const fragments = [
  "",
  "<",
  "<<",
  "<!invalid>",
  "<123>",
  "<link",
  '<div title="',
  "preload",
  "İ",
  "Ωé😀",
  "<div>ordinary</div>",
  "<custom:tag data-note='>'>body</custom:tag>",
  hint,
  priority,
  font,
  '<link rel="modulepreload" href="/client.js">',
  `<div title='${hint}'>quoted</div>`,
  `<!-- ${hint} -->`,
  `<!-- ${hint}`,
  `<link-card rel=preload as=image>${hint}</link-card>`,
  ...["script", "style", "template", "textarea", "title", "noscript", "svg"].flatMap((tag) => [
    `<${tag}>${hint}</${tag}>`,
    `<${tag.toUpperCase()} data-x=">">${priority}</${tag.toUpperCase()}>`,
    `<${tag}>${hint}</${tag}x>${font}</${tag}>`,
    `<${tag}/>tail${hint}`,
    // The last token is inert text whose element closes far past the scan bound.
    `<${tag}>preload${" ".repeat(48)}</${tag.toUpperCase()} >tail`,
  ]),
  `<svg/>${hint}<svg>${priority}</svg>${font}`,
  '<link\nrel="alternate\u00a0pReLoAd" as=font href=/space.woff2>',
];
const documents = fragments.flatMap((fragment) => [fragment + hint, hint + fragment + priority]);
// Fixed seed: failures identify a stable document index and configuration.
let seed = 0x5fa12e;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
for (let i = 0; i < 500; i++) {
  let html = "";
  const count = 1 + (next() % 15);
  for (let j = 0; j < count; j++) html += fragments[next() % fragments.length];
  documents.push(html);
}
const headers = [
  "",
  '</header.webp>; rel=preload; as=image, </header.woff2>; rel="preload"; as=font',
  "</hero.webp>; rel=preload; as=image; fetchpriority=high, </api>; rel=preconnect",
];
let comparisons = 0;
for (const [index, html] of documents.entries()) {
  for (const mode of ["enforce", "warn"]) {
    for (const limit of [0, 1, 2]) {
      const config = { mode, maxImages: limit, maxFonts: limit };
      assert.deepEqual(
        after.manageFarmHtmlPreloads(html, config),
        before.manageFarmHtmlPreloads(html, config),
        `HTML document ${index}, ${mode}, budget ${limit}`,
      );
      comparisons++;
      for (const link of headers) {
        assert.deepEqual(
          after.manageFarmDocumentPreloads(html, link, config),
          before.manageFarmDocumentPreloads(html, link, config),
          `document ${index}, ${mode}, budget ${limit}, header ${link}`,
        );
        comparisons++;
      }
    }
  }
}
console.log(
  JSON.stringify(
    {
      baselineRevision: revision,
      node: process.version,
      documents: documents.length,
      comparisons,
      baselineSourceSha256: createHash("sha256").update(beforeSource).digest("hex"),
      candidateSourceSha256: createHash("sha256").update(afterSource).digest("hex"),
      result:
        "identical HTML, Link headers and warnings; equivalence does not establish correctness of pre-existing edge cases",
    },
    null,
    2,
  ),
);

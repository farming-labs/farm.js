// Summarizes one or more scans: the totals the blog post quotes, per category, and one CSV row per
// site. With several runs, each result is the majority answer across them, because a CDN can serve
// a cached variant that ignores Accept on one run and not the next.
// Usage: node report.mjs <scan.json>... [--csv results.csv]
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const csvAt = args.indexOf("--csv");
const csvPath = csvAt === -1 ? undefined : args[csvAt + 1];
const inputs = csvAt === -1 ? args : args.slice(0, csvAt);
if (!inputs.length || (csvAt !== -1 && (!csvPath || csvAt + 2 !== args.length))) {
  console.error("Usage: node report.mjs <scan.json>... [--csv results.csv]");
  process.exit(2);
}

const runs = inputs.map((input) => JSON.parse(readFileSync(input, "utf8")));
const FLAGS = [
  "homeMarkdown",
  "docsMarkdown",
  "docsMdSuffix",
  "llmsTxt",
  "llmsFullTxt",
  "mcp",
  "apiCatalog",
  "blocked",
];
const COLUMNS = {
  homeMarkdown: "home_accept_markdown",
  docsMarkdown: "docs_accept_markdown",
  docsMdSuffix: "docs_md_url",
  llmsTxt: "llms_txt",
  llmsFullTxt: "llms_full_txt",
  mcp: "mcp",
  apiCatalog: "api_catalog",
  blocked: "blocked",
};
// Per site, the first run whose every flag matches the majority, so sizes and flags agree.
const flaps = new Map();
const results = runs[0].results.map((first) => {
  const sites = runs.map((run) => run.results.find((site) => site.name === first.name));
  const majority = Object.fromEntries(
    FLAGS.map((key) => [key, sites.filter((site) => site.summary[key]).length * 2 > sites.length]),
  );
  for (const key of FLAGS) {
    const yes = sites.filter((site) => site.summary[key]).length;
    if (yes && yes < sites.length)
      flaps.set(first.name, [
        ...(flaps.get(first.name) ?? []),
        `${COLUMNS[key]} in ${yes} of ${sites.length} runs`,
      ]);
  }
  return (
    sites.find((site) => FLAGS.every((key) => site.summary[key] === majority[key])) ??
    sites.find((site) => site.summary.docsMarkdown === majority.docsMarkdown) ??
    first
  );
});
const scannedAt = runs.map((run) => run.scannedAt).join(", ");

// Farm.js is the subject of the post, so it is scanned as a control but left out of the totals.
const SUBJECT = "Farm.js";

const exclusion = (site) => {
  if (site.summary.blocked) return `blocked (${site.homeHtml.status}/${site.docsHtml.status})`;
  for (const page of [site.homeHtml, site.docsHtml])
    if (page.status !== 200) return page.error ? `failed (${page.error})` : `HTTP ${page.status}`;
  return "";
};

const valid = results.filter((site) => site.name !== SUBJECT && !exclusion(site));
const either = (site) => site.summary.docsMarkdown || site.summary.docsMdSuffix;
const pct = (n, of) => `${n}/${of} (${Math.round((n / of) * 100)}%)`;
const count = (sites, test) => sites.filter(test).length;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos);
  return sorted[low] + (sorted[Math.ceil(pos)] - sorted[low]) * (pos - low);
};

const lines = [
  `runs ${runs.length}: ${scannedAt}`,
  `results that differ between runs: ${[...flaps].map(([name, keys]) => `${name} (${keys.join(", ")})`).join("; ") || "none"}`,
  `excluded ${results
    .filter((site) => site.name !== SUBJECT && exclusion(site))
    .map((site) => `${site.name}: ${exclusion(site)}`)
    .join("; ")}`,
  `sites counted ${valid.length} (${SUBJECT} scanned but not counted)`,
  "",
  `docs page answers Accept: text/markdown  ${pct(
    count(valid, (s) => s.summary.docsMarkdown),
    valid.length,
  )}`,
  `docs page has a .md URL                  ${pct(
    count(valid, (s) => s.summary.docsMdSuffix),
    valid.length,
  )}`,
  `docs page Markdown by either route       ${pct(count(valid, either), valid.length)}`,
  `docs page HTML only                      ${pct(
    count(valid, (s) => !either(s)),
    valid.length,
  )}`,
  `homepage answers Accept: text/markdown   ${pct(
    count(valid, (s) => s.summary.homeMarkdown),
    valid.length,
  )}`,
  `llms.txt                                 ${pct(
    count(valid, (s) => s.summary.llmsTxt),
    valid.length,
  )}`,
  `llms-full.txt                            ${pct(
    count(valid, (s) => s.summary.llmsFullTxt),
    valid.length,
  )}`,
  `MCP server at /mcp (answers or asks auth) ${pct(
    count(valid, (s) => s.summary.mcp),
    valid.length,
  )}`,
  `api-catalog                              ${pct(
    count(valid, (s) => s.summary.apiCatalog),
    valid.length,
  )}`,
];
const allFour = valid.filter(
  (s) => s.summary.homeMarkdown && s.summary.docsMarkdown && s.summary.llmsTxt && s.summary.mcp,
);
lines.push(
  `home md + docs md + llms.txt + /mcp      ${pct(allFour.length, valid.length)} ${allFour.map((s) => s.name).join(", ")}`,
  "",
);

for (const category of new Set(valid.map((site) => site.category))) {
  const sites = valid.filter((site) => site.category === category);
  lines.push(
    `${category.padEnd(10)} n=${String(sites.length).padStart(3)}  accept ${pct(
      count(sites, (s) => s.summary.docsMarkdown),
      sites.length,
    ).padEnd(12)}  either ${pct(count(sites, either), sites.length).padEnd(12)}  llms ${pct(
      count(sites, (s) => s.summary.llmsTxt),
      sites.length,
    ).padEnd(13)}  mcp ${pct(
      count(sites, (s) => s.summary.mcp),
      sites.length,
    )}`,
  );
}

const htmlAnswers = valid
  .filter((s) => s.docsMarkdown.status === 200 && /html/i.test(s.docsMarkdown.type))
  .sort((a, b) => b.docsMarkdown.bytes - a.docsMarkdown.bytes);
lines.push(
  "",
  `docs pages that answered Accept: text/markdown with HTML: ${htmlAnswers.length}, median ${median(htmlAnswers.map((s) => s.docsMarkdown.bytes))} bytes`,
  ...htmlAnswers
    .slice(0, 12)
    .map(
      (s) =>
        `  ${s.name.padEnd(16)} ${String(s.docsMarkdown.bytes).padStart(8)}  .md URL ${s.summary.docsMdSuffix ? "yes" : "no"}`,
    ),
);

// The same page both ways: the HTML document against the Markdown the site serves for it.
const pairs = valid.filter(either).map((s) => {
  const markdown = s.summary.docsMarkdown ? s.docsMarkdown.bytes : s.docsMdSuffix.bytes;
  return { html: s.docsHtml.bytes, markdown, ratio: s.docsHtml.bytes / markdown };
});
const ratios = pairs.map((p) => p.ratio);
lines.push(
  "",
  `sites serving both: ${pairs.length}, median HTML ${median(pairs.map((p) => p.html))} bytes, median Markdown ${median(pairs.map((p) => p.markdown))} bytes`,
  `per-site HTML/Markdown ratio: median ${median(ratios).toFixed(1)}, p25 ${quantile(ratios, 0.25).toFixed(1)}, p75 ${quantile(ratios, 0.75).toFixed(1)}`,
);
console.log(lines.join("\n"));

if (csvPath) {
  const note = (site) => {
    const notes = [];
    const why = exclusion(site);
    if (site.name === SUBJECT) notes.push("not counted: subject of the post");
    else if (why) notes.push(`not counted: ${why}`);
    const md = site.docsMarkdown;
    if (/markdown/i.test(md.type) && md.status !== 200)
      notes.push(`Markdown answer was HTTP ${md.status}`);
    else if (/markdown/i.test(md.type) && !site.summary.docsMarkdown)
      notes.push(`Markdown answer was ${md.bytes} bytes`);
    for (const origin of Object.values(site.perOrigin))
      if (origin.mcp.needsAuth) notes.push("/mcp asks for auth");
    for (const flap of flaps.get(site.name) ?? []) notes.push(flap);
    return [...new Set(notes)].join("; ");
  };
  const flag = (value) => (value ? 1 : 0);
  const quote = (value) =>
    /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : value;
  const header =
    "category,site,docs_url,docs_html_bytes,docs_accept_markdown,docs_accept_bytes,docs_md_url,home_accept_markdown,llms_txt,llms_full_txt,mcp,api_catalog,note";
  const rows = results.map((s) =>
    [
      s.category,
      s.name,
      s.docs,
      s.docsHtml.bytes,
      flag(s.summary.docsMarkdown),
      s.docsMarkdown.bytes,
      flag(s.summary.docsMdSuffix),
      flag(s.summary.homeMarkdown),
      flag(s.summary.llmsTxt),
      flag(s.summary.llmsFullTxt),
      flag(s.summary.mcp),
      flag(s.summary.apiCatalog),
      note(s),
    ]
      .map(quote)
      .join(","),
  );
  writeFileSync(csvPath, `${[header, ...rows].join("\n")}\n`);
  console.error(`wrote ${csvPath} (${rows.length} sites)`);
}

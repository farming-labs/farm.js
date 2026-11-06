// Payload experiments for RFC 0003 (islands mode), on a real RSC build.
// usage: node payload-lab.mjs <public dir of the RSC build>
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const publicDir = process.argv[2];
const br = (buf, quality = 11) =>
  zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } })
    .length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
const sha = (s) => createHash("sha1").update(s).digest("base64url").slice(0, 16);

// ---------- Flight row parser ----------
function parseRows(buf) {
  const rows = [];
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) break;
    const id = buf.toString("utf8", i, colon);
    let j = colon + 1;
    if (buf[j] === 0x54 /* T */) {
      const comma = buf.indexOf(0x2c, j);
      const len = parseInt(buf.toString("utf8", j + 1, comma), 16);
      rows.push({
        id,
        tag: "T",
        text: buf.toString("utf8", comma + 1, comma + 1 + len),
        bytes: comma + 1 + len - i,
      });
      i = comma + 1 + len;
      continue;
    }
    const nl = buf.indexOf(0x0a, j);
    const end = nl < 0 ? buf.length : nl;
    let tag = "";
    while (/[A-Z]/.test(String.fromCharCode(buf[j])) && buf[j + 1] !== 0x22 && tag.length < 2) {
      tag += String.fromCharCode(buf[j]);
      j++;
      if (buf[j] === 0x5b || buf[j] === 0x7b || buf[j] === 0x22) break;
    }
    const body = buf.toString("utf8", j, end);
    let value;
    try {
      value = JSON.parse(body);
    } catch {
      value = undefined;
    }
    rows.push({ id, tag, body, value, bytes: end + 1 - i });
    i = end + 1;
  }
  return rows;
}

// ---------- collect pages ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".rsc")) out.push(full);
  }
  return out;
}
const payloadFiles = walk(publicDir).sort();
const pages = payloadFiles.map((file) => {
  const buf = readFileSync(file);
  const route =
    "/" +
    path
      .relative(publicDir, file)
      .replace(/\.rsc$/, "")
      .replace(/index$/, "");
  const htmlFile = file
    .replace(/\.rsc$/, "/index.html")
    .replace(/\/index\/index\.html$/, "/index.html");
  let html;
  try {
    html = readFileSync(htmlFile, "utf8");
  } catch {}
  return { route, buf, rows: parseRows(buf), html };
});
console.log(`pages: ${pages.length}`);

// ---------- E1: anatomy, and what islands mode would send ----------
// Client element: ["$", "$L<id>", key, props] whose row is an I row. Its props with element values
// replaced by a slot reference ≈ the island manifest entry.
function isElement(v) {
  return Array.isArray(v) && v[0] === "$" && v.length === 4;
}
function islandProps(props) {
  if (isElement(props)) return { $slot: 1 };
  if (Array.isArray(props)) return props.map(islandProps);
  if (props && typeof props === "object")
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, islandProps(v)]));
  if (typeof props === "string" && /^\$L?[0-9a-f]+(:|$)/.test(props)) return { $ref: 1 };
  return props;
}
function anatomy(page) {
  const imports = new Set(page.rows.filter((r) => r.tag === "I").map((r) => "$L" + r.id));
  const manifest = [];
  const visit = (v) => {
    if (Array.isArray(v)) {
      if (isElement(v) && imports.has(v[1])) manifest.push({ ref: v[1], props: islandProps(v[3]) });
      v.forEach(visit);
    } else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  page.rows.forEach((r) => visit(r.value));
  const manifestJson = JSON.stringify(manifest);
  const byTag = {};
  for (const r of page.rows) byTag[r.tag || "model"] = (byTag[r.tag || "model"] || 0) + r.bytes;
  return { manifest, manifestJson, byTag };
}
{
  const p = pages.find((x) => x.route === "/docs/architecture") || pages[0];
  const a = anatomy(p);
  const htmlNoFlight = p.html
    ? p.html.replace(/<script>\(self\.__FLIGHT_DATA[^<]*<\/script>/g, "")
    : "";
  console.log(`\nE1 anatomy ${p.route}`);
  console.log(
    `  payload ${kb(p.buf.length)} (br ${kb(br(p.buf))}); rows by tag:`,
    Object.fromEntries(Object.entries(a.byTag).map(([k, v]) => [k, kb(v)])),
  );
  console.log(
    `  client elements ${a.manifest.length}; island manifest ${kb(a.manifestJson.length)} (br ${kb(br(Buffer.from(a.manifestJson)))})`,
  );
  if (p.html) {
    const rscDoc = Buffer.from(p.html),
      islandsDoc = Buffer.from(
        htmlNoFlight + `<script type="application/json">${a.manifestJson}</script>`,
      );
    console.log(
      `  document: rsc ${kb(rscDoc.length)} br ${kb(br(rscDoc))}  |  islands (html + manifest) ${kb(islandsDoc.length)} br ${kb(br(islandsDoc))}`,
    );
  }
  // all pages
  let rscBr = 0,
    islBr = 0,
    n = 0;
  for (const page of pages) {
    if (!page.html) continue;
    const m = anatomy(page).manifestJson;
    const noFlight = page.html.replace(/<script>\(self\.__FLIGHT_DATA[^<]*<\/script>/g, "");
    rscBr += br(Buffer.from(page.html), 5);
    islBr += br(Buffer.from(noFlight + m), 5);
    n++;
  }
  console.log(
    `  all ${n} documents, brotli q5 (on-the-fly): rsc ${kb(rscBr / n)} avg vs islands ${kb(islBr / n)} avg (${pct(islBr, rscBr)})`,
  );
}

// ---------- Merkle hashing of the payload graph ----------
// A value's hash replaces row references with the referenced row's hash, so equal subtrees hash
// equal across pages even though row ids differ.
function merkle(page) {
  const byId = new Map(page.rows.map((r) => [r.id, r]));
  const rowHash = new Map();
  const subtrees = []; // { hash, bytes }
  const hashValue = (v, depth = 0) => {
    if (typeof v === "string") {
      const m = /^\$[L@]?([0-9a-f]+)$/.exec(v);
      if (m && byId.has(m[1])) return "→" + hashRow(byId.get(m[1]));
      return v;
    }
    if (Array.isArray(v)) {
      const parts = v.map((x) => hashValue(x, depth + 1));
      const s = "[" + parts.join("|") + "]";
      const h = sha(s);
      if (isElement(v)) subtrees.push({ hash: h, bytes: JSON.stringify(v).length });
      return h;
    }
    if (v && typeof v === "object") {
      const s =
        "{" +
        Object.entries(v)
          .map(([k, x]) => k + ":" + hashValue(x, depth + 1))
          .join("|") +
        "}";
      return sha(s);
    }
    return String(v);
  };
  const hashRow = (r) => {
    if (rowHash.has(r.id)) return rowHash.get(r.id);
    rowHash.set(r.id, "pending");
    const h =
      r.tag === "T" ? sha(r.text) : r.tag === "I" ? sha(r.body) : sha(hashValue(r.value ?? r.body));
    rowHash.set(r.id, h);
    return h;
  };
  page.rows.forEach(hashRow);
  return { rowHash, subtrees };
}
for (const p of pages) p.m = merkle(p);

// ---------- E2: navigation with a content-addressed cache ----------
// Rows: bytes of page B whose row hash the client already holds after visiting A.
// Subtrees: largest element subtrees of B already held (greedy, top-down by size).
function rowReuse(prevSet, page) {
  let reused = 0;
  for (const r of page.rows) if (prevSet.has(page.m.rowHash.get(r.id))) reused += r.bytes;
  return reused;
}
function subtreeReuse(prevSubtrees, page) {
  const sorted = [...page.m.subtrees].sort((a, b) => b.bytes - a.bytes);
  let covered = 0;
  const total = page.buf.length;
  const seen = new Set();
  for (const s of sorted) {
    if (seen.has(s.hash)) continue;
    seen.add(s.hash);
    if (prevSubtrees.has(s.hash)) covered += s.bytes;
    if (covered > total) break;
  }
  return Math.min(covered, total);
}
{
  const docs = pages.filter((p) => p.route.startsWith("/docs"));
  let rowsTotal = 0,
    rowsReused = 0,
    subReused = 0;
  const pairs = [];
  for (let i = 1; i < docs.length; i++) pairs.push([docs[i - 1], docs[i]]); // sidebar-adjacent pages
  for (const [a, b] of pairs) {
    const prevRows = new Set(a.m.rowHash.values());
    const prevSub = new Set(a.m.subtrees.map((s) => s.hash));
    rowsTotal += b.buf.length;
    rowsReused += rowReuse(prevRows, b);
    subReused += subtreeReuse(prevSub, b);
  }
  console.log(`\nE2 navigation over ${pairs.length} adjacent docs pages`);
  console.log(`  whole rows already held: ${pct(rowsReused, rowsTotal)} of bytes`);
  console.log(
    `  whole element subtrees already held (Merkle DAG): ${pct(subReused, rowsTotal)} of bytes`,
  );
  // session cache: after visiting the first 10 docs pages, how much of each later page is held
  const cacheRows = new Set(),
    cacheSub = new Set();
  docs.slice(0, 10).forEach((p) => {
    p.m.rowHash.forEach((h) => cacheRows.add(h));
    p.m.subtrees.forEach((s) => cacheSub.add(s.hash));
  });
  let t = 0,
    r = 0,
    s = 0;
  for (const p of docs.slice(10)) {
    t += p.buf.length;
    r += rowReuse(cacheRows, p);
    s += subtreeReuse(cacheSub, p);
  }
  console.log(
    `  after 10 visited pages: rows ${pct(r, t)}, subtrees ${pct(s, t)} of later pages already held`,
  );
}

// ---------- E3: hash-consing within a page (tree → DAG) ----------
{
  let total = 0,
    dup = 0;
  for (const p of pages) {
    total += p.buf.length;
    const counts = new Map();
    for (const s of p.m.subtrees) {
      const c = counts.get(s.hash) || { n: 0, bytes: s.bytes };
      c.n++;
      counts.set(s.hash, c);
    }
    // only maximal duplicates matter; approximate with subtrees >= 128 bytes, minus a 6-byte ref each
    for (const { n, bytes } of counts.values())
      if (n > 1 && bytes >= 128) dup += (n - 1) * (bytes - 6);
  }
  console.log(
    `\nE3 repeated subtrees inside a page (>=128 B): up to ${pct(dup, total)} of payload bytes (raw, overlapping counts are an upper bound)`,
  );
}

// ---------- E4: string interning vs brotli ----------
{
  const p = pages.find((x) => x.route === "/docs/architecture") || pages[0];
  const text = p.buf.toString("utf8");
  const counts = new Map();
  for (const m of text.matchAll(/"([^"\\]{16,})"/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  const dict = [...counts]
    .filter(([s, n]) => n >= 2)
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);
  const index = new Map(dict.map(([s], i) => [s, i]));
  const interned =
    JSON.stringify(dict.map(([s]) => s)) +
    "\n" +
    text.replace(/"([^"\\]{16,})"/g, (m, s) =>
      index.has(s) ? `"$s${index.get(s).toString(36)}"` : m,
    );
  const raw0 = Buffer.byteLength(text),
    raw1 = Buffer.byteLength(interned);
  console.log(`\nE4 string interning ${p.route}: ${dict.length} repeated strings`);
  console.log(`  raw ${kb(raw0)} → ${kb(raw1)} (${pct(raw1, raw0)})`);
  for (const q of [5, 11])
    console.log(
      `  brotli q${q}: ${kb(br(Buffer.from(text), q))} → ${kb(br(Buffer.from(interned), q))}`,
    );
}

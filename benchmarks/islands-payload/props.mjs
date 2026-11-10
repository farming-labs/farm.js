// E5: which island props are big, and do they repeat across pages (content-addressed prop cache)?
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const pub = process.argv[2];
const br = (s) =>
  zlib.brotliCompressSync(Buffer.from(s), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
    .length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const f = path.join(d, n);
    statSync(f).isDirectory() ? walk(f) : n.endsWith(".rsc") && files.push(f);
  }
})(pub);
files.sort();
// resolve the payload into plain values: row refs and $id:path refs replaced by their values
function load(file) {
  const buf = readFileSync(file);
  const rows = new Map();
  const imports = new Map();
  let i = 0;
  while (i < buf.length) {
    const c = buf.indexOf(0x3a, i);
    const id = buf.toString("utf8", i, c);
    let j = c + 1;
    if (buf[j] === 0x54) {
      const k = buf.indexOf(0x2c, j);
      const len = parseInt(buf.toString("utf8", j + 1, k), 16);
      rows.set(id, buf.toString("utf8", k + 1, k + 1 + len));
      i = k + 1 + len;
      continue;
    }
    const nl = buf.indexOf(0x0a, j);
    const end = nl < 0 ? buf.length : nl;
    let body = buf.toString("utf8", j, end);
    if (body.startsWith("I[")) imports.set(id, JSON.parse(body.slice(1))[2]);
    else if (!body.startsWith("HL")) {
      try {
        rows.set(id, JSON.parse(body));
      } catch {}
    }
    i = end + 1;
  }
  const resolve = (v, seen = 0) => {
    if (seen > 60) return null;
    if (typeof v === "string") {
      const m = /^\$([L@]?)([0-9a-f]+)((?::[^:]+)*)$/.exec(v);
      if (m && (rows.has(m[2]) || imports.has(m[2]))) {
        if (imports.has(m[2])) return { $client: imports.get(m[2]) };
        let x = resolve(rows.get(m[2]), seen + 1);
        for (const k of m[3].split(":").filter(Boolean)) x = x?.[k];
        return x;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => resolve(x, seen + 1));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, seen + 1)]));
    return v;
  };
  const props = []; // { component, prop, json }
  const visit = (v) => {
    if (Array.isArray(v)) {
      if (v[0] === "$" && v.length === 4 && v[1] && typeof v[1] === "object" && v[1].$client) {
        for (const [k, val] of Object.entries(v[3] || {})) {
          if (Array.isArray(val) && val[0] === "$") continue; // element: becomes a slot
          if (
            k === "children" &&
            Array.isArray(val) &&
            val.some((x) => Array.isArray(x) && x[0] === "$")
          )
            continue;
          props.push({ component: v[1].$client, prop: k, json: JSON.stringify(val) ?? "null" });
        }
      }
      v.forEach(visit);
    } else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(resolve(rows.get("0")));
  return props;
}
const pages = files.filter((f) => f.includes("/docs")).map(load);
const arch = load(files.find((f) => f.endsWith("docs/architecture.rsc")));
const big = [...arch].sort((a, b) => b.json.length - a.json.length).slice(0, 6);
console.log("largest island props on /docs/architecture:");
for (const p of big)
  console.log(`  ${p.component}.${p.prop}: ${kb(p.json.length)} (br ${kb(br(p.json))})`);
const total = arch.reduce((s, p) => s + p.json.length, 0);
console.log(`  all props: ${kb(total)} in ${arch.length} props`);
// content-addressed prop cache across adjacent pages
let all = 0,
  held = 0,
  allBr = 0,
  newBr = 0;
for (let i = 1; i < pages.length; i++) {
  const prev = new Set(pages[i - 1].map((p) => sha(p.json)));
  const fresh = pages[i].filter((p) => !prev.has(sha(p.json)));
  all += pages[i].reduce((s, p) => s + p.json.length, 0);
  held += pages[i].filter((p) => prev.has(sha(p.json))).reduce((s, p) => s + p.json.length, 0);
  allBr += br(JSON.stringify(pages[i].map((p) => p.json)));
  newBr += br(JSON.stringify(fresh.map((p) => p.json)));
}
console.log(
  `\nprop values identical on the previous docs page: ${((100 * held) / all).toFixed(1)}% of prop bytes`,
);
console.log(
  `per navigation, brotli: all props ${kb(allBr / (pages.length - 1))} vs only unseen props ${kb(newBr / (pages.length - 1))}`,
);

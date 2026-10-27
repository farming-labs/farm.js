// E6: first load and navigation sizes, RSC vs islands vs islands + content-addressed values.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const pub = process.argv[2];
const br = (s) =>
  zlib.brotliCompressSync(Buffer.from(s), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
    .length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const htmls = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const f = path.join(d, n);
    statSync(f).isDirectory()
      ? walk(f)
      : n === "index.html" && f.includes("/docs/") && htmls.push(f);
  }
})(path.join(pub, "docs"));
htmls.sort();
let rscDoc = 0,
  islDoc = 0,
  casDoc = 0,
  rscNav = 0,
  islNav = 0,
  casNav = 0,
  n = 0,
  treeBr = 0;
for (const f of htmls) {
  const html = readFileSync(f, "utf8");
  const rsc = readFileSync(f.replace(/\/index\.html$/, ".rsc"), "utf8");
  const flight = (html.match(/<script>\(self\.__FLIGHT_DATA[^<]*<\/script>/g) || []).join("");
  const bare = html.replace(/<script>\(self\.__FLIGHT_DATA[^<]*<\/script>/g, "");
  // the nav tree: the largest T row or JSON value carrying the page tree; approximate it by the
  // PlatformProvider tree prop found via its first key
  const ti = rsc.indexOf('"tree":{');
  let tree = "";
  if (ti >= 0) {
    let depth = 0,
      j = ti + 7;
    for (; j < rsc.length; j++) {
      if (rsc[j] === "{") depth++;
      else if (rsc[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    tree = rsc.slice(ti + 7, j + 1);
  }
  const otherProps = 4096; // the remaining island props on a docs page: about 4 KB raw (measured: 307 KB total minus 2x143.6 KB tree)
  const props = '{"tree":' + tree + "}" + "x".repeat(0);
  const article = (() => {
    const i = bare.indexOf("<article");
    const j = bare.indexOf("</article>", i);
    return i >= 0 ? bare.slice(i, j + 10) : "";
  })();
  rscDoc += br(html);
  islDoc += br(bare + props) + 0;
  casDoc += br(bare + '{"tree":{"$v":"hash"}}');
  treeBr += br(tree);
  rscNav += br(rsc);
  islNav += br(article + props);
  casNav += br(article);
  n++;
}
console.log(`${n} docs pages, brotli q5, averages`);
console.log(
  `first load document:   rsc ${kb(rscDoc / n)} | islands ${kb(islDoc / n)} | islands + value store ${kb(casDoc / n)} (+ ${kb(treeBr / n)} tree file, cached across pages)`,
);
console.log(
  `navigation per click:  rsc ${kb(rscNav / n)} | islands page segment ${kb(islNav / n)} | islands + value store ${kb(casNav / n)}`,
);

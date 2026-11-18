import { readFile } from "node:fs/promises";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { matchFarmRoute } from "@farm.js/core/router";

const origin = "https://farm.invalid";

function inspect(html: string) {
  const links = new Set<string>();
  const anchors = new Set<string>();
  let base: string | undefined;
  function visit(node: DefaultTreeAdapterTypes.Node) {
    if ("attrs" in node) {
      const attr = (name: string) => node.attrs.find((a) => a.name === name)?.value;
      const id = attr("id");
      if (id) anchors.add(id);
      if (node.tagName === "base") base ??= attr("href");
      if (node.tagName === "a") {
        const name = attr("name");
        if (name) anchors.add(name);
        const href = attr("href");
        if (href !== undefined) links.add(href);
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(parse(html));
  return { links, anchors, base };
}

export async function checkLinks(
  manifestPath: string,
  files: { path: string; contents?: Buffer }[],
  routeFromHtml: (file: string) => string,
) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    version: number;
    routes: { kind: string; pattern: string }[];
  };
  if (manifest.version !== 1) throw new Error("Unsupported Farm route runtime manifest version.");
  const routes = manifest.routes.filter((route) => route.kind !== "rule");
  const assets = new Set(files.map((file) => "/" + file.path));
  const documents = new Map<string, ReturnType<typeof inspect>>();
  const pages = [];
  for (const file of files) {
    if (!file.path.endsWith(".html") || !file.contents) continue;
    const page = routeFromHtml(file.path);
    const document = inspect(file.contents.toString("utf8"));
    documents.set(page, document);
    documents.set("/" + file.path, document);
    pages.push({ page, document });
  }
  const broken: { page: string; href: string }[] = [];
  for (const { page, document } of pages) {
    const source = new URL(page, origin);
    const base = URL.parse(document.base ?? "", source.href) ?? source;
    for (const href of document.links) {
      const url = URL.parse(href, base.href);
      if (!url || url.origin !== origin) continue;
      let pathname: string;
      let fragment: string;
      try {
        pathname = decodeURI(url.pathname).replace(/\/$/, "") || "/";
        fragment = decodeURIComponent(url.hash.slice(1));
      } catch {
        broken.push({ page, href });
        continue;
      }
      const target = documents.get(pathname);
      if (
        target
          ? fragment && fragment.toLowerCase() !== "top" && !target.anchors.has(fragment)
          : !assets.has(pathname) &&
            !routes.some(({ pattern }) => matchFarmRoute(pattern, url.pathname))
      ) {
        broken.push({ page, href });
      }
    }
  }
  return broken;
}

// @vitest-environment jsdom

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setFarmBasePath } from "@farm.js/core/internal/client-runtime";
import { flushSync, mount, unmount } from "svelte";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * `@farm.js/svelte/link` ships `Link.svelte` as source, which the app's Svelte plugin compiles
 * for the server and the browser. The test compiles it the same way.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let tempDir: string;
let ServerLink: any;
let ServerProbe: any;
let ClientProbe: any;

async function compileTo(file: string, source: string, generate: "server" | "client") {
  const { js } = compile(source, { filename: file, generate, dev: false });
  await writeFile(path.join(tempDir, file), js.code);
  return (await import(/* @vite-ignore */ pathToFileURL(path.join(tempDir, file)).href)).default;
}

beforeAll(async () => {
  // Inside the package, so the compiled modules resolve `svelte` and `@farm.js/core`.
  tempDir = await mkdtemp(path.join(packageRoot, ".tmp-link-"));
  const link = await readFile(path.join(packageRoot, "src", "Link.svelte"), "utf8");
  ServerLink = await compileTo("link.server.js", link, "server");
  // Content goes through a compiled component: this environment resolves \`svelte\` to its browser
  // build, whose snippets do not render on the server.
  ServerProbe = await compileTo(
    "probe.server.js",
    `<script>
  import Link from "./link.server.js";
  let { label, ...props } = $props();
</script>
<Link {...props}><span>{label}</span></Link>`,
    "server",
  );
  await compileTo("link.client.js", link, "client");
  ClientProbe = await compileTo(
    "probe.client.js",
    `<script>
  import Link from "./link.client.js";
  let name = $state("wheat");
  let replace = $state(false);
  export function update(nextName, nextReplace) {
    name = nextName;
    replace = nextReplace;
  }
</script>
<Link href="/crops/[name]" params={{ name }} {replace} id="crop" onclick={(event) => event.preventDefault()}>{name}</Link>`,
    "client",
  );
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  setFarmBasePath("/");
  document.body.replaceChildren();
});

function parseAnchor(html: string): HTMLAnchorElement {
  const template = document.createElement("template");
  template.innerHTML = html.replace(/<!--[^]*?-->/g, "");
  const anchor = template.content.querySelector("a");
  expect(anchor).not.toBeNull();
  return anchor!;
}

function attributesOf(anchor: Element): Record<string, string> {
  return Object.fromEntries(Array.from(anchor.attributes, (attr) => [attr.name, attr.value]));
}

describe("Svelte Link", () => {
  it("renders the anchor the router navigates and prefetches", () => {
    const { body } = render(ServerProbe, {
      props: {
        href: "/crops/[name]",
        params: { name: "winter wheat" },
        query: { sort: "rows" },
        prefetch: "intent",
        prefetchDelay: 120,
        replace: true,
        scroll: false,
        viewTransition: true,
        class: "nav",
        label: "Wheat",
      },
    });

    const anchor = parseAnchor(body);
    expect(attributesOf(anchor)).toEqual({
      class: "nav",
      href: "/crops/winter%20wheat?sort=rows",
      "data-farm-link": "",
      "data-farm-prefetch": "intent",
      "data-farm-prefetch-delay": "120",
      "data-replace": "",
      "data-no-scroll": "",
      "data-view-transition": "true",
    });
    expect(anchor.textContent).toBe("Wheat");
  });

  it("prefixes the app base path and writes nothing for the default prefetch", () => {
    setFarmBasePath("/farm");
    const { body } = render(ServerProbe, { props: { href: "/about", label: "About" } });

    expect(attributesOf(parseAnchor(body))).toEqual({ href: "/farm/about", "data-farm-link": "" });
  });

  it("renders a javascript: URL without an href", () => {
    const { body } = render(ServerLink, { props: { href: "javascript:alert(1)" } });

    expect(attributesOf(parseAnchor(body))).toEqual({ "data-farm-link": "" });
  });

  it("updates its anchor and keeps event handlers in the browser", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const probe = mount(ClientProbe, { target });
    flushSync();

    const anchor = target.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("/crops/wheat");
    expect(anchor.hasAttribute("data-replace")).toBe(false);
    expect(anchor.id).toBe("crop");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);

    probe.update("barley", true);
    flushSync();
    expect(target.querySelector("a")).toBe(anchor);
    expect(anchor.getAttribute("href")).toBe("/crops/barley");
    expect(anchor.hasAttribute("data-replace")).toBe(true);
    expect(anchor.textContent).toBe("barley");
    unmount(probe);
  });
});

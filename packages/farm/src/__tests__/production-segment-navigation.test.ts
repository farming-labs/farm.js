import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getSharedLayoutPrefixLength, parseFarmLayoutChainHeader } from "../navigation/render-plan";
import { FARM_SEGMENT_NAVIGATION_SERVER_RUNTIME } from "../nitro/universal-build";

// The production server code islands mode ships for segment navigation.
const server = new Function(
  "parseFarmLayoutChainHeader",
  "getSharedLayoutPrefixLength",
  `${FARM_SEGMENT_NAVIGATION_SERVER_RUNTIME}\nreturn { getFarmLayoutKey, countFarmKeptLayouts };`,
)(parseFarmLayoutChainHeader, getSharedLayoutPrefixLength) as {
  getFarmLayoutKey(pattern: string, params: Record<string, unknown>): string;
  countFarmKeptLayouts(
    request: Request,
    layouts: Array<{ pattern: string }>,
    params: Record<string, unknown>,
  ): number;
};

// The browser check, as the generated client has it.
function loadClientCheck() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
    "utf-8",
  );
  const slice = (from: string) => {
    const start = source.indexOf(from);
    expect(start).toBeGreaterThan(-1);
    const end = /\n\}(\n|`)/.exec(source.slice(start))!;
    return source.slice(start, start + end.index + 2);
  };
  const code = [
    slice("function getLayoutIdentity(boundary) {"),
    slice("function getLayoutPatterns(root) {"),
    slice("function fitsSegmentResponse(currentRoot, nextRoot) {"),
  ]
    .join("\n")
    .replace(/\\`/g, "`");
  return new Function(`${code}\nreturn fitsSegmentResponse;`)() as (
    current: Element,
    next: Element,
  ) => boolean;
}

function chain(...layouts: string[]) {
  return new Request("http://localhost/", {
    headers: { "x-farm-layout-chain": JSON.stringify(layouts) },
  });
}

function root(html: string): Element {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

const boundary = (key: string, inner = "", kept = false) =>
  `<div data-farm-layout-boundary="true" data-farm-layout-pattern="${key}" data-farm-layout-key="${key}"${kept ? ' data-farm-layout-kept="true"' : ""}>${inner}</div>`;

describe("islands segment navigation", () => {
  it("keys a layout by its pattern and params", () => {
    expect(server.getFarmLayoutKey("/docs", {})).toBe("/docs");
    expect(server.getFarmLayoutKey("/docs/[section]", { section: "guides" })).toBe("/docs/guides");
    expect(server.getFarmLayoutKey("/files/[...path]", { path: ["a", "b c"] })).toBe(
      "/files/a/b%20c",
    );
    expect(server.getFarmLayoutKey("/shop/[[...rest]]", {})).toBe("/shop/");
  });

  it("keeps the layouts the browser shows, implying a root layout it cannot see", () => {
    const layouts = [{ pattern: "/" }, { pattern: "/docs" }, { pattern: "/docs/[section]" }];
    const params = { section: "guides" };
    // A root layout that renders <html> leaves no boundary, so the chain starts below it.
    expect(server.countFarmKeptLayouts(chain("/docs", "/docs/guides"), layouts, params)).toBe(3);
    expect(server.countFarmKeptLayouts(chain("/", "/docs"), layouts, params)).toBe(2);
    // New params render the layout again.
    expect(server.countFarmKeptLayouts(chain("/docs", "/docs/api"), layouts, params)).toBe(2);
    // A different section of the site keeps nothing below the root.
    expect(server.countFarmKeptLayouts(chain("/blog"), layouts, params)).toBe(1);
    expect(server.countFarmKeptLayouts(new Request("http://localhost/"), layouts, params)).toBe(0);
    expect(
      server.countFarmKeptLayouts(
        new Request("http://localhost/", { headers: { "x-farm-layout-chain": "not json" } }),
        layouts,
        params,
      ),
    ).toBe(0);
  });

  it("applies a segment only where the page still shows the layouts it left out", () => {
    const fits = loadClientCheck();
    const current = root(boundary("/docs", "<nav>sidebar</nav>" + boundary("/docs/guides")));
    const segment = root(boundary("/docs", boundary("/docs/guides", "", true), true));
    expect(fits(current, segment)).toBe(true);
    expect(fits(root(boundary("/docs", boundary("/docs/api"))), segment)).toBe(false);
    expect(fits(root(boundary("/blog")), segment)).toBe(false);
    // A whole document fits anywhere.
    expect(fits(root(boundary("/blog")), root(boundary("/docs", "<nav></nav>")))).toBe(true);
  });
});

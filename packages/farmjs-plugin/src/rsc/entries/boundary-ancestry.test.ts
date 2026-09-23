import { expect, it } from "vitest";
import { generateRscEntry } from "./rsc.js";

const entry = generateRscEntry({
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
  deploymentId: "boundary-ancestry",
  debug: false,
});

function matcher(modules: Record<string, unknown>) {
  const start = entry.indexOf("function getRouteModules(");
  const end = entry.indexOf("/**\n * Main request handler", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Function(
    "loadings",
    "errors",
    "layouts",
    `${entry.slice(start, end)}; return getMatchingBoundary;`,
  )(modules, modules, modules) as (
    page: string | undefined,
    modules: Record<string, unknown>,
    kind: string,
  ) => unknown;
}

it.each(["loading", "error"] as const)(
  "selects %s boundaries only along the chosen page ancestry",
  (kind) => {
    const Root = () => null;
    const Dynamic = () => null;
    const Group = () => null;
    const Optional = () => null;
    const modules = {
      [`/${kind}.tsx`]: { default: Root },
      [`/users/[id]/${kind}.tsx`]: { default: Dynamic },
      [`/(shop)/products/${kind}.tsx`]: { default: Group },
      [`/docs/[[...slug]]/${kind}.tsx`]: { default: Optional },
    };
    const match = matcher(modules);
    expect(match("/users/new/page.tsx", modules, kind)).toBe(Root);
    expect(match("/users/[id]/page.tsx", modules, kind)).toBe(Dynamic);
    expect(match("/(shop)/products/page.tsx", modules, kind)).toBe(Group);
    expect(match("/docs/[[...slug]]/page.tsx", modules, kind)).toBe(Optional);
    expect(match("/docs/[[...slug]]/nested/page.tsx", modules, kind)).toBe(Optional);
    expect(match("/docs/page.tsx", modules, kind)).toBe(Root);
    expect(match(undefined, modules, kind)).toBe(Root);
  },
);

it.each(["loading", "error"] as const)(
  "preserves relative module keys, extensions and nearest %s precedence",
  (kind) => {
    const Root = () => null;
    const Parent = () => null;
    const Leaf = () => null;
    const modules = {
      [`${kind}.js`]: { default: Root },
      [`team/${kind}.ts`]: { default: Parent },
      [`team/settings/${kind}.jsx`]: { default: Leaf },
      [`team/settings/deeper/${kind}.tsx`]: {},
    };
    const match = matcher(modules);
    expect(match("team/settings/deeper/page.jsx", modules, kind)).toBe(Leaf);
    expect(match("team/page.ts", modules, kind)).toBe(Parent);
    expect(match("teamwork/page.tsx", modules, kind)).toBe(Root);
    expect(match("page.js", modules, kind)).toBe(Root);
    expect(match("/elsewhere/page.tsx", {}, kind)).toBeNull();
  },
);

it("wires loading, render errors and pre-shell failures to the same selected page", () => {
  expect(entry).toContain("getMatchingBoundary(pattern, loadings, 'loading')");
  expect(entry).toContain("getMatchingBoundary(pattern, errors, 'error')");
  expect(entry).toContain("getMatchingBoundary(matchedPage?.pattern, errors, 'error')");
  expect(entry).toContain("matchedPage = matched;");
  expect(entry).not.toContain("boundaryPathToRoute");
});

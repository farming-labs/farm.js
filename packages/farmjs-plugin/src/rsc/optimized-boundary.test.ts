import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import farmRsc from "./index.js";
import { _optimizeBoundary } from "./optimized-boundary.js";

const fixtures: string[] = [];

function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-optimized-boundary-"));
  fixtures.push(root);

  return root;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    if (existsSync(fixture)) rmSync(fixture, { recursive: true, force: true });
  }
});

describe("experimental optimized boundary", () => {
  it("requires the explicit experimental flag", () => {
    const plugin = farmRsc().find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:optimized-boundary",
    );
    const resolveId = plugin?.resolveId as (
      id: string,
      importer: string,
      options: { ssr?: boolean },
    ) => unknown;

    expect(() =>
      resolveId.call(
        { environment: { name: "rsc" } },
        "@farm.js/plugin/rsc/optimized-boundary",
        "/app/src/page.tsx",
        { ssr: true },
      ),
    ).toThrow(/experimental\.optimizedBoundary is disabled/);
  });

  it("externalizes Strata on the server and rejects client imports", async () => {
    const root = createFixture();
    const plugins = farmRsc();
    const configPlugin = plugins.find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:config",
    );
    const configHook = configPlugin?.config as (
      config: Record<string, unknown>,
      env: { command: "build"; mode: string },
    ) => Promise<any>;

    const resolved = await configHook(
      {
        root,
        srcDir: "src",
        experimental: {
          serverComponents: true,
          optimizedBoundary: true,
        },
      },
      { command: "build", mode: "production" },
    );

    expect(resolved.ssr.external).toEqual(
      expect.arrayContaining(["@farming-labs/strata", "@farming-labs/strata/react-server"]),
    );
    expect(resolved.optimizeDeps.exclude).toEqual(
      expect.arrayContaining(["@farming-labs/strata", "@farming-labs/strata/react-server"]),
    );

    const staticPlugin = plugins.find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:optimized-boundary",
    );
    const resolveId = staticPlugin?.resolveId as (
      id: string,
      importer: string,
      options: { ssr?: boolean },
    ) => unknown;

    expect(
      resolveId.call(
        { environment: { name: "rsc" } },
        "@farm.js/plugin/rsc/optimized-boundary",
        "/app/src/page.tsx",
        { ssr: true },
      ),
    ).toBeNull();
    expect(
      resolveId.call(
        { environment: { name: "rsc" } },
        "@farming-labs/strata",
        "@farm.js/plugin/rsc/optimized-boundary",
        { ssr: true },
      ),
    ).toEqual({
      id: "@farming-labs/strata",
      external: true,
    });
    expect(
      resolveId.call(
        { environment: { name: "rsc" } },
        "@farming-labs/strata/react-server",
        "@farm.js/plugin/rsc/optimized-boundary",
        { ssr: true },
      ),
    ).toEqual({
      id: "@farming-labs/strata/react-server",
      external: true,
    });
    expect(() =>
      resolveId.call(
        { environment: { name: "client" } },
        "@farm.js/plugin/rsc/optimized-boundary",
        "/app/src/client.tsx",
        { ssr: false },
      ),
    ).toThrow(/server-only/);
  });

  it("injects automatic optimization only in the enabled RSC environment", async () => {
    const root = createFixture();
    const plugins = farmRsc();
    const automaticPlugin = plugins.find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:automatic-optimized-boundary",
    );
    const transform = automaticPlugin?.transform as (
      code: string,
      id: string,
    ) => { code: string } | null;
    const code = `import { jsxs } from "react/jsx-runtime";
export default function Page() { return jsxs("article", { children: ["one", "two"] }); }`;

    expect(
      transform.call({ environment: { name: "rsc" } }, code, `${root}/src/app/page.tsx`),
    ).toBeNull();

    const configPlugin = plugins.find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:config",
    );
    const configHook = configPlugin?.config as (
      config: Record<string, unknown>,
      env: { command: "build"; mode: string },
    ) => Promise<unknown>;
    await configHook(
      {
        root,
        experimental: { serverComponents: true, optimizedBoundary: true },
      },
      { command: "build", mode: "production" },
    );

    expect(
      transform.call({ environment: { name: "rsc" } }, code, `${root}/src/app/page.tsx`)?.code,
    ).toContain("__farmOptimizeBoundary");
    expect(
      transform.call({ environment: { name: "ssr" } }, code, `${root}/src/app/page.tsx`),
    ).toBeNull();
  });

  it("rejects optimized boundaries when server components are disabled", async () => {
    const configPlugin = farmRsc().find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:config",
    );
    const configHook = configPlugin?.config as (
      config: Record<string, unknown>,
      env: { command: "build"; mode: string },
    ) => Promise<unknown>;

    await expect(
      configHook(
        {
          root: createFixture(),
          experimental: {
            serverComponents: false,
            optimizedBoundary: true,
          },
        },
        { command: "build", mode: "production" },
      ),
    ).rejects.toThrow(/requires experimental\.serverComponents/);
  });

  it("automatically renders safe host-only React trees through Strata", () => {
    const element = createElement(
      "article",
      { className: "prose", "data-content": "automatic" },
      createElement("h1", null, "Automatic optimization"),
      ...Array.from({ length: 8 }, (_, index) =>
        createElement("p", { key: index }, `Static paragraph ${index + 1}`),
      ),
    );

    const optimized = _optimizeBoundary(element);
    expect(optimized).not.toBe(element);
    expect(typeof optimized.type).toBe("function");

    const rendered = (optimized.type as (props: unknown) => ReactElement)(optimized.props);
    expect(rendered.type).toBe("article");
    expect(rendered.props).toMatchObject({
      className: "prose",
      "data-content": "automatic",
      "data-strata": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      (rendered.props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML,
    ).toEqual({
      __html: expect.stringContaining("<h1>Automatic optimization</h1>"),
    });
  });

  it("keeps normal React rendering for unsupported or unsafe trees", () => {
    function InteractiveChild() {
      return createElement("button", null, "Interactive");
    }

    const componentTree = createElement(
      "article",
      null,
      ...Array.from({ length: 8 }, (_, index) =>
        index === 4
          ? createElement(InteractiveChild, { key: index })
          : createElement("p", { key: index }, `Paragraph ${index + 1}`),
      ),
    );
    const unsafeUrlTree = createElement(
      "article",
      null,
      createElement("a", { href: "javascript:alert(1)" }, "Unsafe"),
      ...Array.from({ length: 8 }, (_, index) =>
        createElement("p", { key: index }, `Paragraph ${index + 1}`),
      ),
    );

    expect(_optimizeBoundary(componentTree)).toBe(componentTree);
    const unsafeCandidate = _optimizeBoundary(unsafeUrlTree);
    expect(typeof unsafeCandidate.type).toBe("function");
    expect((unsafeCandidate.type as (props: unknown) => ReactElement)(unsafeCandidate.props)).toBe(
      unsafeUrlTree,
    );
  });
});

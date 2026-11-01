import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarmIsolatedClientBoundary } from "../client/isolated-boundary";
import { getClientModuleHydrationPlan, usesFarmServerTree } from "../utils/client-component";
import { getFarmServerTreeLayoutPatterns } from "../routing/layout-selector";
import { transformIsolatedClientBoundaryModule } from "../vite";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function Panel({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

describe("islands mode", () => {
  it("sends server output in island props as a DOM slot, not twice", () => {
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Panel,
      "/src/panel.tsx",
      "Panel",
      "load",
      {
        slots: true,
      },
    );
    const html = renderToString(
      <Boundary title="Comments">
        <p>Server comment</p>
      </Boundary>,
    );
    expect(html).toMatch(
      /<f-slot name="[^"]+s0" style="display:contents"><p>Server comment<\/p><\/f-slot>/,
    );
    const props = JSON.parse(
      /<script type="f\/props" for="[^"]+">([^<]*)<\/script>/.exec(html)![1]!,
    );
    expect(props.title).toBe("Comments");
    expect(props.children).toEqual({ $: "s", v: expect.stringMatching(/s0$/) });
    expect(JSON.stringify(props)).not.toContain("Server comment");
  });

  it("keeps the earlier modes' rule: element props stay static without slots", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Panel,
      "/src/panel.tsx",
      "Panel",
      "load",
    );
    const html = renderToString(
      <Boundary title="Comments">
        <p>Server comment</p>
      </Boundary>,
    );
    expect(html).not.toContain("f-island");
  });

  it("plans a synchronous server page like an async one, so it can join a layout's tree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "farm-islands-plan-"));
    roots.push(root);
    mkdirSync(path.join(root, "src/app"), { recursive: true });
    writeFileSync(
      path.join(root, "src/counter.tsx"),
      '"use client";\nexport function Counter({ start }: { start: number }) { return <button>{start}</button>; }\n',
    );
    writeFileSync(
      path.join(root, "src/app/page.tsx"),
      'import { Counter } from "../counter";\nexport default function Page() { return <main><Counter start={1} /></main>; }\n',
    );
    const page = path.join(root, "src/app/page.tsx");
    const islands = getClientModuleHydrationPlan(page, root, "enabled", {
      asyncOwnerIslands: true,
      serverOwners: true,
    });
    expect(islands.asyncOwnerIslands).toBe(true);
    expect(usesFarmServerTree(islands)).toBe(true);
    const experiment = getClientModuleHydrationPlan(page, root, "enabled", {
      asyncOwnerIslands: true,
    });
    expect(experiment.asyncOwnerIslands).toBeUndefined();
  });

  describe("a client component that cannot become an island", () => {
    const plan = (page: string, files: Record<string, string>) => {
      const root = mkdtempSync(path.join(tmpdir(), "farm-islands-error-"));
      roots.push(root);
      mkdirSync(path.join(root, "src/app"), { recursive: true });
      for (const [file, content] of Object.entries(files)) {
        writeFileSync(path.join(root, "src", file), content);
      }
      writeFileSync(path.join(root, "src/app/page.tsx"), page);
      return getClientModuleHydrationPlan(path.join(root, "src/app/page.tsx"), root, "off", {
        asyncOwnerIslands: true,
        serverOwners: true,
      });
    };
    const row = {
      "row.tsx": '"use client";\nexport function Row() { return <tr><td>row</td></tr>; }\n',
    };

    it("never hydrates the server page whole, which would ship its server code", () => {
      const page = plan(
        'import { Row } from "../row";\nimport { secret } from "../secret";\nexport default function Page() { return <table><tbody><Row />{secret()}</tbody></table>; }\n',
        row,
      );
      expect(page).toMatchObject({
        shouldHydrate: false,
        islandStrategy: null,
        hasIsolatedClientBoundaries: false,
        isolatedBoundaries: [],
      });
      expect(page.islandsError).toBe(
        'the client boundary imported from ../row renders inside <table>, where the HTML parser relocates its hydration marker. Move "use client" up to a component that renders the whole <table>, or render it inside a <td>, <th> or <caption>',
      );
    });

    it("reports `export *`, whose names live in another module", () => {
      const page = plan(
        'import { Row } from "../row-index";\nexport default function Page() { return <main><Row /></main>; }\n',
        { ...row, "row-index.tsx": '"use client";\nexport * from "./row";\n' },
      );
      expect(page.shouldHydrate).toBe(false);
      expect(page.islandsError).toMatch(/unsupported export shape\. Export each component by name/);
    });

    it("isolates components inside table cells and foreignObject", () => {
      for (const body of [
        "<table><tbody><tr><td><Counter /></td></tr></tbody></table>",
        "<table><caption><Counter /></caption></table>",
        "<svg><foreignObject><Counter /></foreignObject></svg>",
      ]) {
        const page = plan(
          `import { Counter } from "../counter";\nexport default function Page() { return ${body}; }\n`,
          {
            "counter.tsx":
              '"use client";\nexport function Counter() { return <button>1</button>; }\n',
          },
        );
        expect(page.islandsError, body).toBeUndefined();
        expect(page.asyncOwnerIslands, body).toBe(true);
      }
    });
  });

  it("isolates components exported through export lists and re-exports", () => {
    const root = mkdtempSync(path.join(tmpdir(), "farm-islands-export-list-"));
    roots.push(root);
    mkdirSync(path.join(root, "src/app"), { recursive: true });
    writeFileSync(
      path.join(root, "src/counter.tsx"),
      '"use client";\nfunction Counter() { return <button>1</button>; }\nexport { Counter };\n',
    );
    writeFileSync(
      path.join(root, "src/app/page.tsx"),
      'import { Counter } from "../counter";\nexport default function Page() { return <main><Counter /></main>; }\n',
    );
    const page = getClientModuleHydrationPlan(path.join(root, "src/app/page.tsx"), root, "off", {
      asyncOwnerIslands: true,
      serverOwners: true,
    });
    expect(page.islandsError).toBeUndefined();
    expect(page.isolatedBoundaries).toEqual([
      { modulePath: path.join(root, "src/counter.tsx"), islandStrategy: "load" },
    ]);
  });

  it("wraps export-list and re-exported components as islands", async () => {
    const { parseSync } = await import("vite");
    const output = transformIsolatedClientBoundaryModule({
      code: [
        '"use client";',
        'import { useState } from "react";',
        "function Counter() { return null; }",
        "const helper = 1;",
        "export { Counter, helper, Counter as default };",
        'export { Button as PrimaryButton, format } from "./button";',
        'export type { Props } from "./types";',
      ].join("\n"),
      moduleReference: "/src/counter.tsx",
      islandStrategy: "load",
      parse: (code) => (parseSync("counter.tsx", code) as { program: unknown }).program as never,
      slots: true,
    })!;
    expect(output).toContain(
      'import { Button as __farm_isolated_reexport_0__, format as __farm_isolated_reexport_1__ } from "./button";',
    );
    expect(output).toContain(
      'const __farm_isolated_boundary_Counter__ = __farm_islx_island__(Counter, "/src/counter.tsx", "Counter", "load");',
    );
    expect(output).toContain("export { __farm_isolated_boundary_Counter__ as Counter };");
    expect(output).toContain("export default __farm_isolated_boundary_default__;");
    expect(output).toContain(
      'const __farm_isolated_boundary_PrimaryButton__ = __farm_islx_island__(__farm_isolated_reexport_0__, "/src/counter.tsx", "PrimaryButton", "load");',
    );
    expect(output).toContain("export { helper as helper };");
    expect(output).toContain("export { __farm_isolated_reexport_1__ as format };");
    expect(output).toContain('export type { Props } from "./types";');
    expect(output).not.toMatch(/export \{ Counter, helper/);
  });

  describe("a server layout around a client provider", () => {
    const planLayout = (
      layout: string,
      files: Record<string, string>,
      serverTreeLayouts = true,
    ) => {
      const root = mkdtempSync(path.join(tmpdir(), "farm-islands-layout-"));
      roots.push(root);
      mkdirSync(path.join(root, "src/app"), { recursive: true });
      for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, "src", file)), { recursive: true });
        writeFileSync(path.join(root, "src", file), content);
      }
      writeFileSync(path.join(root, "src/app/layout.tsx"), layout);
      return {
        root,
        plan: getClientModuleHydrationPlan(path.join(root, "src/app/layout.tsx"), root, "enabled", {
          asyncOwnerIslands: true,
          serverTreeLayouts,
        }),
      };
    };
    const theme = {
      "theme.tsx":
        '"use client";\nexport function ThemeProvider({ children }) { return <div>{children}</div>; }\n',
    };
    const providerLayout =
      'import { ThemeProvider } from "../theme";\nimport { secret } from "../secret";\nexport default function Layout({ children }) { return <ThemeProvider><p>{secret()}</p>{children}</ThemeProvider>; }\n';

    it("renders as a server tree, so its module stays on the server", () => {
      const { root, plan } = planLayout(providerLayout, theme);
      expect(plan).toMatchObject({ shouldHydrate: true, serverTreeLayout: true });
      expect(plan.isolatedBoundaries).toEqual([
        { modulePath: path.join(root, "src/theme.tsx"), islandStrategy: "load" },
      ]);
      // Outside islands mode it hydrates whole, as before.
      expect(planLayout(providerLayout, theme, false).plan.serverTreeLayout).toBeUndefined();
    });

    it("keeps a layout whose client components can be islands as islands", () => {
      const { plan } = planLayout(
        'import { Counter } from "../counter";\nexport default function Layout({ children }) { return <main><Counter />{children}</main>; }\n',
        {
          "counter.tsx":
            '"use client";\nexport function Counter() { return <button>1</button>; }\n',
        },
      );
      expect(plan).toMatchObject({ shouldHydrate: false, hasIsolatedClientBoundaries: true });
      expect(plan.serverTreeLayout).toBeUndefined();
    });

    it("reports a provider imported from a package, with the local-wrapper fix", () => {
      const { plan } = planLayout(
        'import { ThemeProvider } from "acme-theme";\nexport default function Layout({ children }) { return <ThemeProvider>{children}</ThemeProvider>; }\n',
        {
          "../node_modules/acme-theme/package.json": '{"name":"acme-theme","main":"index.js"}',
          "../node_modules/acme-theme/index.js":
            '"use client";\nexport function ThemeProvider({ children }) { return children; }\n',
        },
      );
      expect(plan.shouldHydrate).toBe(false);
      expect(plan.islandsError).toMatch(
        /package client boundary acme-theme cannot yet be isolated\. Render it from a local "use client" module/,
      );
    });

    it("renders the server layouts on the same pages as trees too", () => {
      const patterns = getFarmServerTreeLayoutPatterns([
        { pattern: "/", shouldHydrate: false },
        { pattern: "/shop", shouldHydrate: true, serverTreeLayout: true },
        { pattern: "/shop/[id]", shouldHydrate: false },
        { pattern: "/docs", shouldHydrate: false },
        // A "use client" layout keeps its module.
        { pattern: "/app", shouldHydrate: true },
      ]);
      expect([...patterns].sort()).toEqual(["/", "/shop", "/shop/[id]"]);
    });
  });
});

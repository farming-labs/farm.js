import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarmIsolatedClientBoundary } from "../client/isolated-boundary";
import { getClientModuleHydrationPlan, usesFarmServerTree } from "../utils/client-component";

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
});

// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

const compile = (list: string) =>
  compileReactModule(
    `
      import { useState } from "react";
      export function Filters() {
        const [filter, setFilter] = useState("all");
        return <nav>{${list}}</nav>;
      }
    `,
    "/app/LiteralLists.tsx",
    infer,
  );

describe("React AOT lists over array literals", () => {
  it.each([
    ["strings", `["all", "active", "done"]`],
    ["numbers", `[1, 2, 3]`],
    ["a filtered literal", `["all", "active", "done"].filter((name) => name !== "active")`],
    ["a sliced literal", `["all", "active", "done"].slice(0, 2)`],
  ])("moves a list over %s to a module constant and compiles it", async (_name, collection) => {
    const result = await compile(
      `${collection}.map((name) => <button key={name} className={filter === name ? "selected" : ""} onClick={() => setFilter(name)}>{name}</button>)`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Filters"]);
    expect(result.code).toMatch(/const _farmListItems = \[/);
    expect(result.code).toContain("_farmListItems.");
    expect(result.code).toContain("farmBlocks.Keyed");
  });

  it.each([
    [
      "a callback that receives the array",
      `["a", "b"].map((name, index, all) => <button key={name} onClick={() => setFilter(name)}>{all.length}</button>)`,
    ],
    [
      "object elements",
      `[{ id: "a" }].map((item) => <button key={item.id} onClick={() => setFilter(item.id)}>{item.id}</button>)`,
    ],
    ["a named callback", `["a", "b"].map(renderFilter)`],
    [
      "a spread element",
      `[...["a"], "b"].map((name) => <button key={name} onClick={() => setFilter(name)}>{name}</button>)`,
    ],
    [
      "a non-literal pipeline argument",
      `["a", "b"].slice(0, filter.length).map((name) => <button key={name} onClick={() => setFilter(name)}>{name}</button>)`,
    ],
  ])("leaves a list over %s unchanged", async (_name, list) => {
    const result = await compile(list);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/array literals/i);
    expect(result.code).not.toContain("_farmListItems");
  });
});

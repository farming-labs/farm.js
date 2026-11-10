import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectFarmWebMCPTools, findFarmWebMCPTools } from "../app-manifest-webmcp";

describe("WebMCP tools in source", () => {
  it("reads names, text, hints and literal schemas, and marks computed schemas", () => {
    const tools = findFarmWebMCPTools(
      `
      import { defineWebMCPTool as tool, registerWebMCPTools } from "@farm.js/webmcp/client";
      import { z } from "zod";
      const input = z.object({ label: z.string() });
      export function Todos() {
        registerWebMCPTools([
          tool({
            name: "list_todos",
            title: "List todos",
            description: \`List the current todos.\`,
            inputSchema: { type: "object", additionalProperties: false } as const,
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async () => ({ todos: [] }),
          }),
          {
            name: "add_todo",
            description: "Add one todo.",
            inputSchema: z.toJSONSchema(input),
            execute: async () => ({}),
          },
        ]);
        return <ul />;
      }
      `,
      "todos.tsx",
    );
    expect(tools).toEqual([
      {
        name: "list_todos",
        title: "List todos",
        description: "List the current todos.",
        readOnlyHint: true,
        inputSchema: { type: "object", additionalProperties: false },
        inputSchemaSource: "literal",
      },
      {
        name: "add_todo",
        description: "Add one todo.",
        inputSchemaSource: "computed",
      },
    ]);
  });

  it("only counts the webmcp client's functions, and skips names it can't read", () => {
    expect(
      findFarmWebMCPTools(`
        import { defineWebMCPTool } from "./my-own-helpers";
        defineWebMCPTool({ name: "not_webmcp", description: "x", inputSchema: {} });
      `),
    ).toEqual([]);
    expect(
      findFarmWebMCPTools(`
        import { registerWebMCPTool } from "@farm.js/webmcp/client";
        const name = "dynamic";
        registerWebMCPTool({ name, description: "x", inputSchema: {} });
        registerWebMCPTool({ name: "has space", description: "x", inputSchema: {} });
        registerWebMCPTool({ name: "kept", description: "x" });
      `),
    ).toEqual([{ name: "kept", description: "x", inputSchemaSource: "none" }]);
    // Code that doesn't parse lists nothing rather than failing the build.
    expect(findFarmWebMCPTools(`import "@farm.js/webmcp/client"; const = ;`)).toEqual([]);
  });

  it("keeps the first definition of a name across the app's source, and skips tests", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-webmcp-"));
    roots.push(root);
    const write = (file: string, name: string, description: string) => {
      fs.mkdirSync(path.dirname(path.join(root, "src", file)), { recursive: true });
      fs.writeFileSync(
        path.join(root, "src", file),
        `import { defineWebMCPTool } from "@farm.js/webmcp/client";
export const tool = defineWebMCPTool({ name: "${name}", description: "${description}", inputSchema: { type: "object" } });`,
      );
    };
    write("a/first.ts", "search", "First");
    write("b/second.tsx", "search", "Second");
    write("c/other.js", "other", "Other");
    write("a/first.test.ts", "only_in_tests", "Test");
    expect(
      collectFarmWebMCPTools(root).map(({ name, description }) => [name, description]),
    ).toEqual([
      ["search", "First"],
      ["other", "Other"],
    ]);
    expect(collectFarmWebMCPTools(path.join(root, "missing"))).toEqual([]);
  });
});

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);

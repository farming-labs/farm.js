// @vitest-environment node
import { parseSync, traverse, type NodePath } from "@babel/core";
import { expect, it, vi } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

it("does not restart subtree traversal for each nested foreign element", async () => {
  let prototype: NodePath | undefined;
  traverse(parseSync("const value = 1")!, {
    Program(path) {
      prototype = Object.getPrototypeOf(path);
    },
  });
  const original = prototype!.traverse;
  let subtreeScans = 0;
  const spy = vi
    .spyOn(prototype!, "traverse")
    .mockImplementation(function (this: NodePath, visitor, state) {
      if (this.isJSXElement()) subtreeScans++;
      return original.call(this, visitor, state);
    });
  try {
    const nested = "<svg>".repeat(100) + "<title>{count}</title>" + "</svg>".repeat(100);
    const result = await compileReactModule(
      `import {useState} from "react";
       export function Nested() { const [count] = useState(0); return ${nested}; }`,
      "/app/Nested.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.code).toContain("<title>");
    expect(subtreeScans).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

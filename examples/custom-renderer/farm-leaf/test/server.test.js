// @vitest-environment node

import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { describe, expect, it } from "vitest";
import { compileLeaf, componentName } from "../src/compile.js";
import { leaf } from "../src/index.js";
import * as server from "../src/server.js";

defineRendererDescriptorConformance({
  name: "leaf",
  createDescriptor: leaf,
  expected: {
    vite: "farm-leaf/vite",
    server: "farm-leaf/server",
    client: "farm-leaf/client",
    jsxImportSource: "leaf",
    capabilities: { reconcilesRerenders: true, functionComponents: true },
  },
});

defineRendererServerConformance(server);

describe("leaf files", () => {
  it("compile to a module whose default export is the component", () => {
    const source = [
      "<script module>",
      "export const hydrate = true;",
      "</script>",
      "<script>",
      'import { useState } from "leaf";',
      "const [count] = useState(1);",
      "</script>",
      "<p>{count}</p>",
    ].join("\n");
    const compiled = compileLeaf(source, componentName("src/app/[name]/page.leaf"));
    expect(compiled).toMatch(/^import \{ useState \} from "leaf";/);
    expect(compiled).toContain("export const hydrate = true;");
    expect(compiled).toContain("export default function Page(props) {");
    expect(compiled).toContain("const [count] = useState(1);");
    expect(compiled).toContain("return (<><p>{count}</p></>);");
  });
});

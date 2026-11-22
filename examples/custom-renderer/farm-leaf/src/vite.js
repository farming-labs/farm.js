// The Vite plugin Farm adds for this renderer: JSX compiles against leaf's runtime, and `.leaf`
// files compile to modules.

import { transformWithOxc } from "vite";
import { compileLeaf, componentName } from "./compile.js";

const JSX = { runtime: "automatic", importSource: "leaf" };

export function createFarmRendererPlugin() {
  return {
    name: "farm-leaf",
    config() {
      return { oxc: { jsx: JSX } };
    },
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".leaf")) return null;
      const result = await transformWithOxc(compileLeaf(code, componentName(file)), `${file}.tsx`, {
        lang: "tsx",
        jsx: JSX,
        sourcemap: true,
      });
      return { code: result.code, map: result.map };
    },
  };
}

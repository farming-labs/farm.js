// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("emits portable declarations for plugin packages using the published entry points", async () => {
  const root = await fs.mkdtemp(path.join(process.cwd(), ".tmp-plugin-declarations-"));
  try {
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(
      process.cwd(),
      path.join(root, "node_modules", "@farm.js", "core"),
      "junction",
    );
    await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
    const entries = ["@farm.js/core", "@farm.js/core/plugin"].map((entry, index) => ({
      file: path.join(root, `plugin-${index}.ts`),
      source: `import { definePlugin } from ${JSON.stringify(entry)};
export function plain() { return definePlugin({ name: "plain" }); }
export function withRoutes() {
  return definePlugin({ name: "routes", routes: ({ route }) => [
    route.get("/api/uploads/[id]", { handler: (_request, { params }) => ({ id: params.id }) }),
  ] });
}
`,
    }));
    for (const entry of entries) {
      await fs.writeFile(entry.file, entry.source);
      // Check each entry independently: importing core in the same program can
      // accidentally make an unexported plugin type nameable during emit.
      const program = ts.createProgram([entry.file], {
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        outDir: path.join(root, "dist"),
      });
      const output: string[] = [];
      const result = program.emit(undefined, (_file, source) => output.push(source));
      const diagnostics = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics];
      expect(
        diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")),
      ).toEqual([]);
      expect(result.emitSkipped).toBe(false);
      expect(output).toHaveLength(1);
      const source = output[0];
      expect(source).not.toContain("node_modules");
      expect(source).not.toContain("/dist/");
      expect(source).toContain('"/api/uploads/[id]"');
      expect(source).toContain("id: string");
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveImportedModule } from "../utils/client-component";
import { withFarmSourceSnapshot } from "../utils/source-snapshot";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("probes an import path once per plan however many modules import it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-source-candidate-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "app"));
  const importers = ["a.tsx", "b.tsx", "c.tsx"].map((name) => path.join(root, "app", name));
  const stat = vi.spyOn(fs, "statSync");
  const probes = (specifier: string, from: string[]) =>
    withFarmSourceSnapshot(() => {
      const before = stat.mock.calls.length;
      for (const importer of from) resolveImportedModule(importer, specifier, root);
      return stat.mock.calls.length - before;
    });

  expect(probes("./missing", importers)).toBe(probes("./missing", importers.slice(0, 1)));

  // A miss holds for one plan only: the next plan finds a file created after it.
  fs.writeFileSync(path.join(root, "app", "missing.tsx"), "export {};");
  withFarmSourceSnapshot(() => {
    expect(resolveImportedModule(importers[0]!, "./missing", root).path).toBe(
      path.join(root, "app", "missing.tsx"),
    );
  });
});

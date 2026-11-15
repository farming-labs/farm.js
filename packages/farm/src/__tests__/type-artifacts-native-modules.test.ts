import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ modules: 0, specs: 0 }));

vi.mock("../mobile/modules", async (importOriginal) => {
  loaded.modules += 1;
  return importOriginal();
});
vi.mock("../mobile/native-specs", async (importOriginal) => {
  loaded.specs += 1;
  return importOriginal();
});

describe("generateFarmTypeArtifacts and native module specs", () => {
  it("does not load the mobile module code for an app without src/native", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-type-artifacts-native-"));
    mkdirSync(path.join(root, "src", "app"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "app", "page.tsx"),
      "export default function Home() { return null; }\n",
    );

    const { generateFarmTypeArtifacts } = await import("../type-artifacts");
    await generateFarmTypeArtifacts({ root });

    expect(loaded).toEqual({ modules: 0, specs: 0 });
  });
});

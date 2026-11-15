import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";
import { nameCodeSplittingGroups } from "../nitro/universal-build";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function warningCodes(prepare: (config: Record<string, any>) => void): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "farm-code-splitting-"));
  dirs.push(dir);
  await writeFile(join(dir, "dep.mjs"), "export const dep = 1;\n");
  await writeFile(join(dir, "entry.mjs"), 'import { dep } from "./dep.mjs";\nconsole.log(dep);\n');
  const codes: string[] = [];
  // The shape Nitro's Rolldown builder produces for its `_libs` chunks.
  const config: Record<string, any> = {
    input: join(dir, "entry.mjs"),
    onLog(_level: string, log: { code?: string }) {
      if (log.code) codes.push(log.code);
    },
    output: {
      dir: join(dir, "out"),
      codeSplitting: { groups: [{ test: /dep\.mjs/, name: () => "_libs/dep" }] },
    },
  };
  prepare(config);
  const bundle = await rolldown(config);
  await bundle.write(config.output);
  await bundle.close();
  return codes;
}

describe("nameCodeSplittingGroups", () => {
  it("keeps Nitro's function-named chunk groups from warning on every build", async () => {
    expect(await warningCodes(() => {})).toContain("MISSING_CODE_SPLITTING_GROUP_DEBUG_NAME");
    expect(await warningCodes(nameCodeSplittingGroups)).not.toContain(
      "MISSING_CODE_SPLITTING_GROUP_DEBUG_NAME",
    );
  });

  it("leaves named groups, string names, and configs without groups alone", () => {
    const config = {
      output: {
        codeSplitting: {
          groups: [{ name: () => "a", debugName: "mine" }, { name: "vendor" }, { name: () => "b" }],
        },
      },
    };
    nameCodeSplittingGroups(config);
    expect(config.output.codeSplitting.groups.map((group: any) => group.debugName)).toEqual([
      "mine",
      undefined,
      "libs-2",
    ]);
    expect(() => nameCodeSplittingGroups({ output: { codeSplitting: false } })).not.toThrow();
    expect(() => nameCodeSplittingGroups(undefined)).not.toThrow();
  });
});

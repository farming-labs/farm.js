import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

test("project resolution is stable across previews and validates explicit slugs", async () => {
  // Run the source helper in a separate process, including Node 22's explicit TS flag.
  const moduleUrl = new URL("../src/preview-project.ts", import.meta.url).href;
  const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { mkdtemp, writeFile, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import { join, basename } from "node:path";
    import { resolvePreviewProject } from ${JSON.stringify(moduleUrl)};
    delete process.env.FARM_PREVIEW_PROJECT;
    const root = await mkdtemp(join(tmpdir(), "farm-project-"));
    try {
      assert.equal(await resolvePreviewProject({root}), basename(root).toLowerCase());
      await writeFile(join(root, "package.json"), JSON.stringify({name:"@acme/Store"}));
      assert.equal(await resolvePreviewProject({root}), "acme-store");
      process.env.FARM_PREVIEW_PROJECT = "ci-project";
      assert.equal(await resolvePreviewProject({root}), "ci-project");
      assert.equal(await resolvePreviewProject({root,project:"override"}), "override");
      for (const project of ["../app", "UPPER", "", "x".repeat(64)])
        await assert.rejects(resolvePreviewProject({root,project}), /lowercase slug/);
      delete process.env.FARM_PREVIEW_PROJECT;
      await writeFile(join(root, "package.json"), "invalid");
      await assert.rejects(resolvePreviewProject({root}), /package.json/);
      assert.equal(await resolvePreviewProject({root,project:"explicit"}), "explicit");
      console.log("project resolution passed");
    } finally { await rm(root, {recursive:true,force:true}); }
  `]);
  assert.match(stdout, /project resolution passed/);
});

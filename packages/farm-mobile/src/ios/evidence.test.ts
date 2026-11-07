import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const script = fileURLToPath(
  new URL("../../../../examples/mobile/scripts/check-ios-native.mjs", import.meta.url),
);
const roots: string[] = [];
const ready = "[dev.farmjs.mobile.shell:FarmShell] server screen ready: /";
const fallback =
  "[dev.farmjs.mobile.shell:FarmShell] server screen app failed, showing the web screen for /";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function evidence(log: string | null, screen = "server", trail = "server") {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-ios-evidence-"));
  roots.push(root);
  await writeFile(
    path.join(root, "farm-routes.json"),
    JSON.stringify({
      rules: [
        { route: "/trails/[id]", screen: trail },
        { route: "/", screen },
      ],
    }),
  );
  if (log !== null) await writeFile(path.join(root, "app-log.txt"), log);
  return root;
}

describe("iOS native simulator evidence", () => {
  it("accepts the home screen's completion in a compact simulator log", async () => {
    const root = await evidence(
      `Timestamp Ty Process[PID:TID]\n2026-11-06 Df App[1:2] ${ready}\r\n`,
    );
    await expect(exec(process.execPath, [script, root])).resolves.toMatchObject({ stderr: "" });
  });

  it.each([
    ["empty logs", ""],
    ["an unfinished native load", "[dev.farmjs.mobile.shell:FarmShell] tab / native=app\n"],
    ["another route's completion", `${ready}notes\n`],
    ["a different log subsystem", "[other:FarmShell] server screen ready: /\n"],
  ])("rejects %s even without a fallback warning", async (_name, log) => {
    const root = await evidence(log);
    await expect(exec(process.execPath, [script, root])).rejects.toMatchObject({
      stderr: expect.stringContaining("No native completion for the home route"),
    });
  });

  it("rejects a missing log file", async () => {
    const root = await evidence(null);
    await expect(exec(process.execPath, [script, root])).rejects.toMatchObject({
      stderr: expect.stringContaining("ENOENT"),
    });
  });

  it("rejects fallback even when completion is also present", async () => {
    const root = await evidence(`${ready}\n${fallback}\n`);
    await expect(exec(process.execPath, [script, root])).rejects.toMatchObject({
      stderr: expect.stringContaining("fell back to the web screen"),
    });
  });

  it("rejects a home rule that selects the web screen", async () => {
    const root = await evidence(`${ready}\n`, "web");
    await expect(exec(process.execPath, [script, root])).rejects.toMatchObject({
      stderr: expect.stringContaining("The home route must select a server screen"),
    });
  });

  it("accepts every listed route that selects a server screen", async () => {
    const root = await evidence(`${ready}\n`);
    await expect(
      exec(process.execPath, [script, root, "/", "/trails/[id]"]),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it.each([
    ["a listed route that selects the web screen", "web"],
    ["a listed route missing from the manifest", null],
  ])("rejects %s", async (_name, trail) => {
    const root = await evidence(`${ready}\n`, "server", trail ?? "server");
    const route = trail === null ? "/trails/[slug]" : "/trails/[id]";
    await expect(exec(process.execPath, [script, root, route])).rejects.toMatchObject({
      stderr: expect.stringContaining(`The ${route} route must select a server screen`),
    });
  });

  it("checks the same evidence files captured by the simulator workflow", async () => {
    const workflow = await readFile(
      new URL("../../../../.github/workflows/mobile-ios.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain(
      'node "$GITHUB_WORKSPACE/examples/mobile/scripts/check-ios-native.mjs" "$EVIDENCE" $SERVER_ROUTES',
    );
    expect(workflow).toContain(
      'cp .farm/output/mobile/farm-routes.json "$EVIDENCE/farm-routes.json"',
    );
    // Both examples run, each with its own artifact; Trail Guide's trail page is a server screen.
    expect(workflow).toContain("- example: mobile\n");
    expect(workflow).toContain("- example: mobile-minimal\n");
    expect(workflow).toContain('server-routes: "/ /trails/[id]"');
    expect(workflow).toContain("name: mobile-ios-${{ matrix.example }}-${{ github.sha }}");
    expect(workflow).toContain('- "examples/mobile-minimal/**"');
  });
});

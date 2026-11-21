import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSpawnCommand } from "./windows-command.js";

describe("createSpawnCommand", () => {
  it("runs gradlew.bat under a path with spaces as one escaped cmd.exe command line", () => {
    expect(
      createSpawnCommand(
        String.raw`C:\Users\Jane Doe\my app (1)\.farm\output\mobile\android\gradlew.bat`,
        ["assembleDebug"],
        "win32",
      ),
    ).toEqual({
      file: String.raw`C:\Users\Jane^ Doe\my^ app^ ^(1^)\.farm\output\mobile\android\gradlew.bat ^^^"assembleDebug^^^"`,
      args: [],
      shell: true,
    });
  });

  it("escapes cmd.exe metacharacters and quotes in arguments", () => {
    const { file } = createSpawnCommand("C:\\app\\gradlew.bat", ['a & b|c^d%PATH%"e\\'], "win32");
    expect(file).toBe(
      String.raw`C:\app\gradlew.bat ^^^"a^^^ ^^^&^^^ b^^^|c^^^^d^^^%PATH^^^%\^^^"e\\^^^"`,
    );
  });

  it("spawns executables directly, where Node quotes the arguments itself", () => {
    const adb = String.raw`C:\Users\Jane Doe\AppData\Local\Android\Sdk\platform-tools\adb.exe`;
    expect(createSpawnCommand(adb, ["devices"], "win32")).toEqual({ file: adb, args: ["devices"] });
  });

  it("leaves other platforms unchanged", () => {
    expect(createSpawnCommand("/Users/Jane Doe/app/gradlew", ["assembleDebug"], "darwin")).toEqual({
      file: "/Users/Jane Doe/app/gradlew",
      args: ["assembleDebug"],
    });
  });

  it.skipIf(process.platform === "win32")("runs a wrapper from a path with spaces", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "farm mobile gradle "));
    try {
      const wrapper = path.join(dir, "gradlew");
      writeFileSync(wrapper, '#!/bin/sh\nprintf "%s|" "$0" "$@"\n');
      chmodSync(wrapper, 0o755);
      const run = createSpawnCommand(wrapper, ["assembleDebug", "a & b"]);
      expect(execFileSync(run.file, run.args, { encoding: "utf8" })).toBe(
        `${wrapper}|assembleDebug|a & b|`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")(
    "runs a batch file from a path with spaces and parentheses through cmd.exe",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "farm mobile gradle (1) "));
      try {
        // Like gradlew.bat, the batch file hands %* to another program, so cmd.exe parses the
        // arguments a second time there.
        writeFileSync(
          path.join(dir, "print-args.js"),
          "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
        );
        const wrapper = path.join(dir, "gradlew.bat");
        writeFileSync(wrapper, `@"${process.execPath}" "%~dp0print-args.js" %*\r\n`);
        const args = ["assembleDebug", 'a & b|c^d%PATH%"e\\', "(x) <y> z,w;v"];
        const run = createSpawnCommand(wrapper, args);
        const output = execFileSync(run.file, run.args, { encoding: "utf8", shell: run.shell });
        expect(JSON.parse(output)).toEqual(args);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

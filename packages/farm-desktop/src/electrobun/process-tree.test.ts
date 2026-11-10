import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { stopProcessTree } from "./process-tree";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));

function fakeChild(): ChildProcess & { kill: Mock } {
  return {
    pid: 4321,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  } as unknown as ChildProcess & {
    kill: Mock;
  };
}

describe("stopProcessTree", () => {
  afterEach(() => vi.mocked(spawnSync).mockReset());

  it("ends the CLI and the app it launched with taskkill on Windows", () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    const child = fakeChild();
    stopProcessTree(child, "SIGTERM", "win32");
    expect(spawnSync).toHaveBeenCalledWith("taskkill", ["/pid", "4321", "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("still ends the CLI when taskkill cannot run", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: null,
      error: new Error("spawnSync taskkill ENOENT"),
    } as unknown as ReturnType<typeof spawnSync>);
    const child = fakeChild();
    stopProcessTree(child, "SIGTERM", "win32");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does nothing for a process that already exited", () => {
    const child = Object.assign(fakeChild(), { exitCode: 0 });
    stopProcessTree(child, "SIGTERM", "win32");
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "signals the process group on macOS and Linux",
    async () => {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true,
        stdio: "ignore",
      });
      await new Promise((resolve) => child.once("spawn", resolve));
      const exited = new Promise((resolve) =>
        child.once("exit", (_code, signal) => resolve(signal)),
      );
      stopProcessTree(child, "SIGTERM");
      await expect(exited).resolves.toBe("SIGTERM");
      expect(spawnSync).not.toHaveBeenCalled();
    },
  );
});

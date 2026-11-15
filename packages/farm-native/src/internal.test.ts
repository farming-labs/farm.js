import { beforeEach, describe, expect, it, vi } from "vitest";

const modules = vi.hoisted(() => ({ FarmShell: undefined as Record<string, unknown> | undefined }));
vi.mock("react-native", () => ({ NativeModules: modules }));

const { shellSignIn } = await import("./internal");

beforeEach(() => {
  modules.FarmShell = undefined;
});

describe("shellSignIn", () => {
  it("hands the shell the path and the body as JSON, and returns its status and body", async () => {
    const signIn = vi.fn(async () => ({ status: 200, body: '{"user":{"id":"u1"}}' }));
    modules.FarmShell = { signIn };

    const reply = await shellSignIn("/api/auth/sign-in/email", {
      email: "ada@example.com",
      password: "secret",
    });

    expect(signIn).toHaveBeenCalledWith(
      "/api/auth/sign-in/email",
      '{"email":"ada@example.com","password":"secret"}',
    );
    expect(reply).toEqual({ status: 200, body: '{"user":{"id":"u1"}}' });
  });

  it("rejects, calling nothing, without a shell or with one that predates native sign-in", async () => {
    await expect(shellSignIn("/api/auth/sign-in/email", {})).rejects.toThrow(
      "Native sign-in needs the Farm mobile shell",
    );
    modules.FarmShell = { session: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() };
    await expect(shellSignIn("/api/auth/sign-in/email", {})).rejects.toThrow(
      "Native sign-in needs the Farm mobile shell",
    );
  });

  it("passes the shell's rejection through, such as an offline phone", async () => {
    const offline = new Error("The server could not be reached");
    modules.FarmShell = { signIn: vi.fn(async () => Promise.reject(offline)) };
    await expect(shellSignIn("/api/auth/sign-in/email", {})).rejects.toBe(offline);
  });
});

describe("the package surface", () => {
  it("keeps sign-in off the public entry; only the internal subpath has it", async () => {
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, Record<string, string>> };
    expect(manifest.exports["./internal"]?.["react-native"]).toBe("./dist/internal.js");
    const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    expect(index).not.toMatch(/signIn|internal/);
  });
});

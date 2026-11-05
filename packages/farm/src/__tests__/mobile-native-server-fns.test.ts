// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createServerFn } from "../server-fn";
import { handleFarmNativeServerFnRequest } from "../mobile/native-server-fn-handler";
import {
  collectFarmNativeServerFns,
  farmNativeServerFnId,
  findFarmNativeScreenFiles,
} from "../mobile/native-server-fns";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const createNote = createServerFn({
  input: z.object({ title: z.string().min(1) }),
  handler: async ({ input }) => ({ id: "7", title: input.title }),
});
const archived = createServerFn({
  errors: { archived: { status: 409, data: z.object({ id: z.string() }), message: "Archived" } },
  handler: async ({ error }) => error("archived", { id: "7" }),
});
const broken = createServerFn({
  handler: async () => {
    throw new Error("database password is hunter2");
  },
});
const cyclic = createServerFn({
  handler: async () => {
    const value: Record<string, unknown> = { secret: "hunter2" };
    value.self = value;
    return value;
  },
});
const functions: Record<string, unknown> = { create: createNote, archived, broken, cyclic };

function call(body: unknown, headers: Record<string, string> = { "x-farm-mobile": "notes" }) {
  return handleFarmNativeServerFnRequest(
    new Request("https://notes.example.com/api/__farm/native/fn", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { resolve: (id) => functions[id] },
  );
}

describe("the native server function endpoint", () => {
  it("runs the function's own pipeline and answers its result", async () => {
    const response = await call({ id: "create", input: { title: "Creek" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: { id: "7", title: "Creek" } });
    // The input schema runs: the caller's own input comes back as the reason.
    const invalid = await call({ id: "create", input: { title: "" } });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_input");
  });

  it("refuses input with prototype keys, at any depth", async () => {
    for (const input of [
      JSON.parse('{"__proto__":{"admin":true},"title":"x"}'),
      { title: "x", nested: [{ constructor: { prototype: {} } }] },
    ]) {
      const response = await call({ id: "create", input });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_body");
    }
  });

  it("answers declared failures, and hides everything else", async () => {
    const failure = await call({ id: "archived", input: null });
    expect(failure.status).toBe(409);
    expect(await failure.json()).toEqual({
      error: { code: "archived", status: 409, message: "Archived", data: { id: "7" } },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const crash = await call({ id: "broken" });
    expect(crash.status).toBe(500);
    const text = await crash.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text).error).toEqual({
      code: "server_error",
      message: "Server function failed",
    });
    expect(error).toHaveBeenCalledOnce();
    const cycle = await call({ id: "cyclic" });
    expect(cycle.status).toBe(500);
    expect(await cycle.text()).not.toContain("hunter2");
  });

  it("only answers the app's native screens", async () => {
    // A browser sends fetch metadata on every request, and a cross-site page an Origin of its own.
    for (const headers of [
      {},
      { "x-farm-mobile": "notes", "sec-fetch-site": "cross-site" },
      { "x-farm-mobile": "notes", origin: "https://evil.example" },
    ] as Array<Record<string, string>>) {
      const response = await call({ id: "create", input: { title: "x" } }, headers);
      expect(response.status).toBe(403);
    }
    // The mobile session plugin sets the server's own Origin on a signed-in device's request.
    const signedIn = await call(
      { id: "create", input: { title: "x" } },
      { "x-farm-mobile": "notes", origin: "https://notes.example.com" },
    );
    expect(signedIn.status).toBe(200);
    expect((await call({ id: "nope" })).status).toBe(404);
    // `functions` is a plain object: its prototype's names resolve, but only server functions run.
    expect((await call({ id: "constructor" })).status).toBe(404);
    expect((await call({ id: "toString" })).status).toBe(404);
    expect((await call({ id: "../x" })).status).toBe(400);
    const get = await handleFarmNativeServerFnRequest(
      new Request("https://notes.example.com/api/__farm/native/fn"),
      { resolve: () => createNote },
    );
    expect(get.status).toBe(405);
  });
});

describe("the server functions native screens import", () => {
  it("follows each native screen's app imports to the server function modules", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-native-fns-"));
    roots.push(root);
    const files: Record<string, string> = {
      "src/app/notes/page.tsx": "export default function Notes() { return null; }\n",
      "src/app/notes/page.native.tsx": `import { useNotes } from "@/features/notes/hooks";
export default function Notes() { return useNotes(); }
`,
      "src/features/notes/hooks.ts": `import { listNotes } from "./server";
export const useNotes = () => listNotes;
`,
      "src/features/notes/server.ts": `import { createServerFn } from "@farm.js/core/server-fn";
import { secret } from "./secret";
export const listNotes = createServerFn({ handler: async () => [secret] });
export const helper = () => 1;
`,
      "src/features/notes/secret.ts": "export const secret = 'not for phones';\n",
      // A server function no native screen imports is never open to them.
      "src/features/admin/server.ts": `import { createServerFn } from "@farm.js/core/server-fn";
export const wipe = createServerFn({ handler: async () => null });
`,
    };
    for (const [file, source] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), source);
    }
    const entries = findFarmNativeScreenFiles([path.join(root, "src/app")]);
    expect(entries).toEqual([path.join(root, "src/app/notes/page.native.tsx")]);
    const server = path.join(root, "src/features/notes/server.ts");
    expect(collectFarmNativeServerFns({ root, srcDir: "src", entries })).toEqual([
      {
        file: server,
        exports: [{ name: "listNotes", id: farmNativeServerFnId(root, server, "listNotes") }],
      },
    ]);
    // The id names the module by its path from the app root, so it is the same in every build.
    expect(farmNativeServerFnId(root, server, "listNotes")).toMatch(/^[\w-]{20}$/);
    expect(farmNativeServerFnId(root, server, "listNotes")).not.toBe(
      farmNativeServerFnId(root, server, "other"),
    );
  });
});

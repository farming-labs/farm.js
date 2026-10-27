import { describe, expect, it, vi } from "vitest";
import { redirect } from "../navigation-errors";
import {
  FARM_FORM_ACTION_FIELD,
  FARM_FORM_ACTION_HEADER,
  handleFarmFormActionRequest,
  registerFarmFormAction,
} from "../form-actions";
import { resolveServerActionsConfig } from "../server-action-security";
import {
  getFarmFormActionId,
  hasUseServerDirective,
  transformFarmFormActionModule,
} from "../form-actions-transform";

const config = resolveServerActionsConfig(undefined);

function formPost(fields: Record<string, string>, headers: Record<string, string> = {}) {
  const body = new URLSearchParams(fields);
  return new Request("https://app.test/todos?view=all", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://app.test",
      ...headers,
    },
    body,
  });
}

describe("islands-mode server actions", () => {
  it("gives a registered action React's form hook with its id", () => {
    const action = registerFarmFormAction(async () => {}, "add-todo");
    const descriptor = (
      action as unknown as { $$FORM_ACTION: () => { method: string; data: FormData } }
    ).$$FORM_ACTION();
    expect(descriptor.method).toBe("POST");
    expect(descriptor.data.get(FARM_FORM_ACTION_FIELD)).toBe("add-todo");
  });

  it("runs a posted form action and redirects back to the page", async () => {
    const received: FormData[] = [];
    registerFarmFormAction(async (form: FormData) => received.push(form), "form-ok");
    const response = await handleFarmFormActionRequest(
      formPost({ [FARM_FORM_ACTION_FIELD]: "form-ok", title: "Milk" }),
      config,
    );
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/todos?view=all");
    expect(received[0]?.get("title")).toBe("Milk");
    expect(received[0]?.has(FARM_FORM_ACTION_FIELD)).toBe(false);
  });

  it("follows redirect() and leaves other posts to the page", async () => {
    registerFarmFormAction(async () => redirect("/done"), "form-redirect");
    const redirected = await handleFarmFormActionRequest(
      formPost({ [FARM_FORM_ACTION_FIELD]: "form-redirect" }),
      config,
    );
    expect(redirected?.headers.get("location")).toBe("/done");
    expect(await handleFarmFormActionRequest(formPost({ title: "no action" }), config)).toBeNull();
    expect(
      (await handleFarmFormActionRequest(formPost({ [FARM_FORM_ACTION_FIELD]: "missing" }), config))
        ?.status,
    ).toBe(404);
  });

  it("rejects a cross-origin form post before running anything", async () => {
    const action = vi.fn();
    registerFarmFormAction(action, "form-csrf");
    const response = await handleFarmFormActionRequest(
      formPost({ [FARM_FORM_ACTION_FIELD]: "form-csrf" }, { origin: "https://evil.test" }),
      config,
    );
    expect(response?.status).toBe(403);
    expect(action).not.toHaveBeenCalled();
  });

  it("answers a call from a client component with the result", async () => {
    registerFarmFormAction(async (a: number, b: number) => a + b, "rpc-add");
    const response = await handleFarmFormActionRequest(
      new Request("https://app.test/todos", {
        method: "POST",
        headers: {
          [FARM_FORM_ACTION_HEADER]: "rpc-add",
          "content-type": "text/plain;charset=UTF-8",
          origin: "https://app.test",
        },
        body: JSON.stringify([2, 3]),
      }),
      config,
    );
    expect(await response?.json()).toEqual({ result: 5 });
  });
});

describe('the "use server" transform', () => {
  const parse = (code: string) => {
    // Enough of an ESTree for the export shapes the transform reads.
    const body: unknown[] = [];
    for (const match of code.matchAll(/export (?:async )?function (\w+)/g)) {
      body.push({
        type: "ExportNamedDeclaration",
        declaration: { type: "FunctionDeclaration", id: { name: match[1] } },
      });
    }
    return { type: "Program", body };
  };
  const source =
    '"use server";\nexport async function addTodo(form) {}\nexport async function clear() {}\n';

  it("registers every export on the server under a stable id", () => {
    const code = transformFarmFormActionModule({
      code: source,
      id: "/app/src/actions.ts",
      root: "/app",
      ssr: true,
      parse,
    })!;
    expect(code).toContain(source);
    expect(code).toContain(
      `__farm_register_action__(addTodo, ${JSON.stringify(getFarmFormActionId("/app", "/app/src/actions.ts", "addTodo"))});`,
    );
    expect(code).toContain("__farm_register_action__(clear,");
  });

  it("replaces the module with stubs in the browser", () => {
    const code = transformFarmFormActionModule({
      code: source,
      id: "/app/src/actions.ts",
      root: "/app",
      ssr: false,
      parse,
    })!;
    expect(code).not.toContain("async function");
    expect(code).toContain("export const addTodo = __farm_action_stub__(");
    expect(code).toContain("@farm.js/core/internal/form-actions-client");
  });

  it("leaves other modules alone", () => {
    expect(
      transformFarmFormActionModule({
        code: "export async function x() {}",
        id: "/app/a.ts",
        root: "/app",
        ssr: true,
        parse,
      }),
    ).toBeNull();
  });

  it("finds the directive in the prologue only", () => {
    expect(hasUseServerDirective('"use server";\nexport async function a() {}')).toBe(true);
    expect(hasUseServerDirective("\ufeff// note\n/* license */\n'use server'\n")).toBe(true);
    expect(hasUseServerDirective('"use strict";\n"use server";')).toBe(true);
    expect(hasUseServerDirective('import x from "y";\n"use server";')).toBe(false);
    expect(hasUseServerDirective('"use server".length;')).toBe(false);
    expect(hasUseServerDirective('const s = "use server";')).toBe(false);
    expect(hasUseServerDirective("/* unterminated")).toBe(false);
  });

  it("scans a file that opens with many comments in linear time", () => {
    // The first version, a regular expression, took hours here and stalled production builds.
    const code = "/* c */\n".repeat(5000) + "export const value = 1;\n";
    const start = performance.now();
    expect(hasUseServerDirective(code)).toBe(false);
    expect(hasUseServerDirective(code + '"use server";')).toBe(false);
    expect(hasUseServerDirective("/* c */\n".repeat(5000) + '"use server";')).toBe(true);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

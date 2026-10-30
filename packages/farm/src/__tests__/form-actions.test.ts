import { parseSync } from "vite";
import { describe, expect, it, vi } from "vitest";
import { notFound, redirect } from "../navigation-errors";
import {
  FARM_FORM_ACTION_HEADER,
  handleFarmFormActionRequest,
  registerFarmFormAction,
} from "../form-actions";
import {
  getServerActionExecutionContext,
  resolveServerActionsConfig,
} from "../server-action-security";
import {
  getFarmFormActionId,
  hasUseServerDirective,
  transformFarmFormActionModule,
} from "../form-actions-transform";

const config = resolveServerActionsConfig(undefined);

/** A form posting `id` as React writes it for `<form action={fn}>` (islx's fields). */
function formPost(
  id: string | null,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const body = new URLSearchParams(
    id === null ? fields : { $F_REF_R_1_: "", "$F_R_1_:A": id, ...fields },
  );
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

describe("islands-mode server actions (run by islx)", () => {
  it("gives a registered action React's form hook with its id", () => {
    const action = registerFarmFormAction(async () => {}, "add-todo");
    const descriptor = (
      action as unknown as { $$FORM_ACTION: (prefix: string) => { method: string; data: FormData } }
    ).$$FORM_ACTION("R_1_");
    expect(descriptor.method).toBe("POST");
    expect(descriptor.data.get("$F_R_1_:A")).toBe("add-todo");
  });

  it("runs a posted form action in Farm's action context, and redirects back to the page", async () => {
    const received: FormData[] = [];
    let context: unknown;
    registerFarmFormAction(async (form: FormData) => {
      context = getServerActionExecutionContext();
      received.push(form);
    }, "form-ok");
    const response = await handleFarmFormActionRequest(
      formPost("form-ok", { title: "Milk" }),
      config,
    );
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/todos?view=all");
    expect(received[0]?.get("title")).toBe("Milk");
    expect([...received[0]!.keys()]).toEqual(["title"]);
    expect(context).toBeDefined();
  });

  it("follows redirect() and notFound(), and leaves other posts to the page", async () => {
    registerFarmFormAction(async () => redirect("/done"), "form-redirect");
    registerFarmFormAction(async () => notFound(), "form-missing");
    const redirected = await handleFarmFormActionRequest(formPost("form-redirect", {}), config);
    expect(redirected?.headers.get("location")).toBe("/done");
    expect((await handleFarmFormActionRequest(formPost("form-missing", {}), config))?.status).toBe(
      404,
    );
    expect(
      await handleFarmFormActionRequest(formPost(null, { title: "no action" }), config),
    ).toBeNull();
    // An action this deploy does not know: the page loads again.
    expect((await handleFarmFormActionRequest(formPost("missing", {}), config))?.status).toBe(303);
  });

  it("rejects a cross-origin form post before running anything", async () => {
    const action = vi.fn();
    registerFarmFormAction(action, "form-csrf");
    const response = await handleFarmFormActionRequest(
      formPost("form-csrf", {}, { origin: "https://evil.test" }),
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
        body: JSON.stringify({ a: [2, 3] }),
      }),
      config,
    );
    expect(await response?.json()).toEqual({ result: 5 });
  });

  it("applies Farm's body size limit", async () => {
    registerFarmFormAction(async () => "ok", "rpc-big");
    const response = await handleFarmFormActionRequest(
      new Request("https://app.test/todos", {
        method: "POST",
        headers: {
          [FARM_FORM_ACTION_HEADER]: "rpc-big",
          "content-type": "text/plain",
          origin: "https://app.test",
        },
        body: JSON.stringify({ a: ["x".repeat(2000)] }),
      }),
      resolveServerActionsConfig({ bodySizeLimit: 100 }),
    );
    expect(response?.status).toBe(413);
  });
});

describe('the "use server" transform', () => {
  const parse = (code: string) => parseSync("module.tsx", code).program as never;
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
    expect(code).toContain("export async function addTodo(form) {}");
    // islx registers it, reached through Farm (an app needs no dependency of its own).
    expect(code).toContain('from "@farm.js/core/internal/islx-server"');
    expect(code).toContain(
      `$$islx_ref(addTodo, ${JSON.stringify(getFarmFormActionId("/app", "/app/src/actions.ts", "addTodo"))},`,
    );
    expect(code).toContain("$$islx_ref(clear,");
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
    expect(code).toContain("export const addTodo = $$islx_ref(");
    expect(code).toContain("@farm.js/core/internal/islx-client");
  });

  it("hoists an inline action out of a server component", () => {
    const code = transformFarmFormActionModule({
      code: 'export default async function Page() {\n  const list = "inbox";\n  async function add(form) {\n    "use server";\n    return list;\n  }\n  return <form action={add} />;\n}\n',
      id: "/app/src/page.tsx",
      root: "/app",
      ssr: true,
      parse,
    })!;
    expect(code).toContain("const add = $$islx_bind(");
    expect(code).toContain("async function $$islx_action_0([list], form)");
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

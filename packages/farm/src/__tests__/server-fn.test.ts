// @vitest-environment node

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { createServerFn, FARM_SERVER_FN_SYMBOL } from "../server-fn";
import { runWithServerActionRequest } from "../server-action-security";

describe("createServerFn", () => {
  it("validates object input before calling the handler", async () => {
    const handler = vi.fn(async ({ input }: { input: { email: string; password: string } }) => ({
      ok: true,
      email: input.email,
    }));

    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
        password: z.string().min(8),
      }),
      handler,
    });

    const result = await signup({
      email: "ada@example.com",
      password: "correct horse battery staple",
    });

    expect(result).toEqual({ ok: true, email: "ada@example.com" });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          email: "ada@example.com",
          password: "correct horse battery staple",
        },
      }),
    );
    expect(
      (signup as unknown as Record<typeof FARM_SERVER_FN_SYMBOL, boolean>)[FARM_SERVER_FN_SYMBOL],
    ).toBe(true);
  });

  it("turns form data into schema input for form actions", async () => {
    const submitMessage = createServerFn({
      input: z.object({
        name: z.string().min(1),
        message: z.string().min(1),
      }),
      async handler({ input, formData }) {
        return {
          saved: true,
          name: input.name,
          message: input.message,
          hasFormData: formData instanceof FormData,
        };
      },
    });

    const formData = new FormData();
    formData.set("name", "Ada");
    formData.set("message", "Hello from a form");

    await expect(submitMessage(formData)).resolves.toEqual({
      saved: true,
      name: "Ada",
      message: "Hello from a form",
      hasFormData: true,
    });
  });

  it("does not call the handler when validation fails", async () => {
    const handler = vi.fn();
    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
      }),
      handler,
    });

    await expect(signup({ email: "nope" })).rejects.toBeTruthy();
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps repeated form fields as arrays and drops unsafe metadata keys", async () => {
    const inspect = createServerFn({
      handler({ input }) {
        const data = input as Record<string, unknown>;

        return {
          tags: data.tag,
          actionMetadataPresent: Object.prototype.hasOwnProperty.call(data, "$ACTION_ID_123"),
          protoPresent: Object.prototype.hasOwnProperty.call(data, "__proto__"),
          constructorPresent: Object.prototype.hasOwnProperty.call(data, "constructor"),
          polluted: ({} as Record<string, unknown>).polluted,
        };
      },
    });

    const formData = new FormData();
    formData.append("tag", "rsc");
    formData.append("tag", "forms");
    formData.append("$ACTION_ID_123", "secret-action-ref");
    formData.append("__proto__", "polluted");
    formData.append("constructor", "polluted");

    await expect(inspect(formData)).resolves.toEqual({
      tags: ["rsc", "forms"],
      actionMetadataPresent: false,
      protoPresent: false,
      constructorPresent: false,
      polluted: undefined,
    });
  });

  it("allows input-less server functions to be called without an argument", async () => {
    const getMessages = createServerFn({
      async handler() {
        return ["hello"];
      },
    });

    await expect(getMessages()).resolves.toEqual(["hello"]);
    expectTypeOf(getMessages).parameter(0).toEqualTypeOf<unknown | FormData | undefined>();
  });

  it("infers input and response types from the schema and handler", async () => {
    const signup = createServerFn({
      input: z.object({
        email: z.string().email(),
      }),
      async handler({ input }) {
        expectTypeOf(input.email).toEqualTypeOf<string>();
        return { ok: true as const };
      },
    });

    expectTypeOf(signup).parameter(0).toEqualTypeOf<{ email: string } | FormData>();
    expectTypeOf(await signup({ email: "ada@example.com" })).toEqualTypeOf<{ ok: true }>();
  });

  it("provides the action request and cancellation signal to handlers", async () => {
    const controller = new AbortController();
    const request = new Request("https://app.example.com/action", {
      signal: controller.signal,
    });
    const inspect = createServerFn({
      handler({ request: currentRequest, signal }) {
        return {
          request: currentRequest,
          signal,
        };
      },
    });

    const result = await runWithServerActionRequest(request, () => inspect());

    expect(result.request).toBe(request);
    expect(result.signal).toBe(request.signal);
    controller.abort();
    expect(result.signal.aborted).toBe(true);
  });
});

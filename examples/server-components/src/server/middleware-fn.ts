import { createServerFn, createServerMiddleware } from "@farm.js/core/server-fn";
import { z } from "zod";

const session = createServerMiddleware({
  async handler({ request, next }) {
    if (!request) throw new Error("server function middleware needs the request");
    const trace = ["session:before"];
    const result = await next({ context: { method: request.method, trace, user: "contract-user" } });
    trace.push("session:after");
    return result;
  },
});

const permission = createServerMiddleware({
  middleware: [session],
  async handler({ context, next }) {
    context.trace.push("permission:before");
    const result = await next({ context: { permission: "notes:write" as const } });
    context.trace.push("permission:after");
    return result;
  },
});

const audit = createServerMiddleware({
  middleware: [session],
  async handler({ context, next }) {
    context.trace.push("audit:before");
    const result = await next();
    context.trace.push("audit:after");
    return result;
  },
});

export const inspectMiddleware = createServerFn({
  middleware: [permission, audit],
  input: z.object({ message: z.string().trim().min(1) }),
  async handler({ input, context, formData }) {
    context.trace.push("handler");
    return {
      message: input.message,
      user: context.user,
      permission: context.permission,
      method: context.method,
      fromForm: formData instanceof FormData,
      trace: context.trace,
    };
  },
});

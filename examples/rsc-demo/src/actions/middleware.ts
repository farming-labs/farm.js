import { createServerFn, createServerMiddleware } from "@farmjs/core/server-fn";
import { z } from "zod";

const sessionMiddleware = createServerMiddleware({
  async handler({ request, next }) {
    if (!request) {
      throw new Error("Server function middleware requires a request.");
    }

    const trace = ["session:before"];
    const result = await next({
      context: {
        requestMethod: request.method,
        trace,
        user: { id: "middleware-user" },
      },
    });
    trace.push("session:after");
    return result;
  },
});

const permissionMiddleware = createServerMiddleware({
  middleware: [sessionMiddleware],
  async handler({ context, next }) {
    context.trace.push("permission:before");
    const result = await next({ context: { permission: "messages:write" as const } });
    context.trace.push("permission:after");
    return result;
  },
});

const auditMiddleware = createServerMiddleware({
  middleware: [sessionMiddleware],
  async handler({ context, next }) {
    context.trace.push("audit:before");
    const result = await next();
    context.trace.push("audit:after");
    return result;
  },
});

export const inspectServerMiddleware = createServerFn({
  middleware: [permissionMiddleware, auditMiddleware],
  input: z.object({ message: z.string().trim().min(1) }),
  output: z.object({
    message: z.string(),
    userId: z.string(),
    permission: z.literal("messages:write"),
    requestMethod: z.string(),
    fromForm: z.boolean(),
    trace: z.array(z.string()),
  }),
  async handler({ input, context, formData }) {
    context.trace.push("handler");

    return {
      message: input.message,
      userId: context.user.id,
      permission: context.permission,
      requestMethod: context.requestMethod,
      fromForm: formData instanceof FormData,
      trace: context.trace,
    };
  },
});

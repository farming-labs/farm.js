import { createEndpoint } from "@farm.js/core";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

const greetingInput = z.object({
  name: z.string().trim().min(1).max(40),
});

const greetingOutput = z.object({
  message: z.string(),
  invocation: z.number().int().positive(),
  runtime: z.literal("server"),
});

let invocation = 0;

export const createGreeting = createServerFn({
  input: greetingInput,
  output: greetingOutput,
  async handler({ input }) {
    invocation += 1;
    console.log(`[solid-renderer] createServerFn invocation ${invocation}`);

    return {
      message: `Hello, ${input.name}, from the FARMJS server.`,
      invocation,
      runtime: "server" as const,
    };
  },
});

export const greetingEndpoint = createEndpoint(
  "/api/greeting",
  {
    method: "POST",
    body: greetingInput,
  },
  async ({ body }) => createGreeting(body),
);

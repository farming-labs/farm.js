import { createEndpoint } from "@farm.js/core";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

// Everything in this file runs only on the server.

const entrySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  message: z.string(),
  at: z.string(),
});

type Entry = z.infer<typeof entrySchema>;

const entries: Entry[] = [
  {
    id: 1,
    name: "Farm.js",
    message: "This list lives in server memory. Sign it below!",
    at: new Date().toISOString(),
  },
];
let nextId = 2;

const signInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  message: z.string().trim().min(1, "Message is required").max(200),
});

export const signGuestbook = createServerFn({
  input: signInput,
  output: z.object({ entries: z.array(entrySchema) }),
  async handler({ input }) {
    entries.unshift({
      id: nextId++,
      name: input.name,
      message: input.message,
      at: new Date().toISOString(),
    });
    return { entries };
  },
});

export const listEndpoint = createEndpoint(
  "/api/guestbook",
  { method: "GET" },
  async () => ({ entries }),
);

export const signEndpoint = createEndpoint(
  "/api/guestbook",
  { method: "POST", body: signInput },
  async ({ body }) => signGuestbook(body),
);

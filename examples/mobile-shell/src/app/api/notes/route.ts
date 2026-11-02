import { createEndpoint } from "@farm.js/core";
import { z } from "zod";
import { createNote, listNotes } from "../../../lib/notes";

export const GET = createEndpoint("/api/notes", { method: "GET" }, async () => listNotes());

export const POST = createEndpoint(
  "/api/notes",
  {
    method: "POST",
    body: z.object({
      title: z.string().trim().min(1).max(120),
      body: z.string().max(4000).default(""),
    }),
  },
  async ({ body }) => createNote(body),
);

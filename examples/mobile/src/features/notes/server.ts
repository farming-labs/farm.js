import { createEndpoint } from "@farm.js/core";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";
import { addNote, listNotes } from "./store";

const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  updatedAt: z.string(),
});

const noteInput = z.object({
  title: z.string().trim().min(1, "Give the note a title").max(120),
  body: z.string().max(4000).default(""),
});

/** The note form's server function; also callable in process from server code. */
export const createNote = createServerFn({
  input: noteInput,
  output: noteSchema,
  async handler({ input }) {
    return addNote(input);
  },
});

export const listNotesEndpoint = createEndpoint("/api/notes", { method: "GET" }, async () =>
  listNotes(),
);

export const createNoteEndpoint = createEndpoint(
  "/api/notes",
  { method: "POST", body: noteInput },
  async ({ body }) => createNote(body),
);

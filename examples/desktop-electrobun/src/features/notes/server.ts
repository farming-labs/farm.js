import { createEndpoint } from "@farm.js/core";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";
import { appendNote, dataDir, readNotes } from "./store";

const noteSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
});

const notesResponse = z.object({
  notes: z.array(noteSchema),
  runtime: z.object({
    desktop: z.boolean(),
    dataDir: z.string(),
    server: z.string(),
  }),
});

function runtimeInfo() {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  return {
    desktop: Boolean(process.env.FARM_DESKTOP_SECRET),
    dataDir: dataDir(),
    server: bun ? `bun ${bun.version}` : `node ${process.version}`,
  };
}

const saveInput = z.object({
  text: z.string().trim().min(1, "Write something first").max(500),
});

export const saveNote = createServerFn({
  input: saveInput,
  output: notesResponse,
  async handler({ input }) {
    return { notes: await appendNote(input.text), runtime: runtimeInfo() };
  },
});

export const listNotesEndpoint = createEndpoint(
  "/api/notes",
  { method: "GET" },
  async () => ({ notes: await readNotes(), runtime: runtimeInfo() }),
);

export const saveNoteEndpoint = createEndpoint(
  "/api/notes",
  { method: "POST", body: saveInput },
  async ({ body }) => saveNote(body),
);

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appDataDir, platform } from "@farm.js/core/platform";

// Server-only. In the desktop app, notes live in the OS app data directory
// (~/Library/Application Support/<desktop.id>/stable on macOS), never inside
// the app bundle, which is read-only and signed. `farm dev --desktop` uses
// .farm/data/desktop; the web build (`pnpm dev:web`) uses ./.data.

export type Note = { id: string; text: string; createdAt: string };

export function dataDir(): string {
  return platform() === "desktop" ? appDataDir() : join(process.cwd(), ".data");
}

function notesFile(): string {
  return join(dataDir(), "notes.json");
}

export async function readNotes(): Promise<Note[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(notesFile(), "utf8"));
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// One writer at a time, and write-then-rename so a crash never leaves a
// half-written notes.json behind.
let writes: Promise<unknown> = Promise.resolve();

export function appendNote(text: string): Promise<Note[]> {
  const next = writes.then(async () => {
    const notes = await readNotes();
    notes.unshift({ id: crypto.randomUUID(), text, createdAt: new Date().toISOString() });
    await mkdir(dataDir(), { recursive: true });
    const temporary = `${notesFile()}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(notes, null, 2));
    await rename(temporary, notesFile());
    return notes;
  });
  writes = next.catch(() => {});
  return next;
}

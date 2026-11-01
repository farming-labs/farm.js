// Server-only in-memory notes store. Kept on globalThis so page renders and
// API routes share one list even when dev loads them through separate module
// graphs. Restarting the server resets it.

export interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

const STORE = Symbol.for("farm.example.mobile-shell.notes");

type Store = { notes: Note[]; next: number };

function store(): Store {
  const scope = globalThis as typeof globalThis & { [STORE]?: Store };
  scope[STORE] ??= {
    next: 4,
    notes: [
      {
        id: "1",
        title: "Groceries",
        body: "Oat milk, coffee beans, lemons.",
        updatedAt: "2026-10-28T09:12:00.000Z",
      },
      {
        id: "2",
        title: "Shell spike",
        body: "Tabs keep their stacks. Pushes come from a warm WebView pool.",
        updatedAt: "2026-10-29T15:40:00.000Z",
      },
      {
        id: "3",
        title: "Read later",
        body: "Hotwire Native path configuration, Capacitor bridge internals.",
        updatedAt: "2026-10-30T08:05:00.000Z",
      },
    ],
  };
  return scope[STORE];
}

export function listNotes(): Note[] {
  return [...store().notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getNote(id: string): Note | undefined {
  return store().notes.find((note) => note.id === id);
}

export function createNote(input: { title: string; body: string }): Note {
  const state = store();
  const note: Note = {
    id: String(state.next++),
    title: input.title,
    body: input.body,
    updatedAt: new Date().toISOString(),
  };
  state.notes.push(note);
  return note;
}

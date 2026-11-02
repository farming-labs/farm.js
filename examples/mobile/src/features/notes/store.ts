// Server-only, in-memory notes. Kept on globalThis so page renders and API routes share one list
// even when dev loads them through separate module graphs. Restarting the server resets it.

export interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

const STORE = Symbol.for("farm.example.mobile.notes");

type Store = { notes: Note[]; next: number };

function store(): Store {
  const scope = globalThis as typeof globalThis & { [STORE]?: Store };
  scope[STORE] ??= {
    next: 4,
    notes: [
      {
        id: "1",
        title: "Creek crossing",
        body: "Water at the second ford is knee deep after the rain.",
        updatedAt: "2026-10-28T09:12:00.000Z",
      },
      {
        id: "2",
        title: "Ridge camp",
        body: "Flat ground past the cairn, sheltered from the west wind.",
        updatedAt: "2026-10-29T15:40:00.000Z",
      },
      {
        id: "3",
        title: "Supplies",
        body: "Two fuel canisters left, enough oats for four days.",
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

export function addNote(input: { title: string; body: string }): Note {
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

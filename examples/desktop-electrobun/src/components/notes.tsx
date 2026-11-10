"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";

type Note = { id: string; text: string; createdAt: string };
type Runtime = { desktop: boolean; dataDir: string; server: string };

export function Notes() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.notes.get().then((result) => {
      if (result.data) {
        setNotes(result.data.notes);
        setRuntime(result.data.runtime);
      } else {
        setError(result.error?.message ?? "Could not load notes.");
      }
    });
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get("text") ?? "");
    setPending(true);
    setError(null);

    const result = await apiClient.notes.post({ body: { text } });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "The server rejected that note.");
      return;
    }
    if (result.data) {
      setNotes(result.data.notes);
      setRuntime(result.data.runtime);
      form.reset();
    }
  }

  return (
    <section className="notes">
      <p className="shell" data-testid="shell">
        {runtime === null
          ? "Connecting to the server…"
          : runtime.desktop
            ? `Running in the desktop shell (${runtime.server}). Notes are saved to ${runtime.dataDir}`
            : `Running in a browser (${runtime.server}). Notes are saved to ${runtime.dataDir}`}
      </p>

      <form onSubmit={handleSubmit} className="note-form">
        <input name="text" required maxLength={500} placeholder="Write a note…" />
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save note"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <ul className="note-list" data-testid="notes">
        {notes === null ? (
          <li className="muted">Loading notes…</li>
        ) : notes.length === 0 ? (
          <li className="muted">No notes yet.</li>
        ) : (
          notes.map((note) => (
            <li key={note.id}>
              <span>{note.text}</span>
              <time dateTime={note.createdAt}>
                {new Date(note.createdAt).toLocaleString()}
              </time>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

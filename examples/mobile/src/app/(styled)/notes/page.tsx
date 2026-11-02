import type { Metadata } from "@farm.js/core";
import { Link } from "@farm.js/core/client";
import { listNotes } from "../../../features/notes/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notes" };

export default function NotesPage() {
  const notes = listNotes();
  return (
    <>
      <h1 className="page-title">Notes</h1>
      <ul className="list" data-testid="notes">
        {notes.map((note) => (
          <li key={note.id}>
            <Link className="row" href={`/notes/${note.id}`}>
              <strong>{note.title}</strong>
              <span>{note.body}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="actions">
        <Link className="button" href="/notes/new" data-testid="new-note">
          New note
        </Link>
      </div>
    </>
  );
}

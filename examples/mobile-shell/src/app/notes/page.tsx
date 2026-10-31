import type { Metadata } from "@farm.js/core";
import { Link } from "@farm.js/core/client";
import { listNotes } from "../../lib/notes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage() {
  const notes = listNotes();
  return (
    <>
      <h1 className="page-title">Notes</h1>
      <ul className="list">
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
        <Link className="button" href="/notes/new">
          New note
        </Link>
        <a className="button secondary" href="https://farmjs.dev">
          farmjs.dev
        </a>
      </div>
    </>
  );
}

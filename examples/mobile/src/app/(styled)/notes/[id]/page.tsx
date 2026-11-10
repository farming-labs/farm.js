import type { Metadata, PageProps } from "@farm.js/core";
import { Link } from "@farm.js/core/client";
import { getNote, listNotes } from "../../../../features/notes/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return { title: getNote(String(params?.id))?.title ?? "Note" };
}

export default function NotePage({ params }: PageProps) {
  const note = getNote(String(params?.id));
  if (!note) {
    return (
      <>
        <h1 className="page-title">Not found</h1>
        <p className="meta">No note with id {String(params?.id)}.</p>
      </>
    );
  }
  const notes = listNotes();
  const next = notes[(notes.findIndex((item) => item.id === note.id) + 1) % notes.length];
  return (
    <>
      <h1 className="page-title" data-testid="note-title">
        {note.title}
      </h1>
      <div className="card">
        <p>{note.body}</p>
        <p className="meta">Updated {new Date(note.updatedAt).toUTCString()}</p>
      </div>
      <div className="actions">
        {next && next.id !== note.id ? (
          // Another push on the same tab: stacks grow per tab.
          <Link className="button" href={`/notes/${next.id}`}>
            Next: {next.title}
          </Link>
        ) : null}
        <Link className="button secondary" href="/settings">
          Settings tab
        </Link>
      </div>
    </>
  );
}

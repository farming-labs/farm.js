import type { Metadata } from "@farm.js/core";
import { NewNoteForm } from "./new-note-form";

export const metadata: Metadata = { title: "New note" };

export default function NewNotePage() {
  return (
    <>
      <h1 className="web-only">New note</h1>
      <NewNoteForm />
    </>
  );
}

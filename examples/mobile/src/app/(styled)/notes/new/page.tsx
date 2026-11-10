import type { Metadata } from "@farm.js/core";
import type { FarmMobilePageConfig } from "@farm.js/core/mobile";
import { NewNoteForm } from "./new-note-form";

// Read at build time without running the page: the shell presents /notes/new as a modal.
export const mobile = { presentation: "modal" } satisfies FarmMobilePageConfig;

export const metadata: Metadata = { title: "New note" };

export default function NewNotePage() {
  return (
    <>
      <h1 className="page-title">New note</h1>
      <NewNoteForm />
    </>
  );
}

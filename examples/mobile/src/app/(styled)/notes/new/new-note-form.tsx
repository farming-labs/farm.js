"use client";

import { navigateTo } from "@farm.js/core/client";
import { useState } from "react";
import { apiClient } from "../../../../lib/api";

export function NewNoteForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    // POST /api/notes runs the createNote server function.
    const result = await apiClient.notes.post({
      body: { title: String(form.get("title") ?? ""), body: String(form.get("body") ?? "") },
    });
    setPending(false);
    if (result.error || !result.data) {
      setError(result.error?.message ?? "Could not save the note.");
      return;
    }
    // In the shell this is a visit: the navigator closes the modal and pushes the note on the
    // tab underneath. In a browser it is an ordinary client navigation.
    await navigateTo(`/notes/${result.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} data-testid="note-form">
      <label>
        Title
        <input name="title" required maxLength={120} autoComplete="off" />
      </label>
      <label>
        Body
        <textarea name="body" maxLength={4000} />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </button>
    </form>
  );
}

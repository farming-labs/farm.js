"use client";

import { navigateTo } from "@farm.js/core/client";
import { useState } from "react";
import { apiClient } from "../../../lib/api";
import { native } from "../../../lib/native";

export function NewNoteForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await apiClient.notes.post({
      body: { title: String(form.get("title") ?? ""), body: String(form.get("body") ?? "") },
    });
    setPending(false);
    if (result.error || !result.data) {
      setError(result.error?.message ?? "Could not save the note.");
      return;
    }
    native.haptics.impact("medium").catch(() => {});
    // In the shell this becomes a visit: the navigator dismisses the modal and
    // pushes the new note. In a browser it is an ordinary client navigation.
    await navigateTo(`/notes/${result.data.id}`);
  }

  return (
    <form onSubmit={onSubmit}>
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

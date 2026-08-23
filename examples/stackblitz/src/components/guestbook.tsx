"use client";

import { useEffect, useState } from "react";
import { createAPIClient } from "@farm.js/core/client";
import type { APIRouter } from "../lib/api.generated";

const api = createAPIClient<APIRouter>();

type Entry = { id: number; name: string; message: string; at: string };

export function Guestbook() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.guestbook.get().then((result) => {
      if (result.data) setEntries(result.data.entries);
    });
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setError(null);

    const result = await api.guestbook.post({
      body: {
        name: String(formData.get("name") ?? ""),
        message: String(formData.get("message") ?? ""),
      },
    });

    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "The server rejected that entry.");
      return;
    }
    if (result.data) {
      setEntries(result.data.entries);
      form.reset();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            name="name"
            required
            placeholder="Your name"
            className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40 sm:w-40"
          />
          <input
            name="message"
            required
            placeholder="Say hello…"
            className="flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85 disabled:opacity-50"
        >
          {pending ? "Signing…" : "Sign guestbook"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      <ul className="flex flex-col gap-2">
        {entries === null ? (
          <li className="text-sm text-neutral-500">Loading entries…</li>
        ) : (
          entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md bg-white/5 px-3 py-2 text-sm"
            >
              <span className="font-medium">{entry.name}</span>{" "}
              <span className="text-neutral-400">{entry.message}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

"use client";

import { db } from "@farm.js/sync/client";
import { useLiveQuery } from "@farm.js/sync/react";
import { useState } from "react";

type Task = {
  id: string;
  title: string;
  status: "open" | "done";
  listId: string;
  updatedAt?: string;
};

export default function LocalFirstPage() {
  const [title, setTitle] = useState("");
  const tasks = db.tasks;

  const open = useLiveQuery<Task>(tasks, (task) => task.status === "open", {
    orderBy: (task) => task.updatedAt ?? "",
    direction: "desc",
  });
  const done = useLiveQuery<Task>(tasks, (task) => task.status === "done");

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Local-first tasks</h1>
        <p style={styles.sub}>
          Writes apply instantly, survive a reload, and queue while offline.
        </p>
      </header>

      <div style={styles.statusRow} data-testid="status">
        <Badge label="status" value={open.status} />
        <Badge label="in flight" value={String(open.pending)} />
        <Badge label="waiting for network" value={String(open.paused)} />
      </div>

      {open.paused > 0 && (
        <p style={styles.offline} role="status">
          Offline — {open.paused} change(s) will send when the connection returns.
        </p>
      )}

      <form
        style={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const value = title.trim();
          if (!value) return;
          // Fire and forget: the optimistic row is the feedback.
          tasks.insert({ title: value, status: "open" });
          setTitle("");
        }}
      >
        <input
          style={styles.input}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task"
          aria-label="Task title"
          data-testid="new-task"
        />
        <button style={styles.primary} type="submit">
          Add
        </button>
      </form>

      <section>
        <h2 style={styles.h2}>Open ({open.rows.length})</h2>
        {open.status === "loading" && open.isEmpty ? (
          <p style={styles.muted}>Loading…</p>
        ) : open.isEmpty ? (
          <p style={styles.muted}>Nothing open.</p>
        ) : (
          <ul style={styles.list} data-testid="open-list">
            {open.rows.map((task) => (
              <li key={task.id} style={styles.item}>
                <span>{task.title}</span>
                <span style={styles.actions}>
                  <button
                    style={styles.secondary}
                    onClick={() => tasks.update({ id: task.id, status: "done" })}
                  >
                    Done
                  </button>
                  <button style={styles.danger} onClick={() => tasks.delete({ id: task.id })}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={styles.h2}>Done ({done.rows.length})</h2>
        <ul style={styles.list} data-testid="done-list">
          {done.rows.map((task) => (
            <li key={task.id} style={{ ...styles.item, opacity: 0.6 }}>
              <span style={{ textDecoration: "line-through" }}>{task.title}</span>
              <button
                style={styles.secondary}
                onClick={() => tasks.update({ id: task.id, status: "open" })}
              >
                Reopen
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span style={styles.badge}>
      <strong>{label}</strong> {value}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "2.5rem 1.25rem",
    fontFamily: "system-ui, sans-serif",
  },
  header: { marginBottom: "1.5rem" },
  h1: { fontSize: "1.75rem", margin: 0 },
  h2: { fontSize: "1rem", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.6 },
  sub: { margin: "0.35rem 0 0", opacity: 0.7 },
  statusRow: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" },
  badge: {
    fontSize: "0.75rem",
    padding: "0.25rem 0.6rem",
    borderRadius: 999,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
  },
  offline: {
    padding: "0.6rem 0.9rem",
    borderRadius: 8,
    background: "#fef3c7",
    border: "1px solid #fcd34d",
    marginBottom: "1rem",
  },
  form: { display: "flex", gap: "0.5rem", marginBottom: "2rem" },
  input: {
    flex: 1,
    padding: "0.6rem 0.75rem",
    borderRadius: 8,
    border: "1px solid #cbd5f5",
    fontSize: "1rem",
  },
  primary: {
    padding: "0.6rem 1.1rem",
    borderRadius: 8,
    border: "none",
    background: "#2563eb",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondary: {
    padding: "0.35rem 0.7rem",
    borderRadius: 6,
    border: "1px solid #cbd5f5",
    background: "white",
    cursor: "pointer",
  },
  danger: {
    padding: "0.35rem 0.7rem",
    borderRadius: 6,
    border: "1px solid #fecaca",
    background: "white",
    color: "#b91c1c",
    cursor: "pointer",
  },
  list: { listStyle: "none", padding: 0, margin: "0 0 1.5rem", display: "grid", gap: "0.5rem" },
  item: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.65rem 0.85rem",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
  },
  actions: { display: "flex", gap: "0.4rem" },
  muted: { opacity: 0.6 },
};

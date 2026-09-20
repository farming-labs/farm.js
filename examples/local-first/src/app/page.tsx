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
    <main className="landing-main">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span>00</span>
            <span>FARMJS / Local-first</span>
          </div>

          <h1>
            Writes land in <code>the browser</code> first.
          </h1>

          <p className="hero-lede">
            Rows render from the local store, edits apply before the server answers, and changes
            made offline queue until the connection returns.
          </p>

          <div className="status-strip" aria-live="polite" data-testid="status">
            <span className="status-item">
              <b>status</b>
              <span>{open.status}</span>
            </span>
            <span className="status-separator">/</span>
            <span className="status-item">
              <b>in flight</b>
              <span>{open.pending}</span>
            </span>
            <span className="status-separator">/</span>
            <span className="status-item">
              <b>queued</b>
              <span>{open.paused}</span>
            </span>
          </div>

          {open.paused > 0 && (
            <p className="offline-note" role="status">
              Offline — {open.paused} change(s) will send when the connection returns.
            </p>
          )}

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const value = title.trim();
              if (!value) return;
              // Fire and forget: the optimistic row is the feedback.
              tasks.insert({ title: value, status: "open" });
              setTitle("");
            }}
          >
            <span>01</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add a task"
              aria-label="Task title"
              data-testid="new-task"
            />
            <button type="submit">Add</button>
          </form>

          <h2 className="list-heading">
            <span>02</span>
            <span>Open ({open.rows.length})</span>
          </h2>

          {open.status === "loading" && open.isEmpty ? (
            <p className="empty-note">Loading…</p>
          ) : open.isEmpty ? (
            <p className="empty-note">Nothing open.</p>
          ) : (
            <ul className="task-list" data-testid="open-list">
              {open.rows.map((task, index) => (
                <li key={task.id} className="task-row">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span className="task-title">{task.title}</span>
                  <span className="task-actions">
                    <button onClick={() => tasks.update({ id: task.id, status: "done" })}>
                      Done
                    </button>
                    <button onClick={() => tasks.delete({ id: task.id })}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="list-heading">
            <span>03</span>
            <span>Done ({done.rows.length})</span>
          </h2>

          {done.isEmpty ? (
            <p className="empty-note">Nothing done yet.</p>
          ) : (
            <ul className="task-list" data-testid="done-list">
              {done.rows.map((task, index) => (
                <li key={task.id} className="task-row is-done">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span className="task-title">{task.title}</span>
                  <span className="task-actions">
                    <button onClick={() => tasks.update({ id: task.id, status: "open" })}>
                      Reopen
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

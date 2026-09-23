"use client";

import { useLiveQuery, useSyncAction } from "@farm.js/sync/react";
import { useState } from "react";
import { completeTask } from "../actions";

export default function LocalFirstPage() {
  const [title, setTitle] = useState("");

  // The model name is typed against the generated farm.d.ts: a wrong name or
  // a wrong field here is a compile error, and `task` infers the row type.
  const open = useLiveQuery("tasks", (task) => task.status === "open", {
    orderBy: (task) => task.updatedAt ?? "",
    direction: "desc",
  });
  const done = useLiveQuery("tasks", (task) => task.status === "done");

  /**
   * A transition the server rules on: only an open task may complete. The
   * optimistic patch shows the result instantly; a refusal rolls the row
   * back and lands in the failures queue below.
   */
  const complete = useSyncAction(completeTask, "tasks", {
    optimistic: { status: "done" },
  });

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
              <span>{open.queued}</span>
            </span>
          </div>

          {/* A write the server refused is rolled back on screen. The queue
              keeps the reason and the input until the user retries or lets
              it go, so nothing vanishes silently. */}
          {open.failures.map((failure) => (
            <p key={failure.id} className="offline-note" role="alert" data-testid="error">
              Write failed — {failure.error.message}{" "}
              <button onClick={() => failure.retry()}>Retry</button>{" "}
              <button onClick={() => failure.dismiss()}>Dismiss</button>
            </p>
          ))}

          {open.queued > 0 && (
            <p className="offline-note" role="status">
              Offline — {open.queued} change(s) will send when the connection returns.
            </p>
          )}

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const value = title.trim();
              if (!value) return;
              // Fire and forget: the optimistic row is the feedback.
              open.insert({ title: value, status: "open" });
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
                <li
                  key={task.id}
                  className="task-row"
                  // A row still waiting on the server renders dimmed; it turns
                  // solid the moment the write is durably persisted.
                  style={open.isPersisted(task) ? undefined : { opacity: 0.55 }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span className="task-title">{task.title}</span>
                  <span className="task-actions">
                    <button onClick={() => complete({ id: task.id })}>Done</button>
                    <button onClick={() => open.delete(task.id)}>Delete</button>
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
                <li
                  key={task.id}
                  className="task-row is-done"
                  style={done.isPersisted(task) ? undefined : { opacity: 0.55 }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span className="task-title">{task.title}</span>
                  <span className="task-actions">
                    <button onClick={() => done.update(task.id, { status: "open" })}>Reopen</button>
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

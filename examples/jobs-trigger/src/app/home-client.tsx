"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../lib/api.client";

type TaskMetadata = Awaited<ReturnType<typeof apiClient.jobs.tasks.list>>["data"] extends infer T
  ? T extends Array<infer TItem>
    ? TItem
    : never
  : never;

export function HomeClient() {
  const [pending, setPending] = useState(false);
  const [batchPending, setBatchPending] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [tasksPending, setTasksPending] = useState(true);
  const [tasks, setTasks] = useState<TaskMetadata[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [handleId, setHandleId] = useState<string>("");
  const [statusBody, setStatusBody] = useState<unknown>(null);

  useEffect(() => {
    let canceled = false;

    async function loadTasks() {
      try {
        const result = await apiClient.jobs.tasks.list();

        if (canceled) {
          return;
        }

        if (result.error) {
          setMessage(result.error.message);
          return;
        }

        setTasks(result.data || []);
      } catch (error) {
        if (!canceled) {
          setMessage(error instanceof Error ? error.message : "Failed to load task metadata.");
        }
      } finally {
        if (!canceled) {
          setTasksPending(false);
        }
      }
    }

    void loadTasks();

    return () => {
      canceled = true;
    };
  }, []);

  async function triggerTask() {
    setPending(true);
    setMessage(null);

    try {
      const result = await apiClient.jobs.farmjsSanityCheck.schedule({
        body: {
          ping: true,
          $schedule: {
            after: "15s",
            debounce: {
              key: "farmjs-sanity-browser",
              delay: "10s",
            },
            tags: ["demo", "browser-trigger"],
          },
        },
      });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      setHandleId(result.data?.handleId || "");
      setStatusBody(result.data ?? null);
      setMessage("Scheduled a Trigger run for about 15 seconds from now. No webhook is required for this demo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to schedule the Trigger run.");
    } finally {
      setPending(false);
    }
  }

  async function triggerBatch() {
    setBatchPending(true);
    setMessage(null);

    try {
      const result = await apiClient.jobs.farmjsSanityCheck.batchTrigger({
        body: {
          items: [
            {
              ping: true,
              $options: {
                idempotencyKey: "batch-sanity-1",
                tags: ["batch", "first"],
              },
            },
            {
              ping: true,
              $options: {
                idempotencyKey: "batch-sanity-2",
                tags: ["batch", "second"],
              },
            },
            {
              ping: false,
              $options: {
                idempotencyKey: "batch-sanity-3",
                tags: ["batch", "third"],
              },
            },
          ],
        },
      });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      setHandleId(result.data?.runs[0]?.handleId || "");
      setStatusBody(result.data ?? null);
      setMessage("Queued a batch of runs. This is optional fan-out automation, not required for scheduling.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to batch trigger the runs.");
    } finally {
      setBatchPending(false);
    }
  }

  async function refreshStatus() {
    if (!handleId) {
      setMessage("Trigger a run first so we have a handle id to poll.");
      return;
    }

    setStatusPending(true);
    setMessage(null);
    try {
      const result = await apiClient.jobs.farmjsSanityCheck.status({
        query: {
          handleId,
        },
      });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      setStatusBody(result.data ?? null);
      setMessage("Fetched the latest provider status for the current handle.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to fetch the provider status.");
    } finally {
      setStatusPending(false);
    }
  }

  return (
    <section className="stack">
      <section className="panel">
        <h2>Scheduled Trigger Demo</h2>
        <p>
          The main button schedules one delayed run and polls it by <code>handleId</code>. You do
          not need webhooks for this demo because the page checks status directly.
        </p>
        <div className="actions">
          <button onClick={() => void triggerTask()} type="button" disabled={pending}>
            {pending ? "Scheduling..." : "Schedule run in 15s"}
          </button>
          <button
            className="secondary"
            onClick={() => void triggerBatch()}
            type="button"
            disabled={batchPending}
          >
            {batchPending ? "Batching..." : "Queue 3 extra runs"}
          </button>
          <button
            className="secondary"
            onClick={() => void refreshStatus()}
            type="button"
            disabled={statusPending}
          >
            {statusPending ? "Checking..." : "Refresh status"}
          </button>
        </div>
        {message ? <div className="status">{message}</div> : null}
        {handleId ? (
          <div className="status">
            <strong>Handle ID:</strong> <code>{handleId}</code>
          </div>
        ) : null}
        {statusBody ? <pre>{JSON.stringify(statusBody, null, 2)}</pre> : null}
      </section>

      <section className="grid">
        {tasksPending ? <div className="status">Loading task metadata...</div> : null}
        {tasks.map((task) => (
          <article className="task-card" key={task.key}>
            <h3>{task.key}</h3>
            <ul className="task-list">
              <li>
                <strong>remoteId:</strong> <code>{task.remoteId}</code>
              </li>
              <li>
                <strong>trigger path:</strong> <code>{task.paths.trigger}</code>
              </li>
              <li>
                <strong>schedule path:</strong> <code>{task.paths.schedule}</code>
              </li>
              <li>
                <strong>batch path:</strong> <code>{task.paths.batchTrigger}</code>
              </li>
              <li>
                <strong>configured:</strong> {task.configured ? "yes" : "missing env"}
              </li>
            </ul>
          </article>
        ))}
      </section>
    </section>
  );
}

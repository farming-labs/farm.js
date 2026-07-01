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
      const result = await apiClient.jobs.importCsv.trigger({
        body: {
          fileId: "file_123",
        },
      });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      setHandleId(result.data?.handleId || "");
      setStatusBody(result.data ?? null);
      setMessage("Inngest accepted the event and returned the event handle.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to trigger the Inngest event.");
    } finally {
      setPending(false);
    }
  }

  async function triggerBatch() {
    setBatchPending(true);
    setMessage(null);

    try {
      const result = await apiClient.jobs.importCsv.batchTrigger({
        body: {
          items: [
            {
              fileId: "file_101",
            },
            {
              fileId: "file_102",
            },
            {
              fileId: "file_103",
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
      setMessage("Inngest accepted the batch fan-out. The first event handle is ready to poll.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to batch trigger the events.");
    } finally {
      setBatchPending(false);
    }
  }

  async function refreshStatus() {
    if (!handleId) {
      setMessage("Trigger a run first so we have an event handle to poll.");
      return;
    }

    setStatusPending(true);
    setMessage(null);
    try {
      const result = await apiClient.jobs.importCsv.status({
        query: {
          handleId,
        },
      });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      setStatusBody(result.data ?? null);
      setMessage("Fetched the latest Inngest run record for the current event handle.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to fetch the Inngest status.");
    } finally {
      setStatusPending(false);
    }
  }

  return (
    <section className="stack">
      <section className="panel">
        <h2>Live Inngest Probe</h2>
        <p>
          This uses <code>apiClient.jobs.importCsv.trigger(...)</code> and then resolves status
          from the returned event handle.
        </p>
        <div className="actions">
          <button onClick={() => void triggerTask()} type="button" disabled={pending}>
            {pending ? "Triggering..." : "Trigger importCsv"}
          </button>
          <button
            className="secondary"
            onClick={() => void triggerBatch()}
            type="button"
            disabled={batchPending}
          >
            {batchPending ? "Batching..." : "Batch trigger 3 events"}
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
                <strong>schedule:</strong> {task.capabilities.schedule ? "supported" : "not supported"}
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

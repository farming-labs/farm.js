import { api } from "../lib/api.server";
import { selectedJobsRuntime } from "../lib/integrations";

const triggerSnippet = `const queued = await api.jobs.sendWelcomeEmail.trigger({
  body: {
    userId: "usr_123",
    $options: {
      delay: "10m",
      tags: ["signup"],
    },
  },
});

const status = await api.jobs.sendWelcomeEmail.status({
  query: { handleId: queued.data!.handleId },
});`;

const inngestSnippet = `const queued = await api.jobs.importCsv.trigger({
  body: {
    fileId: "file_123",
  },
});

const status = await api.jobs.importCsv.status({
  query: { handleId: queued.data!.handleId },
});`;

export default async function HomePage() {
  const result = await api.jobs.tasks.list();
  const tasks = result.data || [];

  return (
    <main>
      <section className="hero">
        <span className="eyebrow">Jobs Integration</span>
        <h1>Typed background work with a runtime-specific backend.</h1>
        <p>
          This example keeps the public Farm API small: one <code>jobs(...)</code>{" "}
          integration entry, one runtime block, and a typed task map. The selected runtime
          for this app is <code>{selectedJobsRuntime}</code>.
        </p>

        <div className="meta">
          <div className="meta-card">
            <span className="meta-label">Mounted Runtime</span>
            <strong>{selectedJobsRuntime}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Typed Caller</span>
            <strong>
              <code>api.jobs.*</code>
            </strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Metadata Route</span>
            <strong>
              <code>api.jobs.tasks.list()</code>
            </strong>
          </div>
        </div>
      </section>

      <section className="stack">
        <div className="task-grid">
          {tasks.map((task) => (
            <article className="task-card" key={task.key}>
              <span className="task-label">{task.runtime}</span>
              <h3>{task.key}</h3>
              <p>{task.description || "No description provided."}</p>
              <ul className="task-list">
                <li>
                  <strong>ID:</strong> <code>{task.id}</code>
                </li>
                <li>
                  <strong>Remote:</strong> <code>{task.remoteId}</code>
                </li>
                <li>
                  <strong>Trigger route:</strong> <code>{task.paths.trigger}</code>
                </li>
                <li>
                  <strong>Status route:</strong> <code>{task.paths.status}</code>
                </li>
                <li>
                  <strong>Configured:</strong> {task.configured ? "yes" : "missing env"}
                </li>
              </ul>
            </article>
          ))}
        </div>

        <article className="code-card">
          <span className="task-label">Server Usage</span>
          <pre>{selectedJobsRuntime === "inngest" ? inngestSnippet : triggerSnippet}</pre>
        </article>
      </section>
    </main>
  );
}

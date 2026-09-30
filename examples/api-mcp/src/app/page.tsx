import { projects } from "../lib/projects";

const tools = [
  {
    name: "list_projects",
    route: "GET /api/projects",
    input: "query.status?",
    mode: "READ",
  },
  {
    name: "create_project",
    route: "POST /api/projects",
    input: "body.name + status",
    mode: "WRITE",
  },
] as const;

export default function HomePage() {
  return (
    <div className="workspace">
      <header>
        <div>
          <p className="eyebrow">@farm.js/mcp · experimental</p>
          <h1>Your typed API is the tool.</h1>
          <p className="lede">
            Expose only the Farm routes you choose. MCP supplies the protocol; your existing
            validation, middleware, request context, and handlers stay authoritative.
          </p>
        </div>
        <div className="endpoint" aria-label="MCP endpoint">
          <span className="status-dot" aria-hidden="true" />
          <span>POST</span>
          <code>/api/mcp</code>
        </div>
      </header>

      <section className="flow" aria-label="MCP request flow">
        <article>
          <span className="step">01</span>
          <p className="label">Agent</p>
          <h2>Calls a named tool</h2>
          <code>tools/call</code>
        </article>
        <span className="connector" aria-hidden="true">→</span>
        <article className="active-step">
          <span className="step">02</span>
          <p className="label">Farm boundary</p>
          <h2>Authenticates + maps</h2>
          <code>mcp: {`{ authorize }`}</code>
        </article>
        <span className="connector" aria-hidden="true">→</span>
        <article>
          <span className="step">03</span>
          <p className="label">Typed endpoint</p>
          <h2>Validates + executes</h2>
          <code>createEndpoint()</code>
        </article>
      </section>

      <section className="data-grid">
        <div className="tool-surface">
          <div className="section-heading">
            <div>
              <p className="label">Explicit route opt-ins</p>
              <h2>Advertised tools</h2>
            </div>
            <span className="count">{tools.length} tools</span>
          </div>
          <div className="tool-list">
            {tools.map((tool) => (
              <article className="tool-row" key={tool.name}>
                <span className={`mode mode-${tool.mode.toLowerCase()}`}>{tool.mode}</span>
                <div>
                  <h3>{tool.name}</h3>
                  <code>{tool.route}</code>
                </div>
                <span className="input-shape">{tool.input}</span>
              </article>
            ))}
          </div>
        </div>

        <div className="project-surface">
          <div className="section-heading">
            <div>
              <p className="label">Live route data</p>
              <h2>Projects</h2>
            </div>
            <span className="count">{projects.length} records</span>
          </div>
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <span className="project-mark">{project.name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <strong>{project.name}</strong>
                  <code>{project.id}</code>
                </div>
                <span className={`project-status status-${project.status}`}>{project.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="command" aria-label="Example MCP request">
        <div>
          <p className="label">Try the transport</p>
          <h2>One authenticated Streamable HTTP endpoint</h2>
        </div>
        <pre><code>{`curl http://localhost:3000/api/mcp \\
  -H 'Authorization: Bearer demo-token' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</code></pre>
      </section>
    </div>
  );
}

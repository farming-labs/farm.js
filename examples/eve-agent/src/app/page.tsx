"use client";

import { useEveAgent } from "eve/react";
import { type FormEvent, useState } from "react";

export default function Page() {
  const agent = useEveAgent();
  const [message, setMessage] = useState("");
  const isBusy = agent.status === "submitted" || agent.status === "streaming";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = message.trim();
    if (!value || isBusy) return;
    setMessage("");
    await agent.send({ message: value });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="product">Farm + Eve</span>
          <h1>Support agent</h1>
        </div>
        <span className={`status status-${agent.status}`}>{agent.status}</span>
      </header>

      <section className="conversation" aria-live="polite">
        {agent.data.messages.length === 0 ? (
          <div className="empty">
            <p>What can I help you ship today?</p>
          </div>
        ) : (
          agent.data.messages.map((entry) => (
            <article className={`message message-${entry.role}`} key={entry.id}>
              <strong>{entry.role === "user" ? "You" : "Agent"}</strong>
              <div>
                {entry.parts.map((part, index) =>
                  part.type === "text" ? (
                    <p key={`${entry.id}-${index}`}>{part.text}</p>
                  ) : (
                    <code key={`${entry.id}-${index}`}>{part.type}</code>
                  ),
                )}
              </div>
            </article>
          ))
        )}
      </section>

      {agent.error ? <p className="error">{agent.error.message}</p> : null}

      <form className="composer" onSubmit={submit}>
        <label htmlFor="agent-message">Message</label>
        <div className="composer-row">
          <input
            id="agent-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask about your Farm app"
            disabled={isBusy}
          />
          {isBusy ? (
            <button type="button" onClick={agent.stop}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!message.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

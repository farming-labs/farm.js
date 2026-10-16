"use client";

import { type FormEvent, useState } from "react";
import { clientTools, fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { setAccent } from "../lib/tools";

const ACCENTS = { green: "#8ce0b5", blue: "#8cb8ff", orange: "#ffb27a", pink: "#ff9ad5" } as const;

const tools = clientTools(
  setAccent.client(({ color }) => {
    document.documentElement.style.setProperty("--accent", ACCENTS[color]);
    return { applied: color };
  }),
);

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, isLoading, stop, error } = useChat({
    connection: fetchServerSentEvents("/api/chat"),
    tools,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    void sendMessage(text);
  }

  return (
    <section className="chat">
      <header>
        <h1>Farm.js + TanStack AI</h1>
        <p>
          Try <q>What renderers does Farm support?</q> (a server tool) or <q>Make the page pink</q> (a
          tool that runs in your browser).
        </p>
      </header>

      <ol className="messages" aria-live="polite">
        {messages.map((message) => (
          <li key={message.id} data-role={message.role}>
            {message.parts.map((part, index) => {
              if (part.type === "text") return <p key={index}>{part.content}</p>;
              if (part.type === "tool-call") {
                return (
                  <p key={index} className="tool">
                    {part.name} {part.output ? "done" : part.state}
                  </p>
                );
              }
              return null;
            })}
          </li>
        ))}
      </ol>

      {error ? <p className="error">{error.message}</p> : null}

      <form onSubmit={submit}>
        <input
          aria-label="Message"
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about Farm.js"
          value={input}
        />
        {isLoading ? (
          <button onClick={stop} type="button">
            Stop
          </button>
        ) : (
          <button type="submit">Send</button>
        )}
      </form>
    </section>
  );
}

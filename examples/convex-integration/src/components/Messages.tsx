"use client";

import { useState } from "react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { api } from "../../convex/_generated/api";

interface MessagesProps {
  preloaded: Preloaded<typeof api.messages.list>;
}

export function Messages({ preloaded }: MessagesProps) {
  const messages = usePreloadedQuery(preloaded);
  const sendMessage = useMutation(api.messages.send);
  const [body, setBody] = useState("");

  return (
    <section>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!body.trim()) return;
          await sendMessage({ body });
          setBody("");
        }}
      >
        <input
          aria-label="Message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Say something"
        />
        <button type="submit">Send</button>
      </form>
      <ul data-testid="messages">
        {messages.map((message) => (
          <li key={message.id}>
            <strong>{message.author}:</strong> {message.body}
          </li>
        ))}
      </ul>
    </section>
  );
}

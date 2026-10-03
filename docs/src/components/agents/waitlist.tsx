"use client";

import { useEffect, useRef, useState } from "react";
import { APIClientError, useMutation } from "@farm.js/core/client";
import { apiClient } from "../../lib/api";

const descriptions = {
  agents: "Agent infrastructure early access — Farm.js agents page",
  blog: "Agent infrastructure early access — Farm.js v0.1.0 blog",
} as const;

export function AgentWaitlist({
  source = "blog",
  note = true,
}: {
  source?: "blog" | "agents";
  /** Show the line explaining what the email is used for under the field. */
  note?: boolean;
}) {
  // The input stays uncontrolled, so an address typed before hydration is kept.
  const form = useRef<HTMLFormElement>(null);
  // The button stays disabled until React hydrates, so the form can never submit natively
  // (which would put the address in the URL).
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const join = useMutation(apiClient.waitlist.post, {
    request: { timeoutMs: 15_000 },
    onSuccess: (result) => {
      if (result.ok) form.current?.reset();
    },
  });

  const failed = join.error !== null || join.data?.ok === false;
  const status =
    join.error instanceof APIClientError && join.error.status === 429
      ? "Too many attempts. Please wait a minute and try again."
      : failed
        ? "We couldn't save your signup. Please try again in a moment."
        : "";
  const label = join.pending ? "Joining…" : "Join the waitlist";

  return (
    <div data-agent-waitlist-root>
      <form
        ref={form}
        className="agent-waitlist"
        data-agent-waitlist
        data-source={source}
        aria-label="Agent infrastructure waitlist"
        aria-busy={join.pending || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (join.pending) return;
          const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
          join.mutate({ body: { email, description: descriptions[source] } });
        }}
      >
        <label htmlFor="agent-waitlist-email">Email address</label>
        <div className="agent-waitlist-row">
          <input
            id="agent-waitlist-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            maxLength={200}
            required
            readOnly={join.pending}
            aria-describedby={
              note ? "agent-waitlist-note agent-waitlist-status" : "agent-waitlist-status"
            }
          />
          <button aria-label={label} type="submit" disabled={!ready || join.pending}>
            <span className="agent-waitlist-button-content">
              <span className="agent-waitlist-loader" aria-hidden="true">
                {Array.from({ length: 9 }, (_, index) => (
                  <span
                    key={index}
                    style={{
                      animationDelay: `${((index % 3) + Math.abs(Math.floor(index / 3) - 1)) * 90}ms`,
                    }}
                  />
                ))}
              </span>
              {/* The agents hero animation rewrites this label's text, so a new state renders a
                  new element instead of patching text React no longer owns. */}
              <span key={label} aria-hidden="true" data-agent-waitlist-label>
                {label}
              </span>
            </span>
          </button>
        </div>
        {note ? (
          <p id="agent-waitlist-note" className="agent-waitlist-note">
            Updates from Farming Labs about agent infrastructure and early access.
          </p>
        ) : null}
        <p
          id="agent-waitlist-status"
          className="agent-waitlist-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {status}
        </p>
      </form>
      <noscript>
        <p className="agent-waitlist-note" data-agent-waitlist-unavailable>
          Enable JavaScript to join the agent infrastructure waitlist.
        </p>
      </noscript>
    </div>
  );
}

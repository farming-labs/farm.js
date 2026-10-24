"use client";

import { useSearchParams } from "@farm.js/core/navigation";
import { agentCheckErrorMessage } from "../../lib/agents-check-messages";
import { runAgentCheck, useAgentCheck } from "./check-store";

/**
 * The agent-ready check form, in the waitlist's bar. Once hydrated it runs the check in place:
 * the report replaces the page's intro (see AgentCheckIntro). Without JavaScript it posts to
 * /api/agents/check, which redirects back here with `?url=` and the report (or with `?error=`).
 * `?url=` prefills it.
 */
export function AgentCheckForm() {
  const search = useSearchParams();
  const check = useAgentCheck();
  const prefill = (check.url || search.get("url") || "").slice(0, 2048);
  const errorCode = check.runs === 0 ? search.get("error") : null;
  const busy = check.pending;

  const failure = check.error
    ? agentCheckErrorMessage(check.error)
    : errorCode
      ? agentCheckErrorMessage(errorCode)
      : undefined;
  const status =
    (!check.pending && failure) || "Public pages only. About fifteen requests to the site.";
  const label = busy ? "Checking…" : "Run the check";

  return (
    <form
      className="agent-waitlist agent-check-form"
      action="/api/agents/check"
      method="post"
      aria-label="Agent-ready check"
      aria-busy={busy || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const url = String(new FormData(event.currentTarget).get("url") ?? "").trim();
        void runAgentCheck(url);
      }}
    >
      <label htmlFor="agent-check-url">Website address</label>
      <div className="agent-waitlist-row">
        <input
          key={prefill}
          id="agent-check-url"
          name="url"
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoComplete="url"
          spellCheck={false}
          placeholder="your-site.com"
          defaultValue={prefill}
          maxLength={2048}
          required
          readOnly={busy}
          aria-describedby="agent-check-status"
        />
        <button aria-label={label} type="submit" disabled={busy}>
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
            {/* The hero animation rewrites this label's text, so a new state renders a new
                element instead of patching text React no longer owns. */}
            <span key={label} aria-hidden="true" data-agent-check-label>
              {label}
            </span>
          </span>
        </button>
      </div>
      <p
        id="agent-check-status"
        className="agent-waitlist-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-tone={failure && !busy ? "error" : undefined}
      >
        {status}
      </p>
    </form>
  );
}

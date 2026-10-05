"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@farm.js/core/client";
import { useRouter, useSearchParams } from "@farm.js/core/navigation";
import { agentCheckErrorMessage } from "../../lib/agents-check-messages";

// What the scan is doing, roughly in order, while the request runs.
const STEPS = [
  "Fetching the page",
  "Looking for a Markdown version",
  "Reading llms.txt",
  "Reading robots.txt",
  "Asking for an MCP server",
  "Looking for OpenAPI",
  "Reading structured data",
  "Scoring",
];

/** Start a scan. The route answers a JSON request with JSON and a plain form post with a redirect. */
async function startCheck(url: string): Promise<{ id: string } | { error?: string }> {
  const response = await fetch("/api/agents/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url }),
  });
  const result = (await response.json().catch(() => ({}))) as { id?: unknown; error?: unknown };
  if (response.ok && typeof result.id === "string") return { id: result.id };
  const error = typeof result.error === "string" ? result.error : undefined;
  return { error: response.status === 429 ? (error ?? "rate_limited") : error };
}

/**
 * The agent-ready check form, in the waitlist's bar. Without JavaScript it posts to
 * /api/agents/check, which redirects to the report (or back here with `?error=`). Once hydrated
 * it shows progress and opens the report in place. `?url=` prefills it ("Scan again").
 */
export function AgentCheckForm() {
  const search = useSearchParams();
  const router = useRouter();
  const prefill = (search.get("url") ?? "").slice(0, 2048);
  const errorCode = search.get("error");
  const [step, setStep] = useState(0);
  const check = useMutation(startCheck, {
    onSuccess: (result) => {
      if ("id" in result) router.push(`/agents/check/${result.id}`);
    },
  });
  const opening = check.data !== null && "id" in check.data;
  const busy = check.pending || opening;

  useEffect(() => {
    if (!check.pending) return;
    const ticker = setInterval(
      () => setStep((current) => Math.min(current + 1, STEPS.length - 1)),
      650,
    );
    return () => clearInterval(ticker);
  }, [check.pending]);

  const failure = check.error
    ? agentCheckErrorMessage("unavailable")
    : check.data && "error" in check.data
      ? agentCheckErrorMessage(check.data.error)
      : !check.data && errorCode
        ? agentCheckErrorMessage(errorCode)
        : undefined;
  const status = check.pending
    ? `${STEPS[step]}…`
    : opening
      ? "Opening the report…"
      : (failure ?? "Public pages only. About fifteen requests to the site.");
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
        setStep(0);
        check.mutate(String(new FormData(event.currentTarget).get("url") ?? "").trim());
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

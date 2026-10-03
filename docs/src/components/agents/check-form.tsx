import { useSearchParams } from "@farm.js/core/navigation";
import { agentCheckErrorMessage } from "../../lib/agents-check-messages";

/**
 * The agent-ready check form, in the waitlist's bar. It posts to
 * /api/agents/check and works without JavaScript (the route answers with a
 * redirect, back here with `?error=` on failure); check-client.ts adds
 * progress and keeps the page in place. `?url=` prefills it ("Scan again").
 */
export function AgentCheckForm() {
  const search = useSearchParams();
  const url = (search.get("url") ?? "").slice(0, 2048);
  const errorCode = search.get("error");
  const error = errorCode ? agentCheckErrorMessage(errorCode) : undefined;
  return (
    <div data-agent-check-root>
      <form
        className="agent-waitlist agent-check-form"
        action="/api/agents/check"
        method="post"
        aria-label="Agent-ready check"
        data-agent-check
      >
        <label htmlFor="agent-check-url">Website address</label>
        <div className="agent-waitlist-row">
          <input
            id="agent-check-url"
            name="url"
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoComplete="url"
            spellCheck={false}
            placeholder="your-site.com"
            defaultValue={url}
            maxLength={2048}
            required
            aria-describedby="agent-check-status"
          />
          <button aria-label="Run the check" type="submit">
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
              <span aria-hidden="true" data-agent-check-label>
                Run the check
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
          data-tone={error ? "error" : undefined}
        >
          {error ?? "Public pages only. About fifteen requests to the site."}
        </p>
      </form>
    </div>
  );
}

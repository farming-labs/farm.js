export function AgentWaitlist({
  source = "blog",
  note = true,
}: {
  source?: "blog" | "agents";
  /** Show the line explaining what the email is used for under the field. */
  note?: boolean;
}) {
  return (
    <div data-agent-waitlist-root>
      <form
        className="agent-waitlist"
        data-agent-waitlist
        data-source={source}
        aria-label="Agent infrastructure waitlist"
        hidden
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
            aria-describedby={
              note ? "agent-waitlist-note agent-waitlist-status" : "agent-waitlist-status"
            }
          />
          <button type="submit">
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
              <span data-agent-waitlist-label>Join the waitlist</span>
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
        />
      </form>
      <p className="agent-waitlist-note" data-agent-waitlist-unavailable>
        Enable JavaScript to join the agent infrastructure waitlist.
      </p>
    </div>
  );
}

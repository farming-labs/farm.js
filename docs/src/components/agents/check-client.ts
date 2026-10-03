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

/** Keep the check on the page: show progress, then open the report. */
export function enhanceAgentCheck(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>("[data-agent-check]");
  const input = form?.querySelector<HTMLInputElement>('input[name="url"]');
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const label = button?.querySelector<HTMLElement>("[data-agent-check-label]");
  const status = form?.querySelector<HTMLElement>('[role="status"]');
  if (!form || !input || !button || !label || !status) return () => {};

  const lifecycle = new AbortController();
  let request: AbortController | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let pending = false;

  const finish = () => {
    clearInterval(ticker);
    pending = false;
    form.removeAttribute("aria-busy");
    button.disabled = false;
    button.setAttribute("aria-label", "Run the check");
    input.readOnly = false;
    label.textContent = "Run the check";
  };

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (pending || !form.reportValidity()) return;
      pending = true;
      button.disabled = true;
      button.setAttribute("aria-label", "Checking…");
      input.readOnly = true;
      label.textContent = "Checking…";
      form.setAttribute("aria-busy", "true");
      delete status.dataset.tone;
      let step = 0;
      status.textContent = `${STEPS[0]}…`;
      ticker = setInterval(() => {
        step = Math.min(step + 1, STEPS.length - 1);
        status.textContent = `${STEPS[step]}…`;
      }, 650);
      request = new AbortController();

      try {
        const response = await fetch("/api/agents/check", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ url: input.value.trim() }),
          signal: request.signal,
        });
        const result = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
        if (lifecycle.signal.aborted) return;
        if (response.ok && typeof result.id === "string") {
          status.textContent = "Opening the report…";
          window.location.assign(`/agents/check/${result.id}`);
          return;
        }
        status.dataset.tone = "error";
        status.textContent = agentCheckErrorMessage(
          response.status === 429 ? (result.error ?? "rate_limited") : result.error,
        );
      } catch {
        if (lifecycle.signal.aborted) return;
        status.dataset.tone = "error";
        status.textContent = agentCheckErrorMessage("unavailable");
      }
      finish();
    },
    { signal: lifecycle.signal },
  );

  return () => {
    lifecycle.abort();
    request?.abort();
    clearInterval(ticker);
  };
}

/** "Copy link" on a report: the button only appears once this runs. */
export function enhanceAgentCheckCopy(button: HTMLButtonElement) {
  const lifecycle = new AbortController();
  let reset: ReturnType<typeof setTimeout> | undefined;
  button.hidden = false;
  button.addEventListener(
    "click",
    async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        button.textContent = "Link copied";
      } catch {
        button.textContent = "Copy the address bar";
      }
      clearTimeout(reset);
      reset = setTimeout(() => {
        button.textContent = "Copy link";
      }, 2400);
    },
    { signal: lifecycle.signal },
  );
  return () => {
    lifecycle.abort();
    clearTimeout(reset);
    button.hidden = true;
  };
}

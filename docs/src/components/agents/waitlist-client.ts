// Share the SSR form across the article and landing page, including soft navigation.
export function enhanceAgentWaitlist(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>("[data-agent-waitlist]");
  const email = form?.querySelector<HTMLInputElement>('input[name="email"]');
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const label = button?.querySelector<HTMLElement>("[data-agent-waitlist-label]");
  const status = form?.querySelector<HTMLElement>('[role="status"]');
  const fallback = root.querySelector<HTMLElement>("[data-agent-waitlist-unavailable]");
  if (!form || !email || !button || !label || !status) return () => {};

  const lifecycle = new AbortController();
  let request: AbortController | undefined;
  let pending = false;
  form.hidden = false;
  if (fallback) fallback.hidden = true;

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (pending || !form.reportValidity()) return;
      pending = true;
      button.disabled = true;
      button.setAttribute("aria-label", "Joining…");
      email.readOnly = true;
      label.textContent = "Joining…";
      status.textContent = "";
      form.setAttribute("aria-busy", "true");
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 15_000);

      try {
        const response = await fetch("/api/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.value.trim(),
            description:
              form.dataset.source === "agents"
                ? "Agent infrastructure early access — Farm.js agents page"
                : "Agent infrastructure early access — Farm.js v0.1.0 blog",
          }),
          signal: request.signal,
        });
        if (lifecycle.signal.aborted) return;
        if (response.status === 429) {
          status.textContent = "Too many attempts. Please wait a minute and try again.";
          return;
        }
        const result = await response.json();
        if (lifecycle.signal.aborted) return;
        if (!response.ok || result?.ok !== true || typeof result.id !== "string") {
          throw new Error("Signup was not confirmed");
        }
        form.reset();
      } catch {
        if (!lifecycle.signal.aborted) {
          status.textContent = "We couldn't save your signup. Please try again in a moment.";
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (!lifecycle.signal.aborted) {
          form.removeAttribute("aria-busy");
          button.disabled = false;
          button.setAttribute("aria-label", "Join the waitlist");
          email.readOnly = false;
          label.textContent = "Join the waitlist";
        }
      }
    },
    { signal: lifecycle.signal },
  );

  return () => {
    lifecycle.abort();
    request?.abort();
    form.hidden = true;
    if (fallback) fallback.hidden = false;
  };
}

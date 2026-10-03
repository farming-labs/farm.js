// Enhance SSR code without moving the highlighter or its grammars into the client.
export function enhanceCodeBlocks(root: HTMLElement) {
  const controller = new AbortController();
  const cleanup: (() => void)[] = [];
  for (const block of root.querySelectorAll(".blog-prose .blog-code-block")) {
    const button = block.querySelector<HTMLButtonElement>(".blog-code-copy");
    const code = block.querySelector("pre > code");
    const label = block.querySelector("[data-copy-label]");
    const status = block.querySelector("[data-copy-status]");
    if (!button || !code || !label || !status) continue;
    button.hidden = false;
    const copyLabel = button.getAttribute("aria-label")!;
    let timer: ReturnType<typeof setTimeout>;
    function reset() {
      delete button!.dataset.state;
      button!.disabled = false;
      label!.textContent = "COPY";
      status!.textContent = "";
      button!.setAttribute("aria-label", copyLabel);
    }
    cleanup.push(() => {
      clearTimeout(timer);
      reset();
      button.hidden = true;
    });
    button.addEventListener(
      "click",
      async () => {
        clearTimeout(timer);
        button.disabled = true;
        try {
          await navigator.clipboard.writeText(code.textContent);
          if (controller.signal.aborted) return;
          button.dataset.state = "copied";
          label.textContent = "COPIED";
          status.textContent = "Code copied to clipboard.";
        } catch {
          if (controller.signal.aborted) return;
          button.dataset.state = "error";
          label.textContent = "RETRY";
          status.textContent = "Could not copy. Try again or select and copy the code manually.";
        } finally {
          if (!controller.signal.aborted) {
            button.disabled = false;
            button.setAttribute("aria-label", `${label.textContent} code`);
            timer = setTimeout(reset, 1800);
          }
        }
      },
      { signal: controller.signal },
    );
  }
  return () => {
    controller.abort();
    for (const dispose of cleanup) dispose();
  };
}

// Docs pages are rendered by the docs runtime, so farmjs.dev adds its own llms.txt link to the
// docs header here, like the release announcement. docs-overrides.css places it beside search on
// desktop. The theme still renders its hidden llms.txt directive for agents.
export function mountDocsLlmsLink(root: HTMLElement) {
  if (root.querySelector(":scope > .farm-docs-llms-link")) return () => {};
  const link = document.createElement("a");
  link.className = "farm-docs-llms-link";
  link.href = "/llms.txt";
  link.textContent = "llms.txt";
  root.append(link);
  return () => link.remove();
}

import { launchPost } from "../lib/blog";

// Docs pages are rendered by the docs runtime, not the site layout, so the release announcement the
// site header shows is added here. docs-overrides.css reserves its strip, so nothing shifts.
export function mountDocsAnnouncement(root: HTMLElement) {
  if (root.querySelector(":scope > .farm-docs-announcement")) return () => {};
  const bar = document.createElement("div");
  bar.className = "farm-docs-announcement";
  const text = document.createElement("span");
  text.textContent = "Farm.js v0.1.0 is released";
  const link = document.createElement("a");
  link.href = launchPost.href;
  link.textContent = "Read the announcement";
  bar.append(text, link);
  root.prepend(bar);
  return () => bar.remove();
}

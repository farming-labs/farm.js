/**
 * Document tails for a redirect() or notFound() thrown after a streamed
 * response already sent its 200 shell. The status can no longer change, so
 * the document recovers in the browser, as Next.js does: a redirect replaces
 * the location, and notFound() swaps the page for the not-found UI and marks
 * the document noindex so crawlers do not index the missing page.
 */

const PAGE_CONTAINER_ID = "__farm_page__";
const TEMPLATE_ID = "__farm_late_not_found__";

function serializeForInlineScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function createLateRedirectRecovery(url: string): string {
  return `<script>window.location.replace(${serializeForInlineScript(url)})</script>`;
}

/** `content` is the rendered not-found markup (the app's not-found page or the built-in one). */
export function createLateNotFoundRecovery(content: string): string {
  return (
    `<template id="${TEMPLATE_ID}">${content}</template>` +
    `<script>(function(){var t=document.getElementById("${TEMPLATE_ID}");` +
    `var p=document.getElementById("${PAGE_CONTAINER_ID}");` +
    `if(t&&p){p.replaceChildren(t.content.cloneNode(true));}if(t)t.remove();` +
    `var m=document.createElement("meta");m.name="robots";m.content="noindex";` +
    `document.head.appendChild(m);})();</script>`
  );
}

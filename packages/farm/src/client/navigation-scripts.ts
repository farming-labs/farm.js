/**
 * Scripts a client navigation adds to the page (React's reveal scripts in a streamed navigation, a
 * swapped document's scripts), as source. The production client entry (nitro/universal-build.ts)
 * and the `farm dev` client entry (vite.ts) both include it.
 *
 * With a nonce Content Security Policy (`security.csp.nonce`), the page trusts only the nonce of the
 * response that loaded the document, and each navigation response carries a nonce of its own. The
 * server stamps that nonce on the scripts it trusts and strips it from every other script, so a
 * script from a navigation response runs with the page's nonce only when the response nonced it.
 */
export const FARM_NAVIGATION_SCRIPT_SOURCE = `// The nonce the page's Content Security Policy trusts: the one of the response that loaded the
// document, read once, before a navigation adds scripts that carry another response's nonce.
const farmDocumentScriptNonce = (function() {
  if (typeof document === "undefined") return "";
  const script = document.querySelector("script[data-farm-runtime]") || document.querySelector("script[nonce]");
  return (script && script.nonce) || "";
})();

// A runnable copy of a script a navigation inserted as markup. A script its response nonced runs
// with the page's nonce; one it left without a nonce stays without, so the policy still blocks it.
function createFarmNavigationScript(script) {
  const freshScript = document.createElement("script");
  for (const attribute of Array.from(script.attributes)) {
    if (attribute.name !== "nonce") freshScript.setAttribute(attribute.name, attribute.value);
  }
  if (farmDocumentScriptNonce && (script.nonce || script.getAttribute("nonce"))) {
    freshScript.nonce = farmDocumentScriptNonce;
  }
  freshScript.textContent = script.textContent || "";
  return freshScript;
}
// React streams Suspense content after its fallback, in a hidden segment that a reveal script
// ($RC for a boundary, $RS for a segment placeholder) moves into place. This makes the same moves
// in a parsed page, before it goes on screen, and drops the calls it made, so the islands in that
// content are where the swap looks for them (a refresh keeps them).
function revealFarmStreamedContent(root) {
  const find = function(id) {
    return root.querySelector('[id="' + id.replace(/"/g, "") + '"]');
  };
  for (const script of Array.from(root.querySelectorAll("script:not([type]), script[type='text/javascript']"))) {
    const source = script.textContent || "";
    if (source.indexOf("$RC(") === -1 && source.indexOf("$RS(") === -1) continue;
    let rest = source;
    for (const call of source.matchAll(/\\$R([CS])\\("([^"]+)","([^"]+)"\\);?/g)) {
      const [text, kind, first, second] = call;
      if (kind === "S") {
        const segment = find(first);
        const placeholder = find(second);
        if (!segment || !placeholder) continue;
        while (segment.firstChild) placeholder.parentNode.insertBefore(segment.firstChild, placeholder);
        placeholder.remove();
        segment.remove();
      } else {
        const boundary = find(first);
        const segment = find(second);
        if (!boundary || !segment) continue;
        const parent = boundary.parentNode;
        const start = boundary.previousSibling;
        // The fallback goes, up to the boundary's closing comment (nested boundaries skipped).
        let node = boundary;
        let depth = 0;
        while (node) {
          if (node.nodeType === 8) {
            const data = node.data;
            if (data === "/$" || data === "/&") {
              if (depth === 0) break;
              depth--;
            } else if (data === "$" || data === "$?" || data === "$~" || data === "$!" || data === "&") {
              depth++;
            }
          }
          const next = node.nextSibling;
          parent.removeChild(node);
          node = next;
        }
        while (segment.firstChild) parent.insertBefore(segment.firstChild, node);
        segment.remove();
        if (start && start.nodeType === 8) start.data = "$";
      }
      rest = rest.replace(text, "");
    }
    script.textContent = rest;
  }
}
`;

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
}`;

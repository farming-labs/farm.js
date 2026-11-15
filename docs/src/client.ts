import { defineClient } from "@farm.js/core/client/lifecycle";
import { mountDocsAnnouncement } from "./components/docs-announcement";
import { mountDocsLlmsLink } from "./components/docs-llms-link";

export default defineClient({
  setup() {
    let dispose: (() => void) | undefined;
    let docsRoot: HTMLElement | null = null;
    function refresh() {
      const next = document.getElementById("farm-docs-root");
      if (next === docsRoot) return;
      dispose?.();
      docsRoot = next;
      if (!docsRoot) {
        dispose = undefined;
        return;
      }
      const disposers = [mountDocsAnnouncement(docsRoot), mountDocsLlmsLink(docsRoot)];
      dispose = () => disposers.forEach((remove) => remove());
    }
    // Setup covers initial HTML; rendered covers route entry and history.
    refresh();
    // Browsers with a model context get the docs search as a WebMCP tool on every page, docs
    // pages included, through the runtime webmcp() starts. Other browsers never download it.
    let stopSearchTool: (() => void) | undefined;
    let closed = false;
    if ("modelContext" in document || "modelContext" in navigator) {
      import("./lib/webmcp-docs-search")
        .then(({ startDocsSearchTool }) => startDocsSearchTool())
        .then((stop) => {
          if (closed) stop();
          else stopSearchTool = stop;
        })
        .catch((error: unknown) => console.warn("[farmjs.dev] WebMCP docs search failed", error));
    }
    return {
      refresh,
      dispose() {
        closed = true;
        stopSearchTool?.();
        stopSearchTool = undefined;
        dispose?.();
        dispose = undefined;
        docsRoot = null;
      },
    };
  },
  hydration: {
    after({ state }) {
      state.refresh();
    },
  },
  navigation: {
    rendered({ state }) {
      state.refresh();
    },
  },
  close({ state }) {
    state.dispose();
  },
});

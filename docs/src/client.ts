import { defineClient } from "@farm.js/core/client/lifecycle";
import { mountDocsAnnouncement } from "./components/docs-announcement";

export default defineClient({
  setup() {
    let dispose: (() => void) | undefined;
    let docsRoot: HTMLElement | null = null;
    function refresh() {
      const next = document.getElementById("farm-docs-root");
      if (next === docsRoot) return;
      dispose?.();
      docsRoot = next;
      dispose = docsRoot ? mountDocsAnnouncement(docsRoot) : undefined;
    }
    // Setup covers initial HTML; rendered covers route entry and history.
    refresh();
    return {
      refresh,
      dispose() {
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

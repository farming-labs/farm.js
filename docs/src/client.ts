import { defineClient } from "@farm.js/core/client/lifecycle";
import { enhanceAgentCheck, enhanceAgentCheckCopy } from "./components/agents/check-client";
import { mountDocsAnnouncement } from "./components/docs-announcement";

export default defineClient({
  setup() {
    const mounted = new Map<HTMLElement, () => void>();
    function refresh() {
      for (const [element, dispose] of mounted) {
        if (!element.isConnected) {
          dispose();
          mounted.delete(element);
        }
      }
      for (const element of document.querySelectorAll<HTMLElement>(
        "[data-agent-check-root], [data-agent-check-copy]",
      )) {
        if (mounted.has(element)) continue;
        if (element.matches("[data-agent-check-root]")) {
          mounted.set(element, enhanceAgentCheck(element));
        } else {
          mounted.set(element, enhanceAgentCheckCopy(element as HTMLButtonElement));
        }
      }
    }
    function refreshDocs() {
      const docsRoot = document.getElementById("farm-docs-root");
      if (docsRoot && !mounted.has(docsRoot))
        mounted.set(docsRoot, mountDocsAnnouncement(docsRoot));
    }
    // Setup covers initial HTML; rendered covers route entry and history.
    refresh();
    refreshDocs();
    return {
      refresh() {
        refresh();
        refreshDocs();
      },
      dispose() {
        for (const dispose of mounted.values()) dispose();
        mounted.clear();
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

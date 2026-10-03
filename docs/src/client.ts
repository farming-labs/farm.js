import { defineClient } from "@farm.js/core/client/lifecycle";
import { enhanceArtwork } from "./components/blog/artwork-motion";
import { enhanceCodeBlocks } from "./components/blog/code-copy";
import { enhanceContents } from "./components/blog/contents-navigation";
import { enhanceFigures } from "./components/blog/figure-player";
import { enhanceAgentCheck, enhanceAgentCheckCopy } from "./components/agents/check-client";
import { mountDocsAnnouncement } from "./components/docs-announcement";

export default defineClient({
  setup() {
    const mounted = new Map<HTMLElement, () => void>();
    // React hydrates the home page, so its figures wait for hydration before replaying. That
    // hook can run before a concurrent hydration commits, so figures also keep every slot the
    // player writes out of React's hydrated text (see BlogFigure). Blog Markdown is not hydrated.
    let hydrated = false;
    function refresh(afterRender = false) {
      if (afterRender) hydrated = true;
      for (const [element, dispose] of mounted) {
        if (!element.isConnected) {
          dispose();
          mounted.delete(element);
        }
      }
      for (const element of document.querySelectorAll<HTMLElement>(
        ".farm-blog .blog-release-art, .farm-blog .blog-reading-grid, .agent-artwork, [data-agent-check-root], [data-agent-check-copy], .farm-home .blog-figure",
      )) {
        if (mounted.has(element)) continue;
        if (!hydrated && element.matches(".farm-home .blog-figure")) continue;
        if (element.matches(".blog-release-art, .agent-artwork")) {
          mounted.set(element, enhanceArtwork(element));
        } else if (element.matches(".farm-home .blog-figure")) {
          mounted.set(element, enhanceFigures(element));
        } else if (element.matches("[data-agent-check-root]")) {
          mounted.set(element, enhanceAgentCheck(element));
        } else if (element.matches("[data-agent-check-copy]")) {
          mounted.set(element, enhanceAgentCheckCopy(element as HTMLButtonElement));
        } else {
          const disposeContents = enhanceContents(element);
          const disposeCode = enhanceCodeBlocks(element);
          const disposeFigures = enhanceFigures(element);
          mounted.set(element, () => {
            disposeContents?.();
            disposeCode();
            disposeFigures();
          });
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
      refresh(afterRender = false) {
        refresh(afterRender);
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
      state.refresh(true);
    },
  },
  navigation: {
    rendered({ state }) {
      state.refresh(true);
    },
  },
  close({ state }) {
    state.dispose();
  },
});

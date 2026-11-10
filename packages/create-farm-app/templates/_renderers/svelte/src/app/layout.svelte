<script module lang="ts">
  import type { Metadata } from "@farm.js/core";
  import "./globals.css";
  import "./svelte.css";

  export const metadata: Metadata = {
    title: "FARMJS Svelte App",
    description: "Built with Farm.js, the framework for the web and agents",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
    },
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}

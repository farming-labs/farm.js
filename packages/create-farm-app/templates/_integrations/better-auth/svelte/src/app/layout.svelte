<script module lang="ts">
  import type { Metadata } from "@farm.js/core";
  import "./globals.css";

  export const metadata: Metadata = {
    title: "FARMJS Svelte Better Auth Starter",
    description: "Better Auth with FARMJS and Svelte",
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

<script module lang="ts">
  import type { Metadata } from "@farm.js/core";
  import "./globals.css";
  import "./svelte.css";

  export const metadata: Metadata = {
    title: "FARMJS Svelte App",
    description: "A framework for product-integrated apps",
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

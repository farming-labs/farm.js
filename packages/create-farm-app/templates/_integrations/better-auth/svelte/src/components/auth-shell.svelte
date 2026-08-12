<script lang="ts">
  import type { Snippet } from "svelte";
  import ResourceLinks from "./resource-links.svelte";

  let { children }: { children?: Snippet } = $props();
</script>

<main class="auth-shell">
  <a class="auth-home-link" href="/" aria-label="Back to starter home">
    <span>00</span>
    <span>FARMJS / Svelte + Better Auth</span>
  </a>

  <section class="auth-form-side">{@render children?.()}</section>
  <ResourceLinks className="auth-resource-links" />
</main>

<script lang="ts">
  let { class: className = "" }: { class?: string } = $props();
</script>

<nav class={className} aria-label="Renderer resources">
  <a href="https://farm.js.dev/docs/renderers/svelte">Docs</a>
  <span aria-hidden="true">/</span>
  <a href="https://github.com/farming-labs/farm.js/tree/main/examples/svelte-renderer">
    GitHub
  </a>
</nav>

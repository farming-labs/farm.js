<script module lang="ts">
  export const hydrate = true;
</script>

<script lang="ts">
  import ResourceLinks from "../components/resource-links.svelte";
  import GreetingPanel from "../features/greeting/greeting-panel.svelte";
</script>

<main class="page-shell">
  <section class="hero">
    <div class="eyebrow">
      <span>00</span>
      <span>FARMJS / Svelte renderer</span>
    </div>

    <h1>Svelte UI. <span>FARMJS server.</span></h1>

    <GreetingPanel />
    <ResourceLinks class="links" />
  </section>
</main>

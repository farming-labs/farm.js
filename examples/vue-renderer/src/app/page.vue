<script lang="ts">
export const hydrate = true;
</script>

<script setup lang="ts">
import GreetingPanel from "../features/greeting/greeting-panel.vue";
import ResourceLinks from "../components/resource-links.vue";

defineOptions({ inheritAttrs: false });
</script>

<template>
  <main class="page-shell">
    <section class="hero">
      <div class="eyebrow">
        <span>00</span>
        <span>FARMJS / Vue renderer</span>
      </div>

      <h1>Vue UI. <span>FARMJS server.</span></h1>

      <GreetingPanel />
      <ResourceLinks class="links" />
    </section>
  </main>
</template>

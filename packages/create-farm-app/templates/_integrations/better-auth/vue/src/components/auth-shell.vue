<script setup lang="ts">
import ResourceLinks from "./resource-links.vue";
</script>

<template>
  <main class="auth-shell">
    <a class="auth-home-link" href="/" aria-label="Back to starter home">
      <span>00</span>
      <span>FARMJS / Vue + Better Auth</span>
    </a>

    <section class="auth-form-side"><slot /></section>
    <ResourceLinks class="auth-resource-links" />
  </main>
</template>

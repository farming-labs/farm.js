<script lang="ts">
export const hydrate = true;
</script>

<script setup lang="ts">
import { ref } from "vue";
import ResourceLinks from "../components/resource-links.vue";
import { api } from "../lib/api-client";

defineOptions({ inheritAttrs: false });

const message = ref("Call a typed server function");
const pending = ref(false);
const failed = ref(false);

async function callServer() {
  pending.value = true;
  failed.value = false;
  try {
    const result = await api.greeting.post({
      body: { name: "Vue" },
    });
    if (result.error) throw result.error;
    if (!result.data) throw new Error("The server returned no greeting");
    message.value = result.data.message;
  } catch {
    failed.value = true;
    message.value = "Try the server call again";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="landing-main">
    <section class="hero-section">
      <div class="hero-copy">
        <div class="eyebrow-row">
          <span>00</span>
          <span>FARMJS / Vue starter</span>
        </div>

        <h1>Edit <code>page.vue</code> to begin.</h1>

        <div class="command-list" aria-label="Getting started">
          <div class="command-row">
            <span>01</span>
            <code>pnpm dev</code>
          </div>
          <div class="command-row">
            <span>02</span>
            <button
              type="button"
              class="server-call"
              :class="{ 'server-call-error': failed }"
              :disabled="pending"
              @click="callServer"
            >
              {{ pending ? "Calling…" : message }}
            </button>
          </div>
        </div>

        <ResourceLinks class="resource-links" />
      </div>
    </section>
  </main>
</template>

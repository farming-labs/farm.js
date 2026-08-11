<script setup lang="ts">
import { ref } from "vue";
import { api } from "./client";

const message = ref("Ready for a typed server call.");
const detail = ref("createServerFn is waiting on the server");
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
    detail.value = `server invocation ${result.data.invocation} / ${result.data.runtime}`;
  } catch (error) {
    failed.value = true;
    message.value = error instanceof Error ? error.message : "The server call failed";
    detail.value = "request failed";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="server-demo">
    <div class="demo-row">
      <span>01</span>
      <code>renderer: vue()</code>
    </div>
    <div class="demo-row">
      <span>02</span>
      <button
        type="button"
        :class="{ failed }"
        :disabled="pending"
        @click="callServer"
      >
        {{ pending ? "Calling server…" : message }}
      </button>
    </div>
    <div class="demo-row demo-detail" aria-live="polite">
      <span>03</span>
      <code>{{ detail }}</code>
    </div>
  </div>
</template>

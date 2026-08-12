<script lang="ts">
export const hydrate = true;
</script>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { authClient } from "../../lib/auth-client";

type SessionData = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;

const session = ref<SessionData | null>(null);
const pending = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  const response = await authClient.getSession();
  if (response.error || !response.data?.user) {
    window.location.replace("/sign-in");
    return;
  }
  session.value = response.data;
  pending.value = false;
});

async function signOut() {
  pending.value = true;
  error.value = null;
  const response = await authClient.signOut();
  if (response.error) {
    error.value = response.error.message ?? "Could not sign out.";
    pending.value = false;
    return;
  }
  window.location.assign("/");
}
</script>

<template>
  <main v-if="!session" class="loading-shell" aria-live="polite">
    <div class="loading-block">
      <span class="loading-label">Verifying protected session</span>
      <div class="loading-line wide" />
      <div class="loading-line" />
    </div>
  </main>

  <main v-else class="dashboard-shell">
    <div class="dashboard-heading">
      <div>
        <span class="section-index">PROTECTED / MIDDLEWARE VERIFIED</span>
        <h1>Welcome back, {{ session.user.name }}.</h1>
        <p>{{ session.user.email }}</p>
      </div>
      <div class="sign-out-control">
        <button class="button button-secondary" :disabled="pending" @click="signOut">
          {{ pending ? "Signing out…" : "Sign out" }}
        </button>
        <span v-if="error" class="inline-error">{{ error }}</span>
      </div>
    </div>
  </main>
</template>

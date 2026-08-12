<script module lang="ts">
  export const hydrate = true;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { authClient } from "../../lib/auth-client";

  type SessionData = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;

  let session = $state<SessionData | null>(null);
  let pending = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    const response = await authClient.getSession();
    if (response.error || !response.data?.user) {
      window.location.replace("/sign-in");
      return;
    }
    session = response.data;
    pending = false;
  });

  async function signOut() {
    pending = true;
    error = null;
    const response = await authClient.signOut();
    if (response.error) {
      error = response.error.message ?? "Could not sign out.";
      pending = false;
      return;
    }
    window.location.assign("/");
  }
</script>

{#if !session}
  <main class="loading-shell" aria-live="polite">
    <div class="loading-block">
      <span class="loading-label">Verifying protected session</span>
      <div class="loading-line wide"></div>
      <div class="loading-line"></div>
    </div>
  </main>
{:else}
  <main class="dashboard-shell">
    <div class="dashboard-heading">
      <div>
        <span class="section-index">PROTECTED / MIDDLEWARE VERIFIED</span>
        <h1>Welcome back, {session.user.name}.</h1>
        <p>{session.user.email}</p>
      </div>
      <div class="sign-out-control">
        <button class="button button-secondary" disabled={pending} onclick={signOut}>
          {pending ? "Signing out…" : "Sign out"}
        </button>
        {#if error}<span class="inline-error">{error}</span>{/if}
      </div>
    </div>
  </main>
{/if}

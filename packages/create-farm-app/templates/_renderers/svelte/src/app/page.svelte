<script module lang="ts">
  export const hydrate = true;
</script>

<script lang="ts">
  import ResourceLinks from "../components/resource-links.svelte";
  import { api } from "../lib/api-client";

  let message = $state("Call a typed server function");
  let pending = $state(false);
  let failed = $state(false);

  async function callServer() {
    pending = true;
    failed = false;
    try {
      const result = await api.greeting.post({
        body: { name: "Svelte" },
      });
      if (result.error) throw result.error;
      if (!result.data) throw new Error("The server returned no greeting");
      message = result.data.message;
    } catch {
      failed = true;
      message = "Try the server call again";
    } finally {
      pending = false;
    }
  }
</script>

<main class="landing-main">
  <section class="hero-section">
    <div class="hero-copy">
      <div class="eyebrow-row">
        <span>00</span>
        <span>FARMJS / Svelte starter</span>
      </div>

      <h1>Edit <code>page.svelte</code> to begin.</h1>

      <div class="command-list" aria-label="Getting started">
        <div class="command-row">
          <span>01</span>
          <code>pnpm dev</code>
        </div>
        <div class="command-row">
          <span>02</span>
          <button
            type="button"
            class:server-call-error={failed}
            class="server-call"
            disabled={pending}
            onclick={callServer}
          >
            {pending ? "Calling…" : message}
          </button>
        </div>
      </div>

      <ResourceLinks class="resource-links" />
    </div>
  </section>
</main>

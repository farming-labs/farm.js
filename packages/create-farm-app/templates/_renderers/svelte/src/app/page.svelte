<script module lang="ts">
  export const hydrate = true;
</script>

<script lang="ts">
  import ResourceLinks from "../components/resource-links.svelte";
  import { apiClient } from "../lib/api";

  let message = $state("Call a typed server function");
  let pending = $state(false);
  let failed = $state(false);

  async function callServer() {
    pending = true;
    failed = false;
    try {
      const result = await apiClient.greeting.post({
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

      <p class="hero-summary">
        Pages render on the server, so browsers, search engines and AI agents get complete HTML before any JavaScript runs.
      </p>

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

      <ul class="feature-list" aria-label="What this starter includes">
        <li>
          <span>03</span>
          <p><strong>Routes.</strong> Add a folder with a page under src/app and it becomes a URL, with its layout, loading and error states beside it.</p>
        </li>
        <li>
          <span>04</span>
          <p><strong>Agent-ready.</strong> Every page also answers as Markdown at its URL plus .md, is listed in /llms.txt, and carries JSON-LD and Open Graph from your metadata.</p>
        </li>
        <li>
          <span>05</span>
          <p><strong>Server functions.</strong> src/app/api/greeting/route.ts runs only on the server. The button above calls it through a typed client, so a change to its input or output shows up as a type error here.</p>
        </li>
      </ul>

      <ResourceLinks class="resource-links" />
    </div>
  </section>
</main>

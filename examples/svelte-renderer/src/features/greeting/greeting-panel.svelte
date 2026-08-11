<script lang="ts">
  import { api } from "./client";

  let message = $state("Ready for a typed server call.");
  let detail = $state("createServerFn is waiting on the server");
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
      detail = `server invocation ${result.data.invocation} / ${result.data.runtime}`;
    } catch (error) {
      failed = true;
      message = error instanceof Error ? error.message : "The server call failed";
      detail = "request failed";
    } finally {
      pending = false;
    }
  }
</script>

<div class="server-demo">
  <div class="demo-row">
    <span>01</span>
    <code>renderer: svelte()</code>
  </div>
  <div class="demo-row">
    <span>02</span>
    <button
      type="button"
      class:failed
      disabled={pending}
      onclick={callServer}
    >
      {pending ? "Calling server…" : message}
    </button>
  </div>
  <div class="demo-row demo-detail" aria-live="polite">
    <span>03</span>
    <code>{detail}</code>
  </div>
</div>

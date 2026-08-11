"use client";

import { createSignal } from "solid-js";
import { api } from "./client";

export function GreetingPanel() {
  const [message, setMessage] = createSignal("Ready for a typed server call.");
  const [detail, setDetail] = createSignal(
    "createServerFn is waiting on the server",
  );
  const [pending, setPending] = createSignal(false);

  const callServer = async () => {
    setPending(true);

    try {
      const result = await api.greeting.post({
        body: { name: "Solid" },
      });

      if (result.error) throw result.error;
      if (!result.data) throw new Error("The server returned no greeting");

      setMessage(result.data.message);
      setDetail(
        `server invocation ${result.data.invocation} / ${result.data.runtime}`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The server call failed",
      );
      setDetail("request failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="server-demo">
      <div class="demo-row">
        <span>01</span>
        <code>renderer: solid()</code>
      </div>
      <div class="demo-row">
        <span>02</span>
        <button type="button" onClick={callServer} disabled={pending()}>
          {pending() ? "Calling server…" : message()}
        </button>
      </div>
      <div class="demo-row demo-detail" aria-live="polite">
        <span>03</span>
        <code>{detail()}</code>
      </div>
    </div>
  );
}

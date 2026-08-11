"use client";

import { useState } from "preact/hooks";
import { api } from "./client";

export function GreetingPanel() {
  const [message, setMessage] = useState("Ready for a typed server call.");
  const [detail, setDetail] = useState("createServerFn is waiting on the server");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const callServer = async () => {
    setPending(true);
    setFailed(false);

    try {
      const result = await api.greeting.post({
        body: { name: "Preact" },
      });

      if (result.error) throw result.error;
      if (!result.data) throw new Error("The server returned no greeting");

      setMessage(result.data.message);
      setDetail(`server invocation ${result.data.invocation} / ${result.data.runtime}`);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "The server call failed");
      setDetail("request failed / try again");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="server-demo">
      <div className="demo-row">
        <span>01</span>
        <code>renderer: preact()</code>
      </div>
      <div className="demo-row">
        <span>02</span>
        <button
          type="button"
          className={failed ? "failed" : undefined}
          onClick={callServer}
          disabled={pending}
        >
          {pending ? "Calling server…" : message}
        </button>
      </div>
      <div className="demo-row demo-detail" aria-live="polite">
        <span>03</span>
        <code>{detail}</code>
      </div>
    </div>
  );
}

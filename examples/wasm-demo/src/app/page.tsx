"use client";

import { useEffect, useRef, useState } from "react";
import { calculateInWorker } from "../calculate";

export default function Page() {
  const [left, setLeft] = useState("20");
  const [right, setRight] = useState("22");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Ready. Choose where to run the calculation.");
  const [failed, setFailed] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function run(mode: "browser" | "worker" | "trap") {
    const a = Number(left);
    const b = Number(right);
    if (
      !left.trim() ||
      !right.trim() ||
      ![a, b].every((n) => Number.isInteger(n) && Math.abs(n) <= 1_000_000)
    ) {
      setFailed(true);
      setStatus("Enter two whole numbers between -1,000,000 and 1,000,000.");
      return;
    }
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setFailed(false);
    setStatus(mode === "browser" ? "Loading WebAssembly…" : "Starting browser worker…");
    try {
      const value =
        mode === "browser"
          ? (await import("../wasm/math")).add(a, b)
          : await calculateInWorker(
              {
                left: a,
                right: mode === "trap" ? 0 : b,
                operation: mode === "trap" ? "divide" : "add",
              },
              controller.signal,
            );
      if (!controller.signal.aborted)
        setStatus(`${mode === "browser" ? "Browser" : "Worker"} result: ${value}`);
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailed(true);
        setStatus(`Wasm error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Farm.js / WebAssembly</p>
      <h1>
        Same module.
        <br />
        Two places to run.
      </h1>
      <p className="intro">
        A real compiled Wasm module, loaded on demand. Run it here or in a browser worker. No
        calculation is sent to a server.
      </p>
      <div className="inputs">
        <label>
          First number
          <input type="number" value={left} onChange={(event) => setLeft(event.target.value)} />
        </label>
        <span aria-hidden="true">+</span>
        <label>
          Second number
          <input type="number" value={right} onChange={(event) => setRight(event.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button disabled={pending} onClick={() => void run("browser")}>
          Run in browser
        </button>
        <button disabled={pending} onClick={() => void run("worker")}>
          Run in worker
        </button>
        <button className="quiet" disabled={pending} onClick={() => void run("trap")}>
          Test Wasm error
        </button>
      </div>
      <p className="result" role="status" data-error={failed}>
        {status}
      </p>
      <section>
        <h2>The whole plugin config</h2>
        <pre>
          <code>{'import { wasm } from "@farm.js/wasm";\n\nplugins: [wasm()]'}</code>
        </pre>
        <p>
          The demo adds integers to keep the module easy to inspect. Your app supplies its own Wasm
          library. Use a worker for expensive work; Wasm alone does not move computation off the
          main thread.
        </p>
      </section>
    </main>
  );
}

"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

let calculatedBindingExecutions = 0;
let formBindingExecutions = 0;

export function CalculatedBindingPanel({ maximum = 12 }: { maximum?: number }) {
  const [value, setValue] = useState(2);
  const [active, setActive] = useState(true);
  const percent = Math.min(100, Math.round((value / maximum) * 100));
  const percentLabel = String(percent);

  function advance() {
    setValue((current) => Math.min(maximum, current + 2));
    setActive((current) => !current);
  }

  return (
    <article
      className="edge-card"
      data-experiment="calculated-bindings"
      data-percent={Number(percentLabel)}
      style={{ opacity: active ? 1 : 0.58 }}
    >
      <header>
        <span className="experiment-number">06A</span>
        <div>
          <h3>Calculated style binding</h3>
          <p>Safe Math calls feed text, attributes, and individual CSS properties.</p>
        </div>
      </header>
      <div
        className="binding-meter"
        aria-label={`${percentLabel}% complete`}
        role="progressbar"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
      >
        <span className="binding-meter__fill" style={{ width: `${percent}%` }} />
      </div>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Value</dt>
          <dd data-metric="value">{value}</dd>
        </div>
        <div>
          <dt>Progress</dt>
          <dd data-metric="percent">{percentLabel}%</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++calculatedBindingExecutions}
          </dd>
        </div>
      </dl>
      <button data-action="advance" type="button" onClick={() => advance()}>
        Advance by two
      </button>
    </article>
  );
}

export function FormBindingPanel() {
  const [note, setNote] = useState("Farm");
  const [mode, setMode] = useState("balanced");
  const [enabled, setEnabled] = useState(true);
  const noteLength = Math.min(99, note.length);

  function updateNote(event: FormEvent<HTMLTextAreaElement>) {
    setNote(event.currentTarget.value);
  }

  const updateMode = (event: ChangeEvent<HTMLSelectElement>) => {
    setMode(event.currentTarget.value);
  };

  function updateEnabled(event: ChangeEvent<HTMLInputElement>) {
    setEnabled(event.currentTarget.checked);
  }

  return (
    <article
      className={enabled ? "edge-card edge-card--active" : "edge-card"}
      data-enabled={enabled}
      data-experiment="form-bindings"
    >
      <header>
        <span className="experiment-number">06B</span>
        <div>
          <h3>Controlled form bindings</h3>
          <p>Textarea, select, and checkbox properties stay synchronized.</p>
        </div>
      </header>
      <div className="binding-form">
        <label className="binding-preview">
          Note
          <textarea
            data-input="note"
            rows={2}
            value={note}
            onInput={(event) => updateNote(event)}
          />
        </label>
        <label className="binding-preview">
          Mode
          <select data-input="mode" value={mode} onChange={updateMode}>
            <option value="balanced">Balanced</option>
            <option value="fast">Fast</option>
            <option value="precise">Precise</option>
          </select>
        </label>
        <label className="binding-check">
          <input checked={enabled} type="checkbox" onChange={updateEnabled} />
          <span>Direct bindings enabled</span>
        </label>
      </div>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Length</dt>
          <dd data-metric="length">{noteLength}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd data-metric="mode">{mode}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++formBindingExecutions}
          </dd>
        </div>
      </dl>
      <output className="binding-readout" data-metric="summary">
        {note || "empty"} / {enabled ? "on" : "off"}
      </output>
    </article>
  );
}

export function StaticBindingExperiment() {
  "use no compiler";

  return (
    <section className="edge-lab" aria-labelledby="static-bindings-title">
      <div className="section-heading">
        <span>STATIC BINDINGS / PRODUCTION PROOF</span>
        <h2 id="static-bindings-title">More everyday values, still one fixed tree.</h2>
        <p>
          These cases add safe calculations, per-property styles, handler wrappers, and controlled
          form properties without adding a React render for local updates.
        </p>
      </div>
      <div className="edge-grid edge-grid--paired">
        <CalculatedBindingPanel />
        <FormBindingPanel />
      </div>
    </section>
  );
}

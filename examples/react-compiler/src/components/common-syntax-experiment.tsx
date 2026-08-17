"use client";

import { useState, type FormEvent } from "react";

let commonSyntaxExecutions = 0;
let controlledInputExecutions = 0;

interface CommonSyntaxCounterProps {
  initial?: number;
  label: string;
  onCommit(value: number): void;
}

export function CommonSyntaxCounter({
  initial = 2,
  label: title,
  onCommit,
}: CommonSyntaxCounterProps) {
  const [count, setCount] = useState(initial);
  const [active, setActive] = useState(false);
  const doubled = count * 2;
  const status = active ? "active" : "idle";
  const commit = () => {
    onCommit(doubled);
    setCount((value) => value + 1);
    setActive((value) => !value);
  };

  return (
    <article
      className={active ? "edge-card edge-card--active" : "edge-card"}
      data-count={count}
      data-experiment="common-syntax"
      data-status={status}
    >
      <header>
        <span className="experiment-number">05A</span>
        <div>
          <h3>{title} counter</h3>
          <p>Default and aliased props with one named event handler.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Count</dt>
          <dd data-metric="count">{count}</dd>
        </div>
        <div>
          <dt>Doubled</dt>
          <dd data-metric="doubled">{doubled}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++commonSyntaxExecutions}
          </dd>
        </div>
      </dl>
      <button
        aria-pressed={active}
        data-action="commit"
        type="button"
        onClick={commit}
      >
        Commit named update
      </button>
    </article>
  );
}

interface ControlledSyntaxProps {
  label?: string;
}

export function ControlledSyntax({
  label: fieldLabel = "Display name",
}: ControlledSyntaxProps) {
  const [value, setValue] = useState("");
  const length = value.length;
  const visibleValue = value || "empty";
  const update = (event: FormEvent<HTMLInputElement>) => {
    setValue(event.currentTarget.value);
  };

  return (
    <article className="edge-card" data-experiment="controlled-syntax">
      <header>
        <span className="experiment-number">05B</span>
        <div>
          <h3>Controlled named input</h3>
          <p>A typed handler keeps value, text, and selection coherent.</p>
        </div>
      </header>
      <label className="binding-preview">
        {fieldLabel}
        <input data-input="controlled" value={value} onInput={update} />
      </label>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Value</dt>
          <dd data-metric="value">{visibleValue}</dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd data-metric="length">{length}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++controlledInputExecutions}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function CommonSyntaxExperiment() {
  "use no compiler";

  const [label, setLabel] = useState("Alpha");
  const [committed, setCommitted] = useState(-1);

  return (
    <section className="edge-lab" aria-labelledby="common-syntax-title">
      <div className="section-heading">
        <span>COMMON SYNTAX / BROWSER PROOF</span>
        <h2 id="common-syntax-title">Normal component code, prepared bindings.</h2>
        <p>
          These production-hydrated cases exercise prop defaults and aliases,
          named handlers, parent and local updates in one event, and controlled
          input behavior.
        </p>
      </div>
      <p data-metric="parent-commit">Last parent commit: {committed}</p>
      <div className="edge-grid edge-grid--paired">
        <CommonSyntaxCounter
          label={label}
          onCommit={(value) => {
            setCommitted(value);
            setLabel((current) => (current === "Alpha" ? "Beta" : "Alpha"));
          }}
        />
        <ControlledSyntax />
      </div>
    </section>
  );
}

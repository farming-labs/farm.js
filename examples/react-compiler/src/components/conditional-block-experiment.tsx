"use client";

import { useState } from "react";

let logicalBlockExecutions = 0;
let ternaryBlockExecutions = 0;
let conditionalRangeExecutions = 0;

export function LogicalBlockPanel() {
  const [loading, setLoading] = useState(false);
  const [updates, setUpdates] = useState(0);

  return (
    <article className="edge-card" data-experiment="conditional-logical">
      <header>
        <span className="experiment-number">07A</span>
        <div>
          <h3>Mount or remove one block</h3>
          <p>The build prepares this host branch and its exact DOM bindings.</p>
        </div>
      </header>
      <div className="conditional-stage" aria-live="polite">
        {loading && (
          <p className="conditional-branch" data-branch="loading">
            Loading branch · update {updates}
          </p>
        )}
      </div>
      <dl className="compact-metrics">
        <div>
          <dt>Mounted</dt>
          <dd data-metric="mounted">{loading ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Branch value</dt>
          <dd data-metric="updates">{updates}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++logicalBlockExecutions}
          </dd>
        </div>
      </dl>
      <div className="button-row">
        <button
          data-action="toggle-logical"
          type="button"
          onClick={() => setLoading((value) => !value)}
        >
          {loading ? "Remove branch" : "Mount branch"}
        </button>
        <button
          data-action="increment-logical"
          type="button"
          onClick={() => setUpdates((value) => value + 1)}
        >
          Update branch value
        </button>
      </div>
    </article>
  );
}

export function TernaryBlockPanel() {
  const [enabled, setEnabled] = useState(true);

  return (
    <article className="edge-card" data-experiment="conditional-ternary">
      <header>
        <span className="experiment-number">07B</span>
        <div>
          <h3>Replace one branch</h3>
          <p>The compiler swaps the prepared host branch without rerunning this component body.</p>
        </div>
      </header>
      <div className="conditional-stage" aria-live="polite">
        {enabled ? (
          <strong className="conditional-branch" data-branch="enabled">
            Enabled
          </strong>
        ) : (
          <span className="conditional-branch conditional-branch--paused" data-branch="disabled">
            Disabled
          </span>
        )}
      </div>
      <dl className="compact-metrics">
        <div>
          <dt>Branch</dt>
          <dd data-metric="branch">{enabled ? "on" : "off"}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>Compiler</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++ternaryBlockExecutions}
          </dd>
        </div>
      </dl>
      <button
        data-action="toggle-ternary"
        type="button"
        onClick={() => setEnabled((value) => !value)}
      >
        Replace branch
      </button>
    </article>
  );
}

export function ConditionalRangePanel() {
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [updates, setUpdates] = useState(0);

  return (
    <article
      className="edge-card conditional-range-root"
      data-experiment="conditional-ranges"
      data-update={updates}
    >
      <header data-static="range-header">
        <span className="experiment-number">07C</span>
        <div>
          <h3>Keep the root, change its ranges</h3>
          <p>Two direct branches update between static siblings without a wrapper or marker.</p>
        </div>
      </header>
      {loading && (
        <p className="conditional-branch conditional-range-branch" data-slot="range-loading">
          Loading update {updates}
        </p>
      )}
      <div className="conditional-range-static" data-static="range-content">
        <span>Stable content</span>
        <strong data-metric="range-updates">Update {updates}</strong>
      </div>
      {enabled ? (
        <strong className="conditional-branch conditional-range-branch" data-slot="range-status">
          Enabled at {updates}
        </strong>
      ) : (
        <span
          className="conditional-branch conditional-branch--paused conditional-range-branch"
          data-slot="range-status"
        >
          Disabled at {updates}
        </span>
      )}
      <dl className="compact-metrics" data-static="range-metrics">
        <div>
          <dt>Slots</dt>
          <dd>2</dd>
        </div>
        <div>
          <dt>Root</dt>
          <dd>Same</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="range-executions">
            {typeof window === "undefined" ? 1 : ++conditionalRangeExecutions}
          </dd>
        </div>
      </dl>
      <footer className="button-row" data-static="range-footer">
        <button
          data-action="increment-ranges"
          type="button"
          onClick={() => setUpdates((value) => value + 1)}
        >
          Update bindings
        </button>
        <button
          data-action="toggle-ranges"
          type="button"
          onClick={() => {
            setLoading((value) => !value);
            setEnabled((value) => !value);
          }}
        >
          Change both ranges
        </button>
      </footer>
    </article>
  );
}

export function ConditionalBlockExperiment() {
  "use no compiler";

  return (
    <section className="edge-lab" aria-labelledby="conditional-blocks-title">
      <div className="section-heading">
        <span>CONDITIONAL BLOCKS / PRODUCTION PROOF</span>
        <h2 id="conditional-blocks-title">Change the branch, not the whole component.</h2>
        <p>
          A dedicated host container starts with React for SSR and hydration. After mount, the
          compiler patches, mounts, removes, or replaces its proven host-only branch directly.
        </p>
      </div>
      <div className="edge-grid edge-grid--paired">
        <LogicalBlockPanel />
        <TernaryBlockPanel />
        <ConditionalRangePanel />
      </div>
    </section>
  );
}

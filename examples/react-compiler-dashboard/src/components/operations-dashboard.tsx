"use client";

import { useState } from "react";

let dashboardExecutions = 0;

export function OperationsDashboard() {
  const [live, setLive] = useState(true);
  const [pulse, setPulse] = useState(0);
  const [liveSeries, setLiveSeries] = useState(52);
  const [snapshotSeries, setSnapshotSeries] = useState(35);
  const [inactiveUpdates, setInactiveUpdates] = useState(0);
  const [grossVolume, setGrossVolume] = useState(842_910);
  const [activeSessions, setActiveSessions] = useState(18_240);
  const [latency, setLatency] = useState(42);
  const [region, setRegion] = useState(0);

  return (
    <section
      className="dashboard"
      data-benchmark="dashboard"
      data-live={live}
      data-revision={pulse}
      id="dashboard"
    >
      <header className="dashboard-heading">
        <div>
          <span className="section-index">01 / OPERATIONS</span>
          <h1>Revenue infrastructure</h1>
          <p>Live commerce, risk, and fulfillment signals in one operational surface.</p>
        </div>
        <div className="dashboard-actions">
          <button
            className="button button--quiet"
            data-action="dashboard-region"
            type="button"
            onClick={() => setRegion((value) => (value + 1) % 3)}
          >
            Region: {region === 0 ? "Global" : region === 1 ? "Americas" : "EMEA"}
          </button>
          <button
            className="button button--quiet"
            data-action="dashboard-toggle"
            type="button"
            onClick={() => setLive((value) => !value)}
          >
            {live ? "Pause feed" : "Resume feed"}
          </button>
          <button
            className="button button--primary"
            data-action="dashboard-pulse"
            type="button"
            onClick={() => {
              setPulse((value) => value + 1);
              setLiveSeries((value) => (value + 11) % 100);
              setGrossVolume((value) => value + 1_375);
              setActiveSessions((value) => value + 37);
              setLatency((value) => 34 + ((value + 7) % 25));
            }}
          >
            Run live pulse <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>

      <div className="runtime-strip" aria-live="polite">
        <span className={live ? "live-indicator live-indicator--on" : "live-indicator"}>
          <i />
          <b>{live ? "LIVE STREAM" : "SNAPSHOT"}</b>
        </span>
        <span>
          FRAME <strong data-metric="dashboard-pulse">{pulse}</strong>
        </span>
        <span>
          OWNER EXECUTIONS{" "}
          <strong data-metric="dashboard-executions">
            {typeof window === "undefined" ? 1 : ++dashboardExecutions}
          </strong>
        </span>
        <span>
          SCOPE <strong>{region === 0 ? "GLB" : region === 1 ? "AMR" : "EMEA"}</strong>
        </span>
      </div>

      <div className="metric-grid">
        <article className="metric-panel metric-panel--featured">
          <span>Gross volume / 24H</span>
          <strong data-metric="gross-volume">${grossVolume}</strong>
          <div>
            <b>+12.8%</b>
            <small>vs prior period</small>
          </div>
        </article>
        <article className="metric-panel">
          <span>Active sessions</span>
          <strong data-metric="active-sessions">{activeSessions}</strong>
          <div>
            <b>+4.2%</b>
            <small>conversion 4.81%</small>
          </div>
        </article>
        <article className="metric-panel">
          <span>Edge latency</span>
          <strong data-metric="latency">{latency} ms</strong>
          <div>
            <b className={latency < 50 ? "good" : "warning"}>
              {latency < 50 ? "HEALTHY" : "WATCH"}
            </b>
            <small>p95 / 18 regions</small>
          </div>
        </article>
        <article className="metric-panel">
          <span>Payment success</span>
          <strong>{live ? 99_97 : 99_82} bp</strong>
          <div>
            <b>+18 bp</b>
            <small>{live ? "live window" : "saved window"}</small>
          </div>
        </article>
      </div>

      <div className="dashboard-grid">
        <article className="chart-panel">
          <header className="panel-heading">
            <div>
              <span>ORDER VELOCITY</span>
              <h2>{live ? "Live demand" : "Last synchronized window"}</h2>
            </div>
            <div className="legend">
              <span>
                <i className="legend-current" /> current
              </span>
              <span>
                <i /> capacity
              </span>
            </div>
          </header>

          <div
            className="bar-chart"
            aria-label={live ? "Live order velocity chart" : "Saved order velocity chart"}
            role="img"
          >
            <i
              data-bar="01"
              data-value={(live ? liveSeries : snapshotSeries) + 1}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 7) % 78) + 18}%` }}
            />
            <i
              data-bar="02"
              data-value={(live ? liveSeries : snapshotSeries) + 2}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 14) % 78) + 18}%` }}
            />
            <i
              data-bar="03"
              data-value={(live ? liveSeries : snapshotSeries) + 3}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 21) % 78) + 18}%` }}
            />
            <i
              data-bar="04"
              data-value={(live ? liveSeries : snapshotSeries) + 4}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 28) % 78) + 18}%` }}
            />
            <i
              data-bar="05"
              data-value={(live ? liveSeries : snapshotSeries) + 5}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 35) % 78) + 18}%` }}
            />
            <i
              data-bar="06"
              data-value={(live ? liveSeries : snapshotSeries) + 6}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 42) % 78) + 18}%` }}
            />
            <i
              data-bar="07"
              data-value={(live ? liveSeries : snapshotSeries) + 7}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 49) % 78) + 18}%` }}
            />
            <i
              data-bar="08"
              data-value={(live ? liveSeries : snapshotSeries) + 8}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 56) % 78) + 18}%` }}
            />
            <i
              data-bar="09"
              data-value={(live ? liveSeries : snapshotSeries) + 9}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 63) % 78) + 18}%` }}
            />
            <i
              data-bar="10"
              data-value={(live ? liveSeries : snapshotSeries) + 10}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 70) % 78) + 18}%` }}
            />
            <i
              data-bar="11"
              data-value={(live ? liveSeries : snapshotSeries) + 11}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 77) % 78) + 18}%` }}
            />
            <i
              data-bar="12"
              data-value={(live ? liveSeries : snapshotSeries) + 12}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 84) % 78) + 18}%` }}
            />
            <i
              data-bar="13"
              data-value={(live ? liveSeries : snapshotSeries) + 13}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 91) % 78) + 18}%` }}
            />
            <i
              data-bar="14"
              data-value={(live ? liveSeries : snapshotSeries) + 14}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 98) % 78) + 18}%` }}
            />
            <i
              data-bar="15"
              data-value={(live ? liveSeries : snapshotSeries) + 15}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 105) % 78) + 18}%` }}
            />
            <i
              data-bar="16"
              data-value={(live ? liveSeries : snapshotSeries) + 16}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 112) % 78) + 18}%` }}
            />
            <i
              data-bar="17"
              data-value={(live ? liveSeries : snapshotSeries) + 17}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 119) % 78) + 18}%` }}
            />
            <i
              data-bar="18"
              data-value={(live ? liveSeries : snapshotSeries) + 18}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 126) % 78) + 18}%` }}
            />
            <i
              data-bar="19"
              data-value={(live ? liveSeries : snapshotSeries) + 19}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 133) % 78) + 18}%` }}
            />
            <i
              data-bar="20"
              data-value={(live ? liveSeries : snapshotSeries) + 20}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 140) % 78) + 18}%` }}
            />
            <i
              data-bar="21"
              data-value={(live ? liveSeries : snapshotSeries) + 21}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 147) % 78) + 18}%` }}
            />
            <i
              data-bar="22"
              data-value={(live ? liveSeries : snapshotSeries) + 22}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 154) % 78) + 18}%` }}
            />
            <i
              data-bar="23"
              data-value={(live ? liveSeries : snapshotSeries) + 23}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 161) % 78) + 18}%` }}
            />
            <i
              data-bar="24"
              data-value={(live ? liveSeries : snapshotSeries) + 24}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 168) % 78) + 18}%` }}
            />
            <i
              data-bar="25"
              data-value={(live ? liveSeries : snapshotSeries) + 25}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 175) % 78) + 18}%` }}
            />
            <i
              data-bar="26"
              data-value={(live ? liveSeries : snapshotSeries) + 26}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 182) % 78) + 18}%` }}
            />
            <i
              data-bar="27"
              data-value={(live ? liveSeries : snapshotSeries) + 27}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 189) % 78) + 18}%` }}
            />
            <i
              data-bar="28"
              data-value={(live ? liveSeries : snapshotSeries) + 28}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 196) % 78) + 18}%` }}
            />
            <i
              data-bar="29"
              data-value={(live ? liveSeries : snapshotSeries) + 29}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 203) % 78) + 18}%` }}
            />
            <i
              data-bar="30"
              data-value={(live ? liveSeries : snapshotSeries) + 30}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 210) % 78) + 18}%` }}
            />
            <i
              data-bar="31"
              data-value={(live ? liveSeries : snapshotSeries) + 31}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 217) % 78) + 18}%` }}
            />
            <i
              data-bar="32"
              data-value={(live ? liveSeries : snapshotSeries) + 32}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 224) % 78) + 18}%` }}
            />
            <i
              data-bar="33"
              data-value={(live ? liveSeries : snapshotSeries) + 33}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 231) % 78) + 18}%` }}
            />
            <i
              data-bar="34"
              data-value={(live ? liveSeries : snapshotSeries) + 34}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 238) % 78) + 18}%` }}
            />
            <i
              data-bar="35"
              data-value={(live ? liveSeries : snapshotSeries) + 35}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 245) % 78) + 18}%` }}
            />
            <i
              data-bar="36"
              data-value={(live ? liveSeries : snapshotSeries) + 36}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 252) % 78) + 18}%` }}
            />
            <i
              data-bar="37"
              data-value={(live ? liveSeries : snapshotSeries) + 37}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 259) % 78) + 18}%` }}
            />
            <i
              data-bar="38"
              data-value={(live ? liveSeries : snapshotSeries) + 38}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 266) % 78) + 18}%` }}
            />
            <i
              data-bar="39"
              data-value={(live ? liveSeries : snapshotSeries) + 39}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 273) % 78) + 18}%` }}
            />
            <i
              data-bar="40"
              data-value={(live ? liveSeries : snapshotSeries) + 40}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 280) % 78) + 18}%` }}
            />
            <i
              data-bar="41"
              data-value={(live ? liveSeries : snapshotSeries) + 41}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 287) % 78) + 18}%` }}
            />
            <i
              data-bar="42"
              data-value={(live ? liveSeries : snapshotSeries) + 42}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 294) % 78) + 18}%` }}
            />
            <i
              data-bar="43"
              data-value={(live ? liveSeries : snapshotSeries) + 43}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 301) % 78) + 18}%` }}
            />
            <i
              data-bar="44"
              data-value={(live ? liveSeries : snapshotSeries) + 44}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 308) % 78) + 18}%` }}
            />
            <i
              data-bar="45"
              data-value={(live ? liveSeries : snapshotSeries) + 45}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 315) % 78) + 18}%` }}
            />
            <i
              data-bar="46"
              data-value={(live ? liveSeries : snapshotSeries) + 46}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 322) % 78) + 18}%` }}
            />
            <i
              data-bar="47"
              data-value={(live ? liveSeries : snapshotSeries) + 47}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 329) % 78) + 18}%` }}
            />
            <i
              data-bar="48"
              data-value={(live ? liveSeries : snapshotSeries) + 48}
              style={{ height: `${(((live ? liveSeries : snapshotSeries) + 336) % 78) + 18}%` }}
            />
          </div>
          <footer className="chart-axis">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </footer>
        </article>

        <aside className="activity-panel">
          <header className="panel-heading">
            <div>
              <span>LIVE ACTIVITY</span>
              <h2>Regional events</h2>
            </div>
            <b>{live ? "STREAMING" : "PAUSED"}</b>
          </header>
          <ol className="activity-list">
            <li>
              <i className="event-success" />
              <div>
                <strong>Payment batch settled</strong>
                <span>Frankfurt · eu-central</span>
              </div>
              <time>00:{12 + pulse}</time>
            </li>
            <li>
              <i />
              <div>
                <strong>Capacity scaled</strong>
                <span>Virginia · us-east</span>
              </div>
              <time>00:{9 + pulse}</time>
            </li>
            <li>
              <i className="event-warning" />
              <div>
                <strong>Risk rule reviewed</strong>
                <span>Singapore · ap-south</span>
              </div>
              <time>00:{6 + pulse}</time>
            </li>
            <li>
              <i />
              <div>
                <strong>Inventory synchronized</strong>
                <span>São Paulo · sa-east</span>
              </div>
              <time>00:{3 + pulse}</time>
            </li>
          </ol>
        </aside>
      </div>

      <div className="branch-lab">
        <div>
          <span>HYBRID BRANCH PROBE</span>
          <strong>
            Visible series: {live ? liveSeries : snapshotSeries} / hidden series:{" "}
            {live ? snapshotSeries : liveSeries}
          </strong>
          <p>
            The button changes only the inactive chart source plus this counter. Static mode checks
            every possible chart binding; hybrid mode stays subscribed only to the active branch.
          </p>
        </div>
        <dl>
          <div>
            <dt>Inactive updates</dt>
            <dd data-metric="inactive-updates">{inactiveUpdates}</dd>
          </div>
          <div>
            <dt>Prepared chart bindings</dt>
            <dd>96</dd>
          </div>
        </dl>
        <button
          className="button button--probe"
          data-action="dashboard-inactive"
          type="button"
          onClick={() => {
            setSnapshotSeries((value) => (value + 13) % 100);
            setInactiveUpdates((value) => value + 1);
          }}
        >
          Update inactive branch
        </button>
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";

let heavyExecutions = 0;

// This tree is intentionally expanded instead of generated with Array.map().
// Dynamic keyed children are a compiler fallback today, while this benchmark
// isolates the supported static-tree update path under a genuinely heavy DOM.
export function HeavyInteractionBenchmark() {
  const [tick, setTick] = useState(0);
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);

  return (
    <section
      className={
        active ? "heavy-benchmark heavy-benchmark--active" : "heavy-benchmark"
      }
      data-active={active}
      data-benchmark="heavy"
      data-level={level}
      data-tick={tick}
    >
      <header className="heavy-heading">
        <div>
          <span className="experiment-number">05</span>
          <div>
            <p className="heavy-kicker">FLAG ON / FLAG OFF</p>
            <h2>Heavy interaction workload</h2>
          </div>
        </div>
        <span className="node-badge">768 STATIC HOST NODES</span>
      </header>

      <p className="heavy-copy">
        Every update changes three state cells and a few prepared targets inside
        a deliberately large static tree. The dual-build runner measures this
        exact component with the compiler enabled and disabled.
      </p>

      <dl className="heavy-metrics" aria-live="polite">
        <div>
          <dt>Interaction</dt>
          <dd data-metric="heavy-tick">{tick}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd data-metric="heavy-status">{active ? "active" : "idle"}</dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd data-metric="heavy-level">{level}</dd>
        </div>
        <div>
          <dt>Component executions</dt>
          <dd data-metric="heavy-executions">
            {typeof window === "undefined" ? 1 : ++heavyExecutions}
          </dd>
        </div>
      </dl>

      <div className="heavy-controls">
        <button
          type="button"
          data-action="heavy-update"
          onClick={() => {
            setTick((value) => value + 1);
            setActive((value) => !value);
            setLevel((value) => (value + 7) % 100);
          }}
        >
          Run one heavy update
          <span aria-hidden="true">↗</span>
        </button>
        <button
          type="button"
          data-action="heavy-reset"
          onClick={() => {
            setTick(0);
            setActive(false);
            setLevel(0);
          }}
        >
          Reset workload
        </button>
      </div>

      <div className="workload-grid" aria-hidden="true">
        <span className="workload-cell" data-cell="1">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="2">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="3">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="4">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="5">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="6">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="7">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="8">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="9">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="10">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="11">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="12">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="13">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="14">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="15">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="16">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="17">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="18">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="19">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="20">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="21">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="22">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="23">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="24">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="25">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="26">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="27">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="28">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="29">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="30">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="31">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="32">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="33">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="34">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="35">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="36">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="37">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="38">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="39">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="40">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="41">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="42">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="43">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="44">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="45">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="46">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="47">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="48">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="49">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="50">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="51">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="52">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="53">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="54">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="55">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="56">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="57">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="58">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="59">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="60">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="61">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="62">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="63">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="64">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="65">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="66">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="67">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="68">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="69">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="70">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="71">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="72">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="73">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="74">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="75">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="76">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="77">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="78">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="79">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="80">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="81">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="82">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="83">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="84">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="85">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="86">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="87">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="88">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="89">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="90">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="91">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="92">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="93">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="94">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="95">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="96">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="97">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="98">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="99">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="100">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="101">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="102">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="103">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="104">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="105">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="106">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="107">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="108">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="109">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="110">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="111">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="112">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="113">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="114">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="115">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="116">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="117">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="118">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="119">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="120">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="121">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="122">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="123">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="124">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="125">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="126">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="127">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="128">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="129">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="130">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="131">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="132">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="133">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="134">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="135">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="136">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="137">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="138">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="139">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="140">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="141">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="142">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="143">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="144">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="145">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="146">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="147">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="148">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="149">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="150">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="151">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="152">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="153">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="154">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="155">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="156">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="157">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="158">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="159">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="160">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="161">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="162">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="163">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="164">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="165">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="166">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="167">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="168">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="169">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="170">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="171">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="172">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="173">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="174">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="175">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="176">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="177">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="178">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="179">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="180">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="181">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="182">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="183">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="184">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="185">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="186">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="187">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="188">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="189">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="190">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="191">
          <i />
          <i />
          <i />
        </span>
        <span className="workload-cell" data-cell="192">
          <i />
          <i />
          <i />
        </span>
      </div>

      <footer className="heavy-readout">
        <span>DOM TARGET CHECK</span>
        <output data-metric="heavy-readout">Frame {tick}</output>
      </footer>
    </section>
  );
}

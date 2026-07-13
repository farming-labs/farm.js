'use client';

import { useState } from 'react';
import { integrationApiClient } from '../../../lib/integration-lab-api';

function displayResult(result: { data: unknown; error: Error | null }) {
  return JSON.stringify(result.error ? { error: result.error.message } : result.data);
}

export default function IntegrationLabClient() {
  const [routeResult, setRouteResult] = useState('idle');
  const [endpointResult, setEndpointResult] = useState('idle');
  const [contractResult, setContractResult] = useState('idle');

  async function callRouteIntegration() {
    const result = await integrationApiClient.routeLab.message.post(
      {
        body: { message: 'browser-routes' },
      },
      {
        data: { caller: 'browser' },
      },
    );
    setRouteResult(displayResult(result));
  }

  async function callEndpointIntegration() {
    const result = await integrationApiClient.endpointLab.message.post(
      {
        body: { message: 'browser-endpoints' },
      },
      {
        data: { caller: 'browser' },
      },
    );
    setEndpointResult(displayResult(result));
  }

  async function callContractIntegration() {
    const result = await integrationApiClient.contractLab.sendMessage(
      {
        body: { message: 'browser-api' },
      },
      {
        data: { caller: 'browser' },
      },
    );
    setContractResult(displayResult(result));
  }

  return (
    <section className="space-y-4" aria-labelledby="browser-integration-callers">
      <h2 id="browser-integration-callers" className="text-xl font-semibold text-slate-950">
        Browser callers
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <article className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
          <h3 className="font-semibold">routes</h3>
          <button
            type="button"
            data-testid="call-integration-routes"
            onClick={callRouteIntegration}
            className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
          >
            Call routes API
          </button>
          <output data-testid="integration-client-routes" className="block break-words text-sm">
            {routeResult}
          </output>
        </article>

        <article className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
          <h3 className="font-semibold">endpoints</h3>
          <button
            type="button"
            data-testid="call-integration-endpoints"
            onClick={callEndpointIntegration}
            className="rounded bg-blue-700 px-3 py-2 text-sm text-white"
          >
            Call endpoints API
          </button>
          <output data-testid="integration-client-endpoints" className="block break-words text-sm">
            {endpointResult}
          </output>
        </article>

        <article className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
          <h3 className="font-semibold">api</h3>
          <button
            type="button"
            data-testid="call-integration-api"
            onClick={callContractIntegration}
            className="rounded bg-emerald-700 px-3 py-2 text-sm text-white"
          >
            Call explicit API
          </button>
          <output data-testid="integration-client-api" className="block break-words text-sm">
            {contractResult}
          </output>
        </article>
      </div>
    </section>
  );
}

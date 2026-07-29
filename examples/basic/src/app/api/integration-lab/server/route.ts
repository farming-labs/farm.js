import { createEndpoint } from '@farm.js/core';
import { integrationApi } from '../../../../lib/integration-lab-api.ts';

export const GET = createEndpoint(
  '/api/integration-lab/server',
  { method: 'GET' },
  async () => {
    const routes = await integrationApi.routeLab.message.post(
      {
        body: { message: 'server-routes' },
      },
      {
        data: { caller: 'server' },
      },
    );
    const endpoints = await integrationApi.endpointLab.message.post(
      {
        body: { message: 'server-endpoints' },
      },
      {
        data: { caller: 'server' },
      },
    );
    const api = await integrationApi.contractLab.sendMessage(
      {
        body: { message: 'server-api' },
      },
      {
        data: { caller: 'server' },
      },
    );

    if (routes.error || endpoints.error || api.error) {
      throw routes.error || endpoints.error || api.error;
    }

    return {
      routes: routes.data,
      endpoints: endpoints.data,
      api: api.data,
    };
  },
);

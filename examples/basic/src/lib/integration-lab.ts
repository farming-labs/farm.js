import {
  defineIntegration,
  endpoint,
  integrationRoute,
  type FarmIntegrationHandlerContext,
} from '@farmjs/core';
import { z } from 'zod';

const messageBody = z.object({
  message: z.string().trim().min(1),
});

export type IntegrationLabBody = z.output<typeof messageBody>;

export interface IntegrationLabResult {
  source: 'routes' | 'endpoints' | 'api';
  message: string;
  caller: string;
  requestId: string;
  trace: string[];
  lifecycle?: {
    label: string;
    setup: boolean;
    ready: boolean;
  };
}

const TRACE_KEY = 'integration-lab:trace';

function appendTrace(context: FarmIntegrationHandlerContext, step: string) {
  const trace = context.req.get<string[]>(TRACE_KEY) || [];
  context.req.set(TRACE_KEY, [...trace, step]);
}

function readTrace(context: FarmIntegrationHandlerContext) {
  return context.req.get<string[]>(TRACE_KEY) || [];
}

function readCaller(context: FarmIntegrationHandlerContext) {
  return typeof context.data.caller === 'string' ? context.data.caller : 'direct';
}

const routeLabState = {
  label: 'pending',
  setup: false,
  ready: false,
};

const routeLab = defineIntegration({
  category: 'custom',
  type: 'integration-routes-lab',
  instance: routeLabState,
  config: {
    schema: z.object({
      label: z.string().min(1),
    }),
    defaults: {
      label: 'configured',
    },
  },
  validate({ integrationConfig }) {
    if (integrationConfig.label !== 'configured') {
      throw new Error('Integration lab config did not resolve.');
    }
  },
  setup({ integrationConfig }) {
    routeLabState.label = integrationConfig.label;
    routeLabState.setup = true;
  },
  ready() {
    routeLabState.ready = true;
  },
  middleware: [
    {
      matcher: '/api/route-lab/message',
      handler(_request, context) {
        appendTrace(context, 'integration-middleware');
      },
    },
  ],
  routes: [
    integrationRoute.post<
      '/api/route-lab/message',
      IntegrationLabBody,
      IntegrationLabResult
    >('/api/route-lab/message', {
      body: messageBody,
      responseFormat: 'json',
      middleware: [
        {
          handler(_request, context) {
            appendTrace(context, 'route-middleware');
          },
        },
      ],
      before: [
        (_request, context) => {
          appendTrace(context, 'before');
        },
      ],
      handler(_request, context) {
        appendTrace(context, 'handler');

        return Response.json({
          source: 'routes',
          message: context.input.body!.message,
          caller: readCaller(context),
          requestId: context.requestId,
          trace: readTrace(context),
          lifecycle: { ...routeLabState },
        } satisfies IntegrationLabResult);
      },
      after: [
        (_request, context) => {
          context.response?.headers.set('x-integration-after', 'routes');
        },
      ],
    }),
  ],
});

const endpointLab = defineIntegration({
  category: 'custom',
  type: 'integration-endpoints-lab',
  instance: {},
  endpoints: ({ endpoint }) => ({
    messages: {
      echo: endpoint.post<
        '/api/endpoint-lab/message',
        IntegrationLabBody,
        IntegrationLabResult
      >('/api/endpoint-lab/message', {
        body: messageBody,
        responseFormat: 'json',
        handler(_request, context) {
          appendTrace(context, 'handler');

          return Response.json({
            source: 'endpoints',
            message: context.input.body!.message,
            caller: readCaller(context),
            requestId: context.requestId,
            trace: readTrace(context),
          } satisfies IntegrationLabResult);
        },
        after: [
          (_request, context) => {
            context.response?.headers.set('x-integration-after', 'endpoints');
          },
        ],
      }),
    },
  }),
});

const contractRoute = integrationRoute.post<
  '/api/contract-lab/message',
  IntegrationLabBody,
  IntegrationLabResult
>('/api/contract-lab/message', {
  body: messageBody,
  responseFormat: 'json',
  handler(_request, context) {
    appendTrace(context, 'handler');

    return Response.json({
      source: 'api',
      message: context.input.body!.message,
      caller: readCaller(context),
      requestId: context.requestId,
      trace: readTrace(context),
    } satisfies IntegrationLabResult);
  },
  after: [
    (_request, context) => {
      context.response?.headers.set('x-integration-after', 'api');
    },
  ],
});

const contractLab = defineIntegration({
  category: 'custom',
  type: 'integration-api-lab',
  instance: {},
  routes: [contractRoute],
  api: {
    sendMessage: endpoint.post<IntegrationLabBody, IntegrationLabResult>(
      '/api/contract-lab/message',
      {
        responseFormat: 'json',
      },
    ),
  },
});

export const integrationLab = {
  routeLab,
  endpointLab,
  contractLab,
} as const;

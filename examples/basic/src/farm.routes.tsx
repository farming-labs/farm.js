import {
  createRoute,
  defer,
  defineRoutes,
  getFarmDataCache,
  notFound,
  redirect,
  revalidatePath,
  type InferProgrammaticRouteData,
  type Deferred,
  type ProgrammaticPageRoute,
} from '@farm.js/core';
import { z } from 'zod';
import {
  readRuntimeBoundary,
  readServerBoundary,
} from './lib/environment-boundaries';
import {
  FeatureProductError,
  FeatureProductNotFound,
  FeatureProductPage,
  FeatureProductPending,
  FeatureStaticPage,
} from './features/recent/product-page';

const featureProductParams = z.object({
  id: z.string().min(1),
});

const featureProductSearch = z.object({
  tab: z.enum(['info', 'reviews']).default('info'),
  locale: z.string().default('en'),
  toast: z.string().optional(),
  access: z.enum(['granted', 'denied']).default('granted'),
});

export type FeatureProductParams = z.infer<typeof featureProductParams>;
export type FeatureProductSearch = z.infer<typeof featureProductSearch>;

interface FeatureProductBefore {
  preparedBy: string;
}

export interface FeatureProductData {
  id: string;
  tenantId: string;
  preparedBy: string;
  mainCall: number;
  serverBoundary: string;
  runtimeBoundary: string;
  reviews: Deferred<string[]>;
}

interface FeatureLabRuntimeState {
  mainCalls: number;
  afterCalls: number;
}

const featureLabGlobal = globalThis as typeof globalThis & {
  __farmRecentFeatureLab?: FeatureLabRuntimeState;
};
const featureLabState = (featureLabGlobal.__farmRecentFeatureLab ??= {
  mainCalls: 0,
  afterCalls: 0,
});

export const FeatureProductRoute = createRoute('/feature-lab/products/[id]', {
  params: featureProductParams,
  search: {
    schema: featureProductSearch,
    stripDefaults: true,
    preserve: ['locale'],
    temporary: ['toast'],
  },
  guard({ search }) {
    if (search.access === 'denied') {
      redirect('/feature-lab/login');
    }
  },
  data: {
    before({ params, context }): FeatureProductBefore {
      return {
        preparedBy: `${context.tenant.id}:${params.id}:${context.requestId}`,
      };
    },
    key: ({ params, search, context }) => [
      'feature-product',
      params.id,
      search.locale,
      context.tenant.id,
    ],
    staleTime: '30s',
    tags: ({ params }) => [`feature-product:${params.id}`],
    async main({ params, context, before }): Promise<FeatureProductData> {
      const reviews = defer(
        new Promise<string[]>((resolve) => {
          setTimeout(() => resolve([`Review for ${params.id}`, 'Deferred route data']), 300);
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 120));

      if (params.id === 'missing') notFound();
      if (params.id === 'error') throw new Error('Feature product failed to load.');

      return {
        id: params.id,
        tenantId: context.tenant.id,
        preparedBy: before.preparedBy,
        mainCall: ++featureLabState.mainCalls,
        serverBoundary: readServerBoundary(),
        runtimeBoundary: readRuntimeBoundary(),
        reviews,
      };
    },
    after() {
      featureLabState.afterCalls += 1;
    },
  },
  pending: FeatureProductPending,
  error: FeatureProductError,
  notFound: FeatureProductNotFound,
  component: FeatureProductPage,
  render: 'dynamic',
  metadata: {
    title: 'Feature product | Farm.js',
  },
});

const featureStaticParams = z.object({ slug: z.string() });

export const FeatureStaticRoute = createRoute('/feature-lab/static/[slug]', {
  params: featureStaticParams,
  render: 'static',
  staticPaths: async () => ['alpha', 'beta'],
  component: FeatureStaticPage,
  metadata: {
    title: 'Static programmatic feature | Farm.js',
  },
});

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
type Assert<TValue extends true> = TValue;
type InferredProductData = InferProgrammaticRouteData<NonNullable<typeof FeatureProductRoute.data>>;
type InferredProductParams = typeof FeatureProductRoute extends ProgrammaticPageRoute<
  infer TParams,
  any,
  any
>
  ? TParams
  : never;
type _ProductDataIsTyped = Assert<Equal<InferredProductData, FeatureProductData>>;
type _ProductParamsAreTyped = Assert<Equal<InferredProductParams, FeatureProductParams>>;

export default defineRoutes(({ api, redirect: routeRedirect }) => [
  FeatureProductRoute,
  FeatureStaticRoute,
  api('/api/feature-lab/state', {
    GET: async () => Response.json(featureLabState),
    DELETE: async () => {
      featureLabState.mainCalls = 0;
      featureLabState.afterCalls = 0;
      getFarmDataCache().clear();
      return Response.json({ ok: true });
    },
  }),
  api('/api/feature-lab/cache/[id]', {
    POST: async (_request: Request, context: { params: Promise<{ id: string }> }) => {
      const { id } = await context.params;
      revalidatePath(`/feature-lab/products/${id}`);
      return Response.json({ invalidated: id });
    },
  }),
  routeRedirect('/feature-lab/legacy/[id]', '/feature-lab/products/[id]', {
    permanent: false,
  }),
]);

void (0 as unknown as _ProductDataIsTyped);
void (0 as unknown as _ProductParamsAreTyped);

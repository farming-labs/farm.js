import { Suspense, use } from 'react';
import type {
  Deferred,
  ProgrammaticRouteComponentProps,
  ProgrammaticRouteErrorComponentProps,
  ProgrammaticRoutePendingComponentProps,
} from '@farmjs/core';
import type {
  FeatureProductData,
  FeatureProductParams,
  FeatureProductSearch,
} from '../../farm.routes';

type ProductPageProps = ProgrammaticRouteComponentProps<
  FeatureProductParams,
  FeatureProductSearch,
  FeatureProductData
>;

export function FeatureProductPage({ params, search, data }: ProductPageProps) {
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-6 py-12">
      <p className="text-sm font-semibold uppercase text-blue-700">Programmatic route</p>
      <h1 className="text-3xl font-bold text-slate-950">Product {params.id}</h1>
      <dl className="grid gap-3 rounded-md border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-slate-500">Tab</dt>
          <dd data-testid="product-tab" className="font-medium text-slate-950">
            {search.tab}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Locale</dt>
          <dd data-testid="product-locale" className="font-medium text-slate-950">
            {search.locale}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Tenant context</dt>
          <dd data-testid="product-tenant" className="font-medium text-slate-950">
            {data.tenantId}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Data execution</dt>
          <dd data-testid="product-main-call" className="font-medium text-slate-950">
            {data.mainCall}
          </dd>
        </div>
      </dl>
      <p data-testid="product-before" className="text-slate-700">
        {data.preparedBy}
      </p>
      <p data-testid="product-server-boundary" className="text-slate-700">
        {data.serverBoundary}
      </p>
      <p data-testid="product-runtime-boundary" className="text-slate-700">
        {data.runtimeBoundary}
      </p>
      <Suspense fallback={<p data-testid="product-reviews-pending">Loading reviews...</p>}>
        <FeatureProductReviews reviews={data.reviews} />
      </Suspense>
    </main>
  );
}

function FeatureProductReviews({ reviews }: { reviews: Deferred<string[]> }) {
  const resolvedReviews = use(reviews);
  return (
    <ul data-testid="product-reviews" className="space-y-1 text-slate-700">
      {resolvedReviews.map((review) => (
        <li key={review}>{review}</li>
      ))}
    </ul>
  );
}

export function FeatureProductPending(
  _props: ProgrammaticRoutePendingComponentProps<FeatureProductParams, FeatureProductSearch>,
) {
  return <p data-testid="product-pending">Loading programmatic product...</p>;
}

export function FeatureProductError({
  error,
}: ProgrammaticRouteErrorComponentProps<FeatureProductParams, FeatureProductSearch>) {
  const message = error instanceof Error ? error.message : 'Unknown product error';
  return <p data-testid="product-error">{message}</p>;
}

export function FeatureProductNotFound() {
  return <p data-testid="product-not-found">Product was not found.</p>;
}

export function FeatureStaticPage({ params }: { params: { slug: string } }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 data-testid="static-feature">Static feature: {params.slug}</h1>
    </main>
  );
}

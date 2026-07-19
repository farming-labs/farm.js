'use client';

import { useEffect, useState } from 'react';
import {
  Link,
  useBlocker,
  useNavigation,
  usePageState,
  useRouter,
} from '@farmjs/core/client';
import { getPublicEnv } from '@farmjs/core/env';
import {
  readClientBoundary,
  readRuntimeBoundary,
} from '../../lib/environment-boundaries';

interface FeaturePageState {
  panel?: 'details' | 'activity';
}

export default function FeatureLabClient() {
  const [dirty, setDirty] = useState(false);
  const [clientBoundary, setClientBoundary] = useState('pending');
  const [runtimeBoundary, setRuntimeBoundary] = useState('pending');
  const navigation = useNavigation();
  const pageState = usePageState<FeaturePageState>();
  const router = useRouter();

  useBlocker({
    when: dirty,
    message: 'Leave the framework feature lab?',
  });

  useEffect(() => {
    setClientBoundary(readClientBoundary());
    setRuntimeBoundary(readRuntimeBoundary());
  }, []);

  return (
    <section className="space-y-6">
      <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <p data-testid="public-env">{getPublicEnv('PUBLIC_APP_NAME')}</p>
        <p data-testid="client-boundary">{clientBoundary}</p>
        <p data-testid="client-runtime-boundary">{runtimeBoundary}</p>
        <p data-testid="navigation-state">
          {navigation.pending ? `loading:${navigation.to?.pathname}` : 'idle'}
        </p>
        <p data-testid="page-state">{pageState?.panel ?? 'none'}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="push-page-state"
          onClick={() => router.pushState({ panel: 'details' })}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          Open details state
        </button>
        <button
          type="button"
          data-testid="replace-page-state"
          onClick={() => router.replaceState({ panel: 'activity' })}
          className="rounded border border-slate-300 px-4 py-2"
        >
          Replace with activity
        </button>
        <label className="flex items-center gap-2 rounded border border-slate-300 px-4 py-2">
          <input
            data-testid="dirty-toggle"
            type="checkbox"
            checked={dirty}
            onChange={(event) => setDirty(event.target.checked)}
          />
          Unsaved changes
        </label>
      </div>

      <nav className="flex flex-wrap gap-3">
        <Link
          href="/feature-lab/products/[id]"
          params={{ id: '42' }}
          query={{ tab: 'reviews', locale: 'am', toast: 'opened' }}
          prefetch="intent"
          viewTransition
          data-testid="typed-product-link"
          className="rounded bg-blue-700 px-4 py-2 text-white"
        >
          Typed product link
        </Link>
        <Link
          href="/feature-lab/products/[id]"
          params={{ id: '43' }}
          query={{ locale: 'en' }}
          prefetch="none"
          data-testid="unprefetched-product-link"
          className="rounded border border-blue-700 px-4 py-2 text-blue-800"
        >
          Pending navigation link
        </Link>
        <Link href="/feature-lab/layer" data-testid="layer-link">
          Layer route
        </Link>
        <Link
          href="/store-e2e"
          prefetch="none"
          viewTransition
          data-testid="view-transition-link"
        >
          Client view transition
        </Link>
      </nav>
    </section>
  );
}

import React from 'react';
import { Link } from '@farmjs/core/client';
import SlowDetails from './slow-details';


export default function RouteLoadingBoundaryPage() {
  const AsyncSlowDetails = SlowDetails as unknown as React.ComponentType;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Route Loading Boundary Demo</h1>
      <p className="text-gray-600">
        This segment has a <strong>loading.tsx</strong>. The framework wraps this page in Suspense
        with it as the fallback. While the content below is loading, you see that UI—no conditional
        rendering in the page.{' '}
        <Link href="/boundaries/suspense" className="text-blue-600 hover:underline">
          See also: React Suspense example
        </Link>
        .
      </p>
      <AsyncSlowDetails />
    </section>
  );
}

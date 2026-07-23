'use client';

import { useState } from 'react';

export default function OptionalCatchAllPage({ params }: { params: { slug?: string } }) {
  const [count, setCount] = useState(0);
  const slug = params.slug || 'base';

  return (
    <main>
      <h1>Optional catch-all route</h1>
      <p data-testid="optional-catchall-slug">{slug}</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Hydrated count: {count}
      </button>
      <a href="/optional-catchall">Open base route</a>
    </main>
  );
}

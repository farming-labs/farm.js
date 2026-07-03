import { Link } from '@farmjs/core';

export default function Page() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 48, maxWidth: 840 }}>
      <h1>Farm docs integration</h1>
      <p>
        This example serves Markdown docs from <code>src/app/docs</code> and exposes a
        Next-style docs API route from <code>src/app/api/docs/route.ts</code>.
      </p>
      <ul>
        <li>
          <Link href="/docs">Docs home</Link>
        </li>
        <li>
          <Link href="/docs/getting-started">Getting started</Link>
        </li>
        <li>
          <a href="/docs/getting-started.md">Markdown output</a>
        </li>
        <li>
          <a href="/api/docs?format=config">Docs API config</a>
        </li>
        <li>
          <a href="/api/docs?format=markdown&path=getting-started">Docs API markdown</a>
        </li>
      </ul>
    </main>
  );
}

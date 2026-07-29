import { Link } from '@farm.js/core';

export default function Page() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 48, maxWidth: 840 }}>
      <h1>Farm docs integration</h1>
      <p>
        A compact Farm adapter example for the same unified docs surface used by
        <code>@farming-labs/docs</code>: human docs, markdown reads, search, llms output,
        sitemap, robots, skill markdown, and agent discovery.
      </p>
      <p>
        The docs API is registered automatically from <code>farm.config.ts</code>, so this example
        does not need a <code>src/app/api/docs/route.ts</code> file unless you want to override it.
      </p>
      <ul>
        <li>
          <Link href="/docs">Docs home</Link>
        </li>
        <li>
          <Link href="/docs/getting-started">Getting started</Link>
        </li>
        <li>
          <Link href="/docs/server-wrapper">Automatic API route</Link>
        </li>
        <li>
          <a href="/docs/getting-started.md">Markdown output</a>
        </li>
        <li>
          <a href="/api/docs/getting-started.md">API markdown by path</a>
        </li>
        <li>
          <a href="/api/docs?format=config">Docs API config</a>
        </li>
        <li>
          <a href="/api/docs?format=markdown&path=getting-started">Docs API markdown</a>
        </li>
        <li>
          <a href="/api/docs?query=api">Docs API search</a>
        </li>
        <li>
          <a href="/api/docs?format=llms">LLM summary</a>
        </li>
        <li>
          <a href="/api/docs?format=sitemap-xml">Sitemap XML</a>
        </li>
        <li>
          <a href="/api/docs?format=skill">Skill markdown</a>
        </li>
        <li>
          <a href="/api/docs/agent/spec">Agent spec</a>
        </li>
      </ul>
    </main>
  );
}

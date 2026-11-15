import { QueryCount, QueryProvider } from "../../../components/compat/query-client";

async function ServerBlock() {
  await Promise.resolve();
  return (
    <article>
      <p>Server block between the provider and the query.</p>
      <QueryCount />
    </article>
  );
}

export default function QueryPage() {
  return (
    <section>
      <h1>TanStack Query</h1>
      <QueryProvider>
        <ServerBlock />
      </QueryProvider>
    </section>
  );
}

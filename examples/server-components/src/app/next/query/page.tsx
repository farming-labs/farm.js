import type { PageProps } from "@farm.js/core";

export const dynamic = "force-dynamic";

export default async function QueryPage({ searchParams }: PageProps) {
  const query = await searchParams;
  return (
    <section>
      <h1>Query</h1>
      <p data-testid="query-name">{String(query.name ?? "none")}</p>
    </section>
  );
}

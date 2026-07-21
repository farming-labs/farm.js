import { createFileRoute } from "@tanstack/react-router";

const items = Array.from({ length: 120 }, (_, index) => ({
  id: index + 1,
  label: `Benchmark item ${String(index + 1).padStart(3, "0")}`,
}));

export const Route = createFileRoute("/")({
  component: BenchmarkPage,
  loader: () => ({ renderedAt: Date.now() }),
});

function BenchmarkPage() {
  const { renderedAt } = Route.useLoaderData();

  return (
    <main
      data-benchmark-marker="framework-benchmark-v1"
      data-item-count={items.length}
      data-rendered-at={renderedAt}
    >
      <header>
        <p>Dynamic SSR fixture</p>
        <h1>Framework benchmark fixture</h1>
        <time dateTime={new Date(renderedAt).toISOString()}>{renderedAt}</time>
      </header>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.id}</span>
            <strong>{item.label}</strong>
          </li>
        ))}
      </ul>
    </main>
  );
}

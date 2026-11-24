import { Widget } from "../../../components/widget";

// dash: a page of 24 client components that all hydrate with it, the page an RSC engine is built
// for. Islands mode loads its whole runtime at once here, so this is where its runtime costs most
// (RFC 0013); hydration.mjs measures it.
const WIDGETS = 24;
const VALUES = 20;

export default async function DashboardPage({
  params,
}: {
  params: { slug: string } | Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const n = Number(slug.slice(1));
  return (
    <article>
      <h1>{`Dashboard ${n}`}</h1>
      {Array.from({ length: WIDGETS }, (_, widget) => (
        <Widget
          key={widget}
          title={`Widget ${widget} of ${n}`}
          values={Array.from({ length: VALUES }, (_, value) => widget * 17 + value * 7)}
        />
      ))}
    </article>
  );
}

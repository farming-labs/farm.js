import { Link } from "@farm.js/core/client";
import { RelatedProducts } from "../../../components/related";
import { catalog, getArticle } from "../../../data";

export default async function ProductPage({
  params,
}: {
  params: { slug: string } | Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const n = Number(slug.slice(1));
  const product = catalog[n];
  if (!product) return <h1>Not found</h1>;
  const description = getArticle(`p${n}`)!;
  const next = catalog[n + 1];
  return (
    <article>
      <h1>{product.name}</h1>
      <p>{`$${product.price}`}</p>
      {description.sections.slice(0, 2).map((section) => (
        <p key={section.id}>{section.paragraphs.join(" ")}</p>
      ))}
      <RelatedProducts products={catalog} />
      {next ? (
        <Link href={next.href} data-next>
          {`Next: ${next.name}`}
        </Link>
      ) : null}
    </article>
  );
}

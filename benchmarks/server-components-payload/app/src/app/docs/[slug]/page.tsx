import { Link } from "@farm.js/core/client";
import { CopyButton } from "../../../components/copy-button";
import { Toc } from "../../../components/toc";
import { getArticle, pages } from "../../../data";

export default function DocsPage({ params }: { params: { slug: string } }) {
  const article = getArticle(params.slug);
  if (!article) return <h1>Not found</h1>;
  const n = Number(params.slug.slice(1));
  const next = pages[n + 1];
  return (
    <article>
      <h1>{article.title}</h1>
      <Toc headings={article.headings} />
      {article.sections.map((section) => (
        <section key={section.id} id={section.id}>
          <h2>{section.text}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          <pre>
            <code>{section.code}</code>
          </pre>
          <CopyButton text={section.code} />
        </section>
      ))}
      {next ? (
        <Link href={next.href} data-next>
          {`Next: ${next.title}`}
        </Link>
      ) : null}
    </article>
  );
}

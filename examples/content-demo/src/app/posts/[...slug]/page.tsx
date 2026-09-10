import { getCollection, getEntryOrThrow } from "@farm.js/content/server";
import type { PageProps } from "@farm.js/core";

export const dynamic = "force-static";

export async function getStaticPaths() {
  return (await getCollection("posts")).map((entry) => ({ slug: entry.id.split("/") }));
}

export default async function PostPage({ params }: PageProps<"/posts/[...slug]">) {
  const entry = await getEntryOrThrow("posts", params.slug);

  return (
    <article className="article">
      <a className="back-link" href="/">
        ← All field notes
      </a>
      <header>
        <p className="story-meta">
          {entry.data.publishedAt.toLocaleDateString("en", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })}{" "}
          · {entry.data.readingMinutes} min read
        </p>
        <h1>{entry.data.title}</h1>
        <p className="article-deck">{entry.data.description}</p>
      </header>
      <div className="article-body">
        {entry.body
          .trim()
          .split(/\n\s*\n/)
          .map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
      </div>
      <ul className="article-tags" aria-label="Tags">
        {entry.data.tags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
    </article>
  );
}

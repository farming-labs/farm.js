import { getCollection } from "@farm.js/content/server";

export const dynamic = "force-static";

export default async function HomePage() {
  const posts = [...(await getCollection("posts"))].sort(
    (left, right) => right.data.publishedAt.getTime() - left.data.publishedAt.getTime(),
  );
  const [lead, ...rest] = posts;

  return (
    <>
      <section className="masthead">
        <p className="kicker">A typed publishing demo</p>
        <h1>Write locally.<br />Ship confidently.</h1>
        <p className="intro">
          Markdown stays simple. Schemas, computed fields, hot updates, and production data stay in
          one Farm plugin.
        </p>
      </section>

      {lead ? (
        <a className="lead-story" href={`/posts/${lead.id}`}>
          <div>
            <span className="story-number">01</span>
            <p className="story-meta">{formatDate(lead.data.publishedAt)} · {lead.data.readingMinutes} min</p>
            <h2>{lead.data.title}</h2>
            <p>{lead.data.description}</p>
          </div>
          <span className="read-link">Read field note <span aria-hidden="true">↗</span></span>
        </a>
      ) : null}

      <section className="story-grid" aria-label="More field notes">
        {rest.map((entry, index) => (
          <a className="story-card" href={`/posts/${entry.id}`} key={entry.id}>
            <span className="story-number">{String(index + 2).padStart(2, "0")}</span>
            <p className="story-meta">{formatDate(entry.data.publishedAt)} · {entry.data.readingMinutes} min</p>
            <h2>{entry.data.title}</h2>
            <p>{entry.data.description}</p>
            <ul aria-label="Tags">
              {entry.data.tags.map((tag) => <li key={tag}>{tag}</li>)}
            </ul>
          </a>
        ))}
      </section>
    </>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

import type { Metadata } from "@farm.js/core";
import { ArrowRight, Newspaper } from "lucide-react";
import type { ReactNode } from "react";
import { BlogAuthor } from "../../components/blog/author";
import { BlogExplore } from "../../components/blog/explore";
import { BlogFigure } from "../../components/blog/figures";
import { ReleaseArtwork } from "../../components/blog/release-artwork";
import { IndexedLabel } from "../../components/site-chrome";
import { agentNativePost, launchPost, posts } from "../../lib/blog";

export const metadata = {
  openGraph: { title: "Blog — Farm.js", url: "/blog" },
  title: "Blog — Farm.js",
  description: "Releases, engineering notes, and ideas from the people building Farm.js.",
} satisfies Metadata;

/** Each post's card art. Headings break where their author wants them to. */
const ART: Record<string, { heading: ReactNode; artwork: ReactNode }> = {
  [launchPost.href]: {
    heading: (
      <>
        Farm.js v0.1.0: <span>Stable, Integrated, and Agent-Native.</span>
      </>
    ),
    artwork: <ReleaseArtwork />,
  },
  [agentNativePost.href]: {
    heading: (
      <>
        Making your site <span>agent-native.</span>
      </>
    ),
    artwork: <BlogFigure fit kind="agent-layers" />,
  },
};

export default function BlogPage() {
  const [featured, ...rest] = posts.map(({ post }) => post);

  return (
    <>
      <header className="blog-index-header">
        <div>
          <div className="blog-eyebrow">
            <IndexedLabel index="05" label="From the framework" />
          </div>
          <h1>
            The Farm.js blog<span className="blog-title-period">.</span>
          </h1>
          <p className="blog-index-description">Releases, engineering notes, and ideas.</p>
        </div>
      </header>

      <section className="blog-featured-section" aria-labelledby="latest-title">
        <div className="blog-section-rule farm-full-rule">
          <h2 id="latest-title">
            <IndexedLabel index="05.1" icon={Newspaper} label="Latest posts" />
          </h2>
        </div>
        <article className="blog-featured" aria-labelledby="featured-title">
          <div className="blog-featured-copy">
            <div className="blog-post-meta">
              <span className="blog-category">{featured.category}</span>
              <time dateTime={featured.dateTime}>{featured.date}</time>
            </div>
            <h3 id="featured-title">
              <a href={featured.href}>{ART[featured.href]?.heading ?? featured.title}</a>
            </h3>
            <p>{featured.description}</p>
          </div>
          {ART[featured.href]?.artwork}
          <div className="blog-featured-bottom">
            <BlogAuthor />
            <a className="blog-read-link" href={featured.href}>
              Read article <ArrowRight aria-hidden size={16} strokeWidth={1.5} />
            </a>
          </div>
        </article>
        {rest.length > 0 && (
          <ul className="blog-post-list">
            {rest.map((post) => (
              <li key={post.href}>
                <a href={post.href}>
                  <div className="blog-post-meta">
                    <span className="blog-category">{post.category}</span>
                    <time dateTime={post.dateTime}>{post.date}</time>
                  </div>
                  <h3>{post.title}</h3>
                  <p>{post.description}</p>
                  <span className="blog-post-list-more">
                    Read article <ArrowRight aria-hidden size={14} strokeWidth={1.5} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BlogExplore />
    </>
  );
}

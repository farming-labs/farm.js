import type { Metadata } from "@farm.js/core";
import { ArrowRight, Newspaper } from "lucide-react";
import { BlogAuthor } from "../../components/blog/author";
import { BlogExplore } from "../../components/blog/explore";
import { ReleaseArtwork } from "../../components/blog/release-artwork";
import { IndexedLabel } from "../../components/site-chrome";
import { launchPost } from "../../lib/blog";

export const metadata = {
  openGraph: { title: "Blog — Farm.js", url: "/blog" },
  title: "Blog — Farm.js",
  description: "Releases, engineering notes, and ideas from the people building Farm.js.",
} satisfies Metadata;

export default function BlogPage() {
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
              <span className="blog-category">{launchPost.category}</span>
              <time dateTime={launchPost.dateTime}>{launchPost.date}</time>
            </div>
            <h3 id="featured-title">
              <a href={launchPost.href}>
                Farm.js v0.1.0: <span>Stable, Integrated, and Agent-Native.</span>
              </a>
            </h3>
            <p>{launchPost.description}</p>
          </div>
          <ReleaseArtwork />
          <div className="blog-featured-bottom">
            <BlogAuthor />
            <a className="blog-read-link" href={launchPost.href}>
              Read article <ArrowRight aria-hidden size={16} strokeWidth={1.5} />
            </a>
          </div>
        </article>
      </section>

      <BlogExplore />
    </>
  );
}

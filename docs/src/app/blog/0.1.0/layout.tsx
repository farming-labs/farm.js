import type { LayoutProps } from "@farm.js/core";
import { ArrowLeft } from "lucide-react";
import { BlogAuthor } from "../../../components/blog/author";
import { BlogExplore } from "../../../components/blog/explore";
import { ReleaseArtwork } from "../../../components/blog/release-artwork";
import { launchPost, launchSections } from "../../../lib/blog";

function Contents() {
  return (
    <nav aria-label="On this page" className="blog-contents-links">
      <span className="blog-contents-highlight" aria-hidden="true" />
      <span className="blog-contents-indicator" aria-hidden="true" />
      {launchSections.map(([id, label], index) => (
        <a key={id} href={`#${id}`}>
          <span className="blog-contents-index" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

export default function LaunchPostLayout({ children }: LayoutProps) {
  return (
    <>
      <div className="blog-breadcrumb">
        <a href="/blog" aria-label="All posts" title="All posts">
          <ArrowLeft aria-hidden size={16} />
        </a>
      </div>
      <header className="blog-post-header">
        <div className="blog-post-heading">
          <div className="blog-post-meta">
            <span className="blog-category">{launchPost.category}</span>
            <time dateTime={launchPost.dateTime}>{launchPost.date}</time>
          </div>
          <h1>
            Farm.js v0.1.0: Stable, Integrated, <span>and Agent-Native.</span>
          </h1>
          <p>{launchPost.description}</p>
          <div className="blog-post-byline">
            <BlogAuthor />
          </div>
        </div>
        <ReleaseArtwork fullBleed />
      </header>
      <div className="blog-reading-grid">
        <aside className="blog-contents">
          <div className="blog-contents-sticky">
            <p className="blog-contents-title">
              <span aria-hidden="true">00</span> In this article
            </p>
            <Contents />
          </div>
        </aside>
        <div className="blog-reading-column">
          <details className="blog-mobile-contents">
            <summary>
              In this article <span>{launchSections.length} sections</span>
            </summary>
            <Contents />
          </details>
          <div className="blog-prose">{children}</div>
          <div className="blog-article-end">
            <span aria-hidden className="blog-end-mark">
              ▦
            </span>
            <p>Thanks for building with us.</p>
          </div>
        </div>
      </div>
      <BlogExplore />
    </>
  );
}

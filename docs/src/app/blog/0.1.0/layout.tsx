import type { LayoutProps } from "@farm.js/core";
import { ArrowLeft } from "lucide-react";
import { BlogAuthor } from "../../../components/blog/author";
import { BlogExplore } from "../../../components/blog/explore";
import { ReleaseArtwork } from "../../../components/blog/release-artwork";
import { BlogContents } from "../../../components/blog/contents";
import { launchPost, launchSections } from "../../../lib/blog";

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
            <BlogContents sections={launchSections} />
          </div>
        </aside>
        <div className="blog-reading-column">
          <details className="blog-mobile-contents">
            <summary>
              In this article <span>{launchSections.length} sections</span>
            </summary>
            <BlogContents sections={launchSections} />
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

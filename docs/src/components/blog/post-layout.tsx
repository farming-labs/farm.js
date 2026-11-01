import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { BlogAuthor } from "./author";
import { BlogContents } from "./contents";
import { BlogExplore } from "./explore";
import type { BlogPost, BlogSections } from "../../lib/blog";

/**
 * The chrome every post shares: the back link, the header with its artwork, the contents list
 * beside the prose, and the explore footer. A post supplies its own heading markup, so a title can
 * break across lines where its author wants it to.
 */
export function BlogPostLayout({
  post,
  sections,
  heading,
  artwork,
  children,
}: {
  post: BlogPost;
  sections: BlogSections;
  /** The post's H1 content; falls back to its plain title. */
  heading?: ReactNode;
  /** Shown full-bleed under the header. */
  artwork?: ReactNode;
  children: ReactNode;
}) {
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
            <span className="blog-category">{post.category}</span>
            <time dateTime={post.dateTime}>{post.date}</time>
          </div>
          <h1>{heading ?? post.title}</h1>
          <p>{post.description}</p>
          <div className="blog-post-byline">
            <BlogAuthor />
          </div>
        </div>
        {artwork}
      </header>
      <div className="blog-reading-grid">
        <aside className="blog-contents">
          <div className="blog-contents-sticky">
            <p className="blog-contents-title">
              <span aria-hidden="true">00</span> In this article
            </p>
            <BlogContents sections={sections} />
          </div>
        </aside>
        <div className="blog-reading-column">
          <details className="blog-mobile-contents">
            <summary>
              In this article <span>{sections.length} sections</span>
            </summary>
            <BlogContents sections={sections} />
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

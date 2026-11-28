import type { LayoutProps, Metadata } from "@farm.js/core";
import { POST_ART } from "../../../components/blog/post-art";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { polyrouteBetaPost, polyrouteBetaSections } from "../../../lib/blog";

// The post's title and description come from page.md; Open Graph needs its own.
export const metadata = {
  openGraph: {
    title: polyrouteBetaPost.title,
    description: polyrouteBetaPost.description,
    type: "article",
    url: polyrouteBetaPost.href,
  },
} satisfies Metadata;

const art = POST_ART[polyrouteBetaPost.href];

export default function PolyrouteBetaLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={polyrouteBetaPost}
      sections={polyrouteBetaSections}
      heading={art.heading}
      artwork={art.header}
    >
      {children}
    </BlogPostLayout>
  );
}

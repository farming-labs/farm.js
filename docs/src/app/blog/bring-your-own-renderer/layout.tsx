import type { LayoutProps, Metadata } from "@farm.js/core";
import { POST_ART } from "../../../components/blog/post-art";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { rendererPost, rendererSections } from "../../../lib/blog";

// The post's title and description come from page.md; Open Graph needs its own.
export const metadata = {
  openGraph: {
    title: rendererPost.title,
    description: rendererPost.description,
    type: "article",
    url: rendererPost.href,
  },
} satisfies Metadata;

const art = POST_ART[rendererPost.href];

export default function RendererPostLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={rendererPost}
      sections={rendererSections}
      heading={art.heading}
      artwork={art.header}
    >
      {children}
    </BlogPostLayout>
  );
}

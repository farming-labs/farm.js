import type { LayoutProps, Metadata } from "@farm.js/core";
import { POST_ART } from "../../../components/blog/post-art";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { releasePreviewPost, releasePreviewSections } from "../../../lib/blog";

export const metadata = {
  openGraph: {
    title: releasePreviewPost.title,
    description: releasePreviewPost.description,
    type: "article",
    url: releasePreviewPost.href,
  },
} satisfies Metadata;

const art = POST_ART[releasePreviewPost.href];

export default function ReleasePreviewLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={releasePreviewPost}
      sections={releasePreviewSections}
      heading={art.heading}
      artwork={art.header}
    >
      {children}
    </BlogPostLayout>
  );
}

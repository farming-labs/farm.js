import type { LayoutProps, Metadata } from "@farm.js/core";
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

export default function ReleasePreviewLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout post={releasePreviewPost} sections={releasePreviewSections}>
      {children}
    </BlogPostLayout>
  );
}

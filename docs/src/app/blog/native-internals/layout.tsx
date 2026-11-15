import type { LayoutProps, Metadata } from "@farm.js/core";
import { POST_ART } from "../../../components/blog/post-art";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { nativeInternalsPost, nativeInternalsSections } from "../../../lib/blog";

// The post's title and description come from page.md; Open Graph needs its own.
export const metadata = {
  openGraph: {
    title: nativeInternalsPost.title,
    description: nativeInternalsPost.description,
    type: "article",
    url: nativeInternalsPost.href,
  },
} satisfies Metadata;

const art = POST_ART[nativeInternalsPost.href];

export default function NativeInternalsPostLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={nativeInternalsPost}
      sections={nativeInternalsSections}
      heading={art.heading}
      artwork={art.header}
    >
      {children}
    </BlogPostLayout>
  );
}

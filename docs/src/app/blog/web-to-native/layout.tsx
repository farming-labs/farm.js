import type { LayoutProps, Metadata } from "@farm.js/core";
import { POST_ART } from "../../../components/blog/post-art";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { nativePost, nativeSections } from "../../../lib/blog";

// The post's title and description come from page.md; Open Graph needs its own.
export const metadata = {
  openGraph: {
    title: nativePost.title,
    description: nativePost.description,
    type: "article",
    url: nativePost.href,
  },
} satisfies Metadata;

const art = POST_ART[nativePost.href];

export default function NativePostLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={nativePost}
      sections={nativeSections}
      heading={art.heading}
      artwork={art.header}
    >
      {children}
    </BlogPostLayout>
  );
}

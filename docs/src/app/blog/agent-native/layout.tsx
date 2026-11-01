import type { LayoutProps, Metadata } from "@farm.js/core";
import { POST_ART } from "../../../components/blog/post-art";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { agentNativePost, agentNativeSections } from "../../../lib/blog";

// The post's title and description come from page.md; Open Graph needs its own.
export const metadata = {
  openGraph: {
    title: agentNativePost.title,
    description: agentNativePost.description,
    type: "article",
    url: agentNativePost.href,
  },
} satisfies Metadata;

const art = POST_ART[agentNativePost.href];

export default function AgentNativePostLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={agentNativePost}
      sections={agentNativeSections}
      heading={art.heading}
      artwork={art.header}
    >
      {children}
    </BlogPostLayout>
  );
}

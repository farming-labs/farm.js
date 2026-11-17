import type { LayoutProps, Metadata } from "@farm.js/core";
import { POST_ART } from "../../../components/blog/post-art";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { agentScanPost, agentScanSections } from "../../../lib/blog";

// The post's title and description come from page.md; Open Graph needs its own.
export const metadata = {
  openGraph: {
    title: agentScanPost.title,
    description: agentScanPost.description,
    type: "article",
    url: agentScanPost.href,
  },
} satisfies Metadata;

const art = POST_ART[agentScanPost.href];

export default function AgentScanPostLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={agentScanPost}
      sections={agentScanSections}
      heading={art.heading}
      artwork={art.header}
    >
      {children}
    </BlogPostLayout>
  );
}

import type { LayoutProps, Metadata } from "@farm.js/core";
import { BlogFigure } from "../../../components/blog/figures";
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

export default function AgentNativePostLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={agentNativePost}
      sections={agentNativeSections}
      heading={
        <>
          Making your site <span>agent-native.</span>
        </>
      }
      artwork={
        <div className="blog-post-artwork">
          <BlogFigure fit kind="agent-layers" />
        </div>
      }
    >
      {children}
    </BlogPostLayout>
  );
}

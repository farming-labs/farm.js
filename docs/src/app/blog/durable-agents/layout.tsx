import type { LayoutProps, Metadata } from "@farm.js/core";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { durableAgentsPost, durableAgentsSections } from "../../../lib/blog";

export const metadata = {
  openGraph: {
    title: durableAgentsPost.title,
    description: durableAgentsPost.description,
    type: "article",
    url: durableAgentsPost.href,
  },
} satisfies Metadata;

export default function DurableAgentsLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout post={durableAgentsPost} sections={durableAgentsSections}>
      {children}
    </BlogPostLayout>
  );
}

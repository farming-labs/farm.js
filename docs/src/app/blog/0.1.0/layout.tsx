import type { LayoutProps, Metadata } from "@farm.js/core";
import { BlogPostLayout } from "../../../components/blog/post-layout";
import { ReleaseArtwork } from "../../../components/blog/release-artwork";
import { launchPost, launchSections } from "../../../lib/blog";

// The post's title and description come from page.md; Open Graph needs its own.
export const metadata = {
  openGraph: {
    title: launchPost.title,
    description: launchPost.description,
    type: "article",
    url: launchPost.href,
  },
} satisfies Metadata;

export default function LaunchPostLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={launchPost}
      sections={launchSections}
      heading={
        <>
          Farm.js v0.1.0: Stable, Integrated, <span>and Agent-Native.</span>
        </>
      }
      artwork={<ReleaseArtwork fullBleed />}
    >
      {children}
    </BlogPostLayout>
  );
}

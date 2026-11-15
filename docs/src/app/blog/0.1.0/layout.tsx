import type { LayoutProps, Metadata } from "@farm.js/core";
import { POST_ART } from "../../../components/blog/post-art";
import { BlogPostLayout } from "../../../components/blog/post-layout";
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

const art = POST_ART[launchPost.href];

export default function LaunchPostLayout({ children }: LayoutProps) {
  return (
    <BlogPostLayout
      post={launchPost}
      sections={launchSections}
      heading={art.heading}
      artwork={art.header}
    >
      {children}
    </BlogPostLayout>
  );
}

import type { ReactNode } from "react";
import { BlogFigure } from "./figures";
import { ReleaseArtwork } from "./release-artwork";
import { agentNativePost, launchPost } from "../../lib/blog";

/**
 * A post's presentation: the heading markup, which breaks where its author wants it to, and the
 * artwork in each of the two places it appears. The post header and the index card both read this,
 * so a title and its art are written once. `blog.test.ts` requires an entry for every post.
 */
export interface PostArt {
  heading: ReactNode;
  /** Full-bleed, beside the post's own header. */
  header: ReactNode;
  /** Inside the index card, next to the summary. */
  card: ReactNode;
}

export const POST_ART: Record<string, PostArt> = {
  [launchPost.href]: {
    heading: (
      <>
        Farm.js v0.1.0: Stable, Integrated, <span>and Agent-Native.</span>
      </>
    ),
    header: <ReleaseArtwork fullBleed />,
    card: <ReleaseArtwork />,
  },
  [agentNativePost.href]: {
    heading: (
      <>
        Making your site <span>agent-native.</span>
      </>
    ),
    header: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="agent-layers" />
      </div>
    ),
    card: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="agent-layers" />
      </div>
    ),
  },
};

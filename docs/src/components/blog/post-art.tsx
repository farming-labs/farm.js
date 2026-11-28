import type { ReactNode } from "react";
import { BlogFigure } from "./figures";
import { RELEASES, ReleaseArtwork } from "./release-artwork";
import {
  durableAgentsPost,
  agentNativePost,
  agentScanPost,
  launchPost,
  nativeInternalsPost,
  nativePost,
  polyrouteBetaPost,
  releasePreviewPost,
  rendererPost,
} from "../../lib/blog";

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
  [polyrouteBetaPost.href]: {
    heading: (
      <>
        Rust and Go API routes <span>are in public beta.</span>
      </>
    ),
    header: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="polyroute-languages" />
      </div>
    ),
    card: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="polyroute-languages" />
      </div>
    ),
  },
  [durableAgentsPost.href]: {
    heading: (
      <>
        Build durable agents <span>with your framework and Farm Infra.</span>
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
  [rendererPost.href]: {
    heading: (
      <>
        Build your own renderer, <span>build your own full-stack framework.</span>
      </>
    ),
    header: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="renderer-seams" />
      </div>
    ),
    card: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="renderer-seams" />
      </div>
    ),
  },
  [agentScanPost.href]: {
    heading: (
      <>
        I asked 105 developer sites for Markdown. <span>A third answered with HTML.</span>
      </>
    ),
    header: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="agent-scan" />
      </div>
    ),
    card: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="agent-scan" />
      </div>
    ),
  },
  [launchPost.href]: {
    heading: (
      <>
        Farm.js v0.1.0: Stable, Integrated, <span>and Agent-Native.</span>
      </>
    ),
    header: <ReleaseArtwork release={RELEASES["0.1.0"]} fullBleed />,
    card: <ReleaseArtwork release={RELEASES["0.1.0"]} />,
  },
  [releasePreviewPost.href]: {
    heading: (
      <>
        Farm.js 0.2 preview. <span>From an API route to a native screen.</span>
      </>
    ),
    header: <ReleaseArtwork release={RELEASES["0.2.0"]} fullBleed />,
    card: <ReleaseArtwork release={RELEASES["0.2.0"]} />,
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
  [nativePost.href]: {
    heading: (
      <>
        Your web app, <span>native.</span>
      </>
    ),
    header: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="ast-native" />
      </div>
    ),
    card: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="ast-native" />
      </div>
    ),
  },
  [nativeInternalsPost.href]: {
    heading: (
      <>
        How Farm draws a page natively, <span>and when it bails out.</span>
      </>
    ),
    header: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="mobile-arch" />
      </div>
    ),
    card: (
      <div className="blog-post-artwork">
        <BlogFigure fit kind="mobile-arch" />
      </div>
    ),
  },
};

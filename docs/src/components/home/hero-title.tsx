"use client";

import { SelectionWire } from "./selection-wire";

type HeroTitleProps = {
  className?: string;
  lead: string;
  /** The word the selection lands on. Headings and assistive technology always read it. */
  word: string;
  /** What the selected word becomes. */
  swap: string;
  /** The rest of the line, after the word. */
  after: string;
  href: string;
  /** The tag the wire connects to, which links to `href`. */
  tag: string;
  /** The link's accessible name, read instead of the tag. */
  linkLabel: string;
};

/**
 * The hero heading. A cursor drags a design-tool selection over one word, the
 * word scrambles into another, and the cursor drags a wire from the selection
 * into a tag that links to that page and clicks it; then it all unwinds.
 * Hovering the word or the tag, or focusing the link, holds it connected.
 */
export function HeroTitle({
  className,
  lead,
  word,
  swap,
  after,
  href,
  tag,
  linkLabel,
}: HeroTitleProps) {
  return (
    <div className="farm-hero-title relative mt-7 w-fit max-w-full px-4 py-4 sm:px-5 sm:py-5">
      {/* The label keeps the heading's name steady while its visible word changes. */}
      <h1 aria-label={`${lead} ${word} ${after}`} className={className}>
        <span className="block">{lead}</span>{" "}
        <span className="block whitespace-nowrap">
          <span className="farm-hero-swap">
            {/* Written by the animation, so React never re-renders it. */}
            <span className="farm-hero-swap-text" dangerouslySetInnerHTML={{ __html: word }} />
          </span>{" "}
          {after}
        </span>
      </h1>
      <a aria-label={linkLabel} className="farm-hero-tag" href={href}>
        {tag}
      </a>
      <SelectionWire
        heading="h1"
        holdOnTarget
        placeTargetUnderHeading
        route="below"
        swap={{ text: ".farm-hero-swap-text", from: word, to: swap }}
        target=".farm-hero-tag"
        word=".farm-hero-swap"
      />
    </div>
  );
}

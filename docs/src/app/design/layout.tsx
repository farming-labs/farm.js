import type { LayoutProps } from "@farm.js/core";
import { HeroTitle } from "../../components/home/hero-title";
import {
  AnnouncementBar,
  IndexedLabel,
  SiteFooter,
  SiteHeader,
} from "../../components/site-chrome";
// The markdown components render code in the blog's code panel (legend and copy button).
import "../blog/blog.css";
import "./design.css";

// The page content is page.md, which Farm also serves as raw markdown at /design.md.
// The heading here replaces the markdown's own title on the rendered page.
export default function DesignLayout({ children }: LayoutProps) {
  return (
    <div className="farm-home farm-design min-h-screen overflow-x-clip bg-black font-sans text-white">
      <a className="design-skip-link" href="#design-content">
        Skip to content
      </a>
      <AnnouncementBar />
      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content min-w-0">
          <SiteHeader />
          <main id="design-content" tabIndex={-1} className="design-main farm-full-rule">
            <header className="design-hero">
              <div className="text-white/42">
                <IndexedLabel index="00" label="Design" />
              </div>
              <HeroTitle
                after=""
                className="max-w-full text-[clamp(1.125rem,7.5vw,2.5rem)] font-medium leading-[1.07] tracking-[-0.055em] text-white min-[601px]:text-[clamp(40px,5vw,64px)]"
                href="/design.md"
                lead="the design behind"
                linkLabel="Read design.md as markdown"
                swap="your app"
                tag="/design.md"
                word="farmjs.dev"
              />
            </header>
            <div className="design-prose">{children}</div>
          </main>
          <SiteFooter />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}

import { ArrowRight, ArrowUpRight, BookOpen, Compass, GitFork } from "lucide-react";
import { IndexedLabel } from "../site-chrome";

export function BlogExplore() {
  return (
    <section className="blog-explore farm-full-rule" aria-labelledby="explore-title">
      <div className="blog-explore-label">
        <h2 id="explore-title">
          <IndexedLabel index="05.2" icon={Compass} label="Keep exploring" />
        </h2>
      </div>
      <div className="blog-explore-grid">
        <a href="/docs/getting-started">
          <IndexedLabel index="01" icon={BookOpen} label="Documentation" />
          <h3 className="font-geist-pixel">Your next commit.</h3>
          <p>From your first route to a production app. Start with the guide.</p>
          <span className="blog-resource-action">
            Read the guide <ArrowRight aria-hidden size={14} strokeWidth={1.5} />
          </span>
        </a>
        <a href="https://github.com/farming-labs/farm.js">
          <IndexedLabel index="02" icon={GitFork} label="Open source" />
          <h3 className="font-geist-pixel">Built in the open.</h3>
          <p>Read the code, follow the changes, or help shape what comes next.</p>
          <span className="blog-resource-action">
            Explore the source <ArrowUpRight aria-hidden size={14} strokeWidth={1.5} />
          </span>
        </a>
      </div>
    </section>
  );
}

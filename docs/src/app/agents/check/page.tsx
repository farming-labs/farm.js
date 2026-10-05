import type { Metadata } from "@farm.js/core";
import { ArrowRight, ScanSearch } from "lucide-react";
import { AgentCheckForm } from "../../../components/agents/check-form";
import { AGENT_CHECK_ICONS } from "../../../components/agents/check-icons";
import { SelectionWire } from "../../../components/home/selection-wire";
import { FlickeringGrid } from "../../../components/ui/flickering-grid";
import {
  AnnouncementBar,
  IndexedLabel,
  SiteFooter,
  SiteHeader,
} from "../../../components/site-chrome";
import "../../../components/agents/waitlist.css";
import "../../../components/agents/check.css";
import "../agents.css";

export const metadata = {
  title: "Agent-ready check — Farm.js",
  description:
    "Score any website on what AI agents can read and call: Markdown, llms.txt, robots.txt, MCP, OpenAPI and structured data, with a fix for each gap.",
} satisfies Metadata;

const checks = [
  [
    "readable",
    "Readable without JavaScript",
    "Content in the HTML, not behind a sign-in or a client render.",
    20,
    "GET /",
  ],
  [
    "markdown",
    "Markdown version",
    "A .md URL and Accept: text/markdown, linked from the page.",
    20,
    "GET /index.md",
  ],
  [
    "llms-txt",
    "llms.txt",
    "A Markdown index of the site for language models.",
    15,
    "GET /llms.txt",
  ],
  [
    "robots",
    "robots.txt",
    "Agents acting for users and AI search aren't blocked.",
    15,
    "GET /robots.txt",
  ],
  ["metadata", "Title, canonical, Open Graph", "How agents name and cite the page.", 10, "<head>"],
  ["mcp", "MCP server", "Tools agents can call over Streamable HTTP.", 10, "POST /api/mcp"],
  [
    "openapi",
    "OpenAPI",
    "A machine-readable description of the site's API.",
    5,
    "GET /openapi.json",
  ],
  ["json-ld", "JSON-LD", "schema.org data about who runs the site.", 5, "ld+json"],
  ["agent-card", "Agent card", "Reported, not scored, while the specs settle.", 0, "/.well-known"],
  [
    "webmcp",
    "WebMCP",
    "Tools the page registers for in-browser agents. Reported.",
    0,
    "modelContext",
  ],
] as const;

// Synchronous like /agents, so the hero's grid and selection wire hydrate with the page.
export default function AgentCheckPage() {
  return (
    <div className="farm-home farm-agents min-h-screen overflow-x-clip bg-black font-sans text-white">
      <a className="agents-skip-link" href="#agent-check-content">
        Skip to content
      </a>
      <AnnouncementBar />
      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content min-w-0">
          <SiteHeader activePage="agents" />
          <main id="agent-check-content" tabIndex={-1}>
            <section className="agents-hero farm-full-rule" aria-labelledby="agent-check-title">
              <div className="agents-hero-copy">
                <div className="agents-eyebrow">
                  <IndexedLabel index="06.4" icon={ScanSearch} label="Agent-ready check" />
                </div>
                <h1 id="agent-check-title">
                  Is your site ready for{" "}
                  <span className="agents-hero-word">
                    agents<span className="agents-hero-mark">?</span>
                  </span>
                  <br />
                  <span className="agents-hero-line">Find out in seconds.</span>
                </h1>
                <p className="agents-intro">
                  One address in, a score out, and a concrete fix for every gap. Works for any site,
                  whatever it's built with.
                </p>
                <div className="agents-signup">
                  <AgentCheckForm />
                </div>
                <SelectionWire
                  clear=".agents-intro"
                  fitInk
                  glitch=".agents-hero-mark"
                  heading="#agent-check-title"
                  over=".agents-hero-line"
                  padX={0.03}
                  pauseWithin=".agent-check-form"
                  route="hug"
                  target=".agent-check-form button[type=submit]"
                  targetLabel={{ text: "[data-agent-check-label]", to: "Check it" }}
                  word=".agents-hero-word"
                />
              </div>
              <div aria-hidden className="agents-hero-flicker">
                <div className="agents-hero-flicker-field">
                  <FlickeringGrid
                    className="absolute inset-0"
                    color="rgb(255, 255, 255)"
                    flickerChance={0.9}
                    gridGap={7}
                    maxOpacity={0.36}
                    squareSize={2}
                  />
                </div>
              </div>
            </section>

            <section aria-labelledby="agent-check-list-title">
              <div className="agents-section-heading farm-full-rule">
                <div>
                  <IndexedLabel index="06.4.1" label="What it checks" />
                  <h2 id="agent-check-list-title" className="font-geist-pixel">
                    Ten checks.
                    <br />
                    One score.
                  </h2>
                </div>
                <p>
                  Every check looks at what an agent sees without a browser: the HTML, the Markdown,
                  the discovery files, and the tools a site offers. Scores add up to 100; drafts are
                  reported but not scored.
                </p>
              </div>
              <ol className="agent-check-list farm-full-rule">
                {checks.map(([id, title, description, points, probe], index) => (
                  <li key={id}>
                    <IndexedLabel
                      index={String(index + 1).padStart(2, "0")}
                      icon={AGENT_CHECK_ICONS[id]}
                      label={title}
                    />
                    <p>{description}</p>
                    <div className="agent-check-list-meta">
                      <code>{probe}</code>
                      <span>{points ? `${points} pts` : "Not scored"}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section
              className="agents-open-web farm-full-rule"
              aria-labelledby="agent-check-next-title"
            >
              <div>
                <IndexedLabel index="06.4.2" label="Then what" />
                <h2 id="agent-check-next-title">Readable is step one.</h2>
              </div>
              <div className="agents-open-copy">
                <p>
                  Farm.js apps answer most of these checks by default. The agent infrastructure
                  we're building goes further: one gateway for your tools, and a trace of every
                  agent run.
                </p>
                <div className="agents-links">
                  <a href="/agents">
                    Agent infrastructure <ArrowRight size={14} aria-hidden />
                  </a>
                  <a href="/agents#waitlist">
                    Join the waitlist <ArrowRight size={14} aria-hidden />
                  </a>
                </div>
              </div>
            </section>
          </main>
          <SiteFooter />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}

import type { Metadata } from "@farm.js/core";
import { ArrowRight, ScanSearch } from "lucide-react";
import { AgentCheckForm } from "../../../components/agents/check-form";
import { AGENT_CHECK_GROUPS } from "../../../components/agents/check-groups";
import { AgentCheckIntro } from "../../../components/agents/check-intro";
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
  openGraph: { title: "Agent-ready check — Farm.js", url: "/agents/check" },
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

const checkById = new Map(checks.map((check) => [check[0], check]));
const checkNumber = new Map(
  AGENT_CHECK_GROUPS.flatMap((group) => group.checks).map((id, index) => [id, index + 1]),
);

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
            <AgentCheckIntro>
              <section className="agents-hero farm-full-rule" aria-labelledby="agent-check-title">
                <div className="agents-hero-copy">
                  <div className="agents-eyebrow">
                    <IndexedLabel index="06.4" icon={ScanSearch} label="Agent-ready check" />
                  </div>
                  <h1 id="agent-check-title">
                    Is your site ready for <span className="agents-hero-word">agents?</span>
                    <br />
                    <span className="agents-hero-line">Find out in seconds.</span>
                  </h1>
                  <p className="agents-intro">
                    One address in, a score out, and a concrete fix for every gap. Works for any
                    site, whatever it's built with.
                  </p>
                  <div className="agents-signup">
                    <AgentCheckForm />
                  </div>
                  <SelectionWire
                    clear=".agents-intro"
                    fitInk
                    heading="#agent-check-title"
                    over=".agents-hero-line"
                    padRight={0.14}
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
                    Every check looks at what an agent sees without a browser: the HTML, the
                    Markdown, the discovery files, and the tools a site offers. Scores add up to
                    100; drafts are reported but not scored.
                  </p>
                </div>
                {AGENT_CHECK_GROUPS.map((group, groupIndex) => {
                  const members = group.checks.flatMap((id) => {
                    const check = checkById.get(id);
                    return check ? [check] : [];
                  });
                  const available = members.reduce((sum, [, , , points]) => sum + points, 0);
                  return (
                    <div key={group.id} className="agent-check-list-group farm-full-rule">
                      <div className="agent-check-list-group-head">
                        <IndexedLabel
                          index={String(groupIndex + 1).padStart(2, "0")}
                          icon={group.icon}
                          label={group.label}
                        />
                        <h3>{group.question}</h3>
                        <span>{available} pts</span>
                      </div>
                      <ol className="agent-check-list">
                        {members.map(([id, title, description, points, probe]) => {
                          const Icon = AGENT_CHECK_ICONS[id];
                          return (
                            <li key={id}>
                              <div className="agent-check-card-top">
                                <span className="agent-check-card-icon" aria-hidden>
                                  {Icon ? <Icon size={16} strokeWidth={1.5} /> : null}
                                </span>
                                <span
                                  className="agent-check-chip"
                                  data-tone={points ? undefined : "muted"}
                                >
                                  {points ? `${points} pts` : "Reported"}
                                </span>
                              </div>
                              <h4>
                                <span aria-hidden>
                                  {String(checkNumber.get(id) ?? 0).padStart(2, "0")}
                                </span>
                                {title}
                              </h4>
                              <p>{description}</p>
                              <code>{probe}</code>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  );
                })}
              </section>
            </AgentCheckIntro>

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
                  Farm.js apps pass the readable and Markdown checks by default, and one agent block
                  in farm.config.ts adds llms.txt and JSON-LD. The agent infrastructure we're
                  building goes further: one gateway for your tools, and a trace of every agent run.
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

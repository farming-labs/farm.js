import type { Metadata } from "@farm.js/core";
import {
  Activity,
  ArrowRight,
  Bot,
  Cable,
  FileText,
  Globe2,
  MousePointerClick,
  Network,
  Server,
  Wrench,
} from "lucide-react";
import { AgentArtwork } from "../../components/agents/artwork";
import { AgentWaitlist } from "../../components/agents/waitlist";
import { BlogFigure } from "../../components/blog/figures";
import { FlickeringGrid } from "../../components/ui/flickering-grid";
import {
  AnnouncementBar,
  IndexedLabel,
  SiteFooter,
  SiteHeader,
} from "../../components/site-chrome";
import "../../components/agents/waitlist.css";
import "../../components/blog/figures.css";
import "./agents.css";

export const metadata = {
  title: "Agent infrastructure — Farm.js",
  description:
    "Farm.js apps are agent-native by default: agent runtimes, Markdown mirrors, MCP tools, and WebMCP. Plus upcoming infrastructure for deploying agents and MCP servers.",
} satisfies Metadata;

// What ships in v0.1.0, as opposed to the upcoming infrastructure further down the page.
const availableNow = [
  {
    index: "01",
    icon: Bot,
    label: "Agent runtimes",
    status: "v0.1.0",
    title: "Run agents beside your app.",
    code: "integrations: { agent: eve() }",
    description:
      "Register Eve or Cloudflare Agents in farm.config.ts. farm dev starts the runtime and serves its routes on your app's origin; production composes both into one deployment.",
    href: "/docs/integrations/eve",
    link: "Agent integrations",
  },
  {
    index: "02",
    icon: FileText,
    label: "Readable by default",
    status: "Default",
    title: "Every page in Markdown.",
    code: 'curl -H "Accept: text/markdown" /pricing',
    description:
      "Pages answer agents with a Markdown mirror, by .md suffix or Accept header. Turn on OpenAPI and llms.txt with ordinary config.",
    href: "/docs/markdown",
    link: "Markdown mirrors",
  },
  {
    index: "03",
    icon: Wrench,
    label: "MCP tools",
    status: "Experimental",
    title: "API routes as MCP tools.",
    code: "mcp: { tools: [listProjects] }",
    description:
      "Expose selected endpoints and standalone tools through one Streamable HTTP server. Each route keeps its validation and middleware, under one shared authorization policy.",
    href: "https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp",
    link: "MCP example",
  },
  {
    index: "04",
    icon: MousePointerClick,
    label: "WebMCP",
    status: "Experimental",
    title: "Tools inside the open page.",
    code: "registerWebMCPTool(listProjects)",
    description:
      "Components register named tools while the page is open. They call your same-origin APIs with the user's own session, in browsers that support WebMCP.",
    href: "/docs/plugins/webmcp",
    link: "WebMCP plugin",
  },
] as const;

const capabilities = [
  {
    index: "01",
    icon: Server,
    label: "Deployment",
    visual: "agents-deploy",
    title: "Your agents. Your codebase.",
    description:
      "Deploy and manage agents alongside your Farm.js app, from the same codebase, with one shared place to follow each agent's lifecycle and status.",
  },
  {
    index: "02",
    icon: Cable,
    label: "MCP & connections",
    visual: "agents-connect",
    title: "One gateway for every MCP server.",
    description:
      "Deploy MCP servers and connect compatible clients to them. Farm.js gathers your servers behind a single tool that orchestrates them on each client's behalf.",
  },
  {
    index: "03",
    icon: Globe2,
    label: "Agent-ready websites",
    visual: "agents-site",
    title: "A website agents can use.",
    description:
      "Publish readable content and discoverable tool descriptions. Let compatible agents talk to your app, use approved actions, and receive results—not just read pages.",
  },
  {
    index: "04",
    icon: Activity,
    label: "Observability",
    visual: "agents-observe",
    title: "See the whole run.",
    description:
      "Follow runs, tool calls, logs, and failures together in one timeline, from the first request to the final response, with the timing of each step.",
  },
] as const;

export default function AgentsPage() {
  return (
    <div className="farm-home farm-agents min-h-screen overflow-x-clip bg-black font-sans text-white">
      <a className="agents-skip-link" href="#agents-content">
        Skip to content
      </a>
      <AnnouncementBar />
      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content min-w-0">
          <SiteHeader activePage="agents" />
          <main id="agents-content" tabIndex={-1}>
            <section className="agents-hero farm-full-rule" aria-labelledby="agents-title">
              <div className="agents-hero-copy">
                <div className="agents-eyebrow">
                  <IndexedLabel index="06" icon={Network} label="Agent infrastructure" />
                </div>
                <h1 id="agents-title">
                  Deploy agents.
                  <br />
                  <span>Connect your tools.</span>
                </h1>
                <p className="agents-intro">
                  Your agents, MCP servers, and website. Connected, managed, and observable from the
                  same Farm.js codebase.
                </p>
                <div id="waitlist" className="agents-signup">
                  <AgentWaitlist source="agents" note={false} />
                </div>
              </div>
              {/* The landing hero's flickering grid, behind the bottom of the hero copy (adds no height). */}
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
              <AgentArtwork />
            </section>

            <section aria-labelledby="agents-now-title">
              <div className="agents-section-heading farm-full-rule">
                <div>
                  <IndexedLabel index="06.1" label="Available today" />
                  <h2 id="agents-now-title" className="font-geist-pixel">
                    Agent-native
                    <br />
                    by default.
                  </h2>
                </div>
                <p>
                  Every Farm.js v0.1.0 app can run an agent, answer agents in Markdown, and expose
                  the tools you choose. Discovery never grants permission; your app still authorizes
                  every action.
                </p>
              </div>
              <div className="agents-now farm-full-rule">
                {availableNow.map(
                  ({ index, icon, label, status, title, code, description, href, link }) => (
                    <article key={index}>
                      <div className="agents-now-top">
                        <IndexedLabel index={index} icon={icon} label={label} />
                        <span className="agents-now-status">[ {status} ]</span>
                      </div>
                      <h3 className="font-geist-pixel">{title}</h3>
                      <code className="agents-now-code">{code}</code>
                      <p>{description}</p>
                      <a className="agents-now-link" href={href}>
                        {link} <ArrowRight size={14} aria-hidden />
                      </a>
                    </article>
                  ),
                )}
              </div>
            </section>

            <section aria-labelledby="agents-capabilities-title">
              <div className="agents-section-heading farm-full-rule">
                <div>
                  <IndexedLabel index="06.2" label="What we're building next" />
                  <h2 id="agents-capabilities-title" className="font-geist-pixel">
                    From your codebase.
                    <br />
                    To the agent web.
                  </h2>
                </div>
                <p>
                  We're building a home for your agents, their tools, and the websites they work
                  with. Connected through the framework you already use.
                </p>
              </div>
              <div className="agents-capabilities farm-full-rule">
                {capabilities.map(({ index, icon, label, title, description, visual }) => (
                  <article key={index}>
                    <IndexedLabel index={index} icon={icon} label={label} />
                    <h3 className="font-geist-pixel">{title}</h3>
                    <p>{description}</p>
                    <div className="agents-card-visual farm-feature-spotlight">
                      <div className="agents-card-figure">
                        <BlogFigure fit kind={visual} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="agents-open-web farm-full-rule" aria-labelledby="agents-open-title">
              <div>
                <IndexedLabel index="06.3" label="Built for the open web" />
                <h2 id="agents-open-title">Your stack. Your permissions.</h2>
              </div>
              <div className="agents-open-copy">
                <p>
                  Bring the tools and agent frameworks you already use. The goal is to connect
                  through standard APIs and MCP, with access you explicitly allow. Discovery helps
                  agents understand your website; it never grants them permission to act.
                </p>
                <p className="agents-availability">
                  This infrastructure is upcoming, not part of Farm.js v0.1.0. The waitlist is for
                  updates and early access—not a deployment console.
                </p>
                <div className="agents-links">
                  <a href="#waitlist">
                    Join the waitlist <ArrowRight size={14} aria-hidden />
                  </a>
                  <a href="/blog/0.1.0#agent-infrastructure">
                    Read the announcement <ArrowRight size={14} aria-hidden />
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

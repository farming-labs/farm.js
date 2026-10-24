import { type Metadata, type MetadataProps, notFound, type PageProps } from "@farm.js/core";
import { ArrowRight } from "lucide-react";
import { AgentCheckCopyLink } from "../../../../components/agents/check-copy-link";
import { AgentCheckNextSteps } from "../../../../components/agents/check-next-steps";
import {
  AgentCheckReportSections,
  hostOf,
  verdict,
} from "../../../../components/agents/check-report";
import {
  AnnouncementBar,
  IndexedLabel,
  SiteFooter,
  SiteHeader,
} from "../../../../components/site-chrome";
import { fetchAgentCheck } from "../../../../lib/agents-check";
import "../../../../components/agents/waitlist.css";
import "../../../../components/agents/check.css";
import "../../agents.css";

export async function generateMetadata({
  params,
}: MetadataProps<"/agents/check/[id]">): Promise<Metadata> {
  const scan = await fetchAgentCheck(params.id).catch(() => null);
  if (!scan) return { title: "Agent-ready check — Farm.js" };
  const host = hostOf(scan.report);
  return {
    title: `${host} scores ${scan.report.score}/100 — Agent-ready check`,
    description: `${verdict(scan.report.score)} See what ${host} serves to AI agents and how to fix each gap.`,
    robots: { index: false },
  };
}

export default async function AgentCheckReportPage({ params }: PageProps<"/agents/check/[id]">) {
  const scan = await fetchAgentCheck(params.id);
  if (!scan) notFound();
  return (
    <div className="farm-home farm-agents agent-check-report min-h-screen overflow-x-clip bg-black font-sans text-white">
      <a className="agents-skip-link" href="#agent-check-content">
        Skip to content
      </a>
      <AnnouncementBar />
      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content min-w-0">
          <SiteHeader activePage="agents" />
          <main id="agent-check-content" tabIndex={-1}>
            <AgentCheckReportSections
              scan={scan}
              actions={
                <>
                  <AgentCheckNextSteps scan={scan} />
                  <AgentCheckCopyLink />
                  <a href={`/agents/check?url=${encodeURIComponent(scan.report.url)}`}>
                    Scan again
                  </a>
                  <a href="/agents/check">Check another site</a>
                </>
              }
            />

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
                  The agent infrastructure we're building goes further: one gateway for your tools,
                  and a trace of every agent run, managed from your Farm.js codebase.
                </p>
                <div className="agents-links">
                  <a href="/agents#waitlist">
                    Join the waitlist <ArrowRight size={14} aria-hidden />
                  </a>
                  <a href="/agents/check">
                    Check another site <ArrowRight size={14} aria-hidden />
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

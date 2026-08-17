import { createHmac, timingSafeEqual } from "node:crypto";
import type { Metadata } from "@farm.js/core";
import { cookies } from "@farm.js/core/headers";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Database,
  Fingerprint,
  PackageCheck,
  Terminal,
} from "lucide-react";
import { getPrisma } from "../../lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Farm.js telemetry",
  description: "Internal anonymous product-health metrics for Farm.js.",
} satisfies Metadata;

type TelemetryPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type GroupCount = {
  key: string;
  count: number;
  lastSeenAt: Date | null;
};

type RecentEvent = {
  id: string;
  eventType: string;
  source: string;
  packageVersion: string;
  command: string | null;
  packageManager: string | null;
  renderer: string | null;
  template: string | null;
  nodeMajor: number;
  platform: string;
  architecture: string;
  createdAt: Date;
};

type TelemetryData =
  | {
      status: "ready";
      totalEvents: number;
      eventsLast24h: number;
      uniqueInstallations: number;
      projectsCreated: number;
      recentEvents: RecentEvent[];
      eventTypes: GroupCount[];
      commands: GroupCount[];
      versions: GroupCount[];
      templates: GroupCount[];
      renderers: GroupCount[];
      packageManagers: GroupCount[];
      platforms: GroupCount[];
    }
  | {
      status: "not-configured" | "schema-missing" | "unavailable";
      message: string;
    };

type GroupRow = {
  key: string | null;
  _count: { _all: number };
  _max: { createdAt: Date | null };
};

function first(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || undefined;
}

function safeTokenEqual(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
}

function dashboardSessionValue(token: string): string {
  return createHmac("sha256", token).update("farm.telemetry.dashboard.v1").digest("hex");
}

function hasDashboardAccess(): boolean {
  const expected = process.env.FARM_TELEMETRY_DASHBOARD_TOKEN?.trim();
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  return safeTokenEqual(
    cookies().get("farm_telemetry_dashboard")?.value,
    dashboardSessionValue(expected),
  );
}

function readLimit(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(first(value) || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 250) : 100;
}

function groups(rows: GroupRow[]): GroupCount[] {
  return rows
    .map((row) => ({
      key: row.key || "unknown",
      count: row._count._all,
      lastSeenAt: row._max.createdAt,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

async function loadTelemetryData(limit: number): Promise<TelemetryData> {
  if (!process.env.DATABASE_URL) {
    return {
      status: "not-configured",
      message: "DATABASE_URL is not configured for this deployment.",
    };
  }

  try {
    const prisma = await getPrisma();
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const [
      totalEvents,
      eventsLast24h,
      uniqueInstallations,
      projectsCreated,
      recentEvents,
      eventTypeRows,
      commandRows,
      versionRows,
      templateRows,
      rendererRows,
      packageManagerRows,
      platformRows,
    ] = await Promise.all([
      prisma.farmTelemetryEvent.count(),
      prisma.farmTelemetryEvent.count({ where: { createdAt: { gte: last24h } } }),
      prisma.farmTelemetryEvent.findMany({
        distinct: ["identityHash"],
        select: { identityHash: true },
      }),
      prisma.farmTelemetryEvent.count({ where: { eventType: "project_created" } }),
      prisma.farmTelemetryEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          eventType: true,
          source: true,
          packageVersion: true,
          command: true,
          packageManager: true,
          renderer: true,
          template: true,
          nodeMajor: true,
          platform: true,
          architecture: true,
          createdAt: true,
        },
      }),
      prisma.farmTelemetryEvent.groupBy({
        by: ["eventType"],
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.farmTelemetryEvent.groupBy({
        by: ["command"],
        where: { command: { not: null } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.farmTelemetryEvent.groupBy({
        by: ["packageVersion"],
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.farmTelemetryEvent.groupBy({
        by: ["template"],
        where: { template: { not: null } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.farmTelemetryEvent.groupBy({
        by: ["renderer"],
        where: { renderer: { not: null } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.farmTelemetryEvent.groupBy({
        by: ["packageManager"],
        where: { packageManager: { not: null } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.farmTelemetryEvent.groupBy({
        by: ["platform"],
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);

    return {
      status: "ready",
      totalEvents,
      eventsLast24h,
      uniqueInstallations: uniqueInstallations.length,
      projectsCreated,
      recentEvents,
      eventTypes: groups(
        eventTypeRows.map((row) => ({ ...row, key: row.eventType })) as GroupRow[],
      ),
      commands: groups(commandRows.map((row) => ({ ...row, key: row.command })) as GroupRow[]),
      versions: groups(
        versionRows.map((row) => ({ ...row, key: row.packageVersion })) as GroupRow[],
      ),
      templates: groups(templateRows.map((row) => ({ ...row, key: row.template })) as GroupRow[]),
      renderers: groups(rendererRows.map((row) => ({ ...row, key: row.renderer })) as GroupRow[]),
      packageManagers: groups(
        packageManagerRows.map((row) => ({ ...row, key: row.packageManager })) as GroupRow[],
      ),
      platforms: groups(platformRows.map((row) => ({ ...row, key: row.platform })) as GroupRow[]),
    };
  } catch (error) {
    const code = errorCode(error);
    const name = errorName(error);
    if (code === "P2021" || code === "P2022" || name === "PrismaClientValidationError") {
      return {
        status: "schema-missing",
        message:
          "The telemetry table is not available yet. Apply the Prisma schema to the database.",
      };
    }
    console.error("[farmjs.telemetry.dashboard]", error);
    return {
      status: "unavailable",
      message: "The telemetry database is currently unreachable.",
    };
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(value);
}

function PageRails() {
  return (
    <div className="pointer-events-none fixed inset-0 hidden lg:block" aria-hidden="true">
      <div className="absolute inset-y-0 left-0 w-3 border-r border-white/10 bg-[repeating-linear-gradient(-45deg,rgba(255,255,255,0.6),rgba(255,255,255,0.6)_1px,transparent_1px,transparent_5px)] opacity-10" />
      <div className="absolute inset-y-0 right-0 w-3 border-l border-white/10 bg-[repeating-linear-gradient(-45deg,rgba(255,255,255,0.6),rgba(255,255,255,0.6)_1px,transparent_1px,transparent_5px)] opacity-10" />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
}) {
  return (
    <article className="border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">{label}</p>
        <Icon className="size-4 text-white/45" strokeWidth={1.7} aria-hidden="true" />
      </div>
      <p className="mt-4 text-3xl font-medium tracking-[-0.04em] text-white">{value}</p>
    </article>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupCount[] }) {
  return (
    <section className="border border-white/10 bg-black">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-medium text-white">{title}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
          {rows.length} values
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] table-fixed text-left">
          <thead className="bg-white/[0.025] font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
            <tr>
              <th className="px-4 py-2 font-normal">Value</th>
              <th className="w-24 px-4 py-2 text-right font-normal">Events</th>
              <th className="w-44 px-4 py-2 text-right font-normal">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.key}>
                  <td className="truncate px-4 py-2.5 font-mono text-xs text-white/75">
                    {row.key}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">
                    {formatNumber(row.count)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[11px] text-white/40">
                    {formatDate(row.lastSeenAt)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-sm text-white/40">
                  No events in this group yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPanel({ data }: { data: Exclude<TelemetryData, { status: "ready" }> }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-black px-5 py-16 text-white">
      <PageRails />
      <section className="relative w-full max-w-2xl border border-white/10 bg-white/[0.025] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-white/50" strokeWidth={1.7} aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            {data.status.replace("-", " ")}
          </p>
        </div>
        <h1 className="mt-5 text-2xl font-medium tracking-[-0.035em]">Farm.js telemetry</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/55">{data.message}</p>
      </section>
    </main>
  );
}

function AccessPanel({ error }: { error?: string }) {
  const message =
    error === "rate-limited"
      ? "Too many attempts. Wait a minute and try again."
      : error === "invalid"
        ? "That dashboard token is not valid."
        : undefined;
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-black px-5 py-16 text-white">
      <PageRails />
      <section className="relative w-full max-w-md border border-white/10 bg-white/[0.025] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <Fingerprint className="size-5 text-white/50" strokeWidth={1.7} aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            Restricted dashboard
          </p>
        </div>
        <h1 className="mt-5 text-2xl font-medium tracking-[-0.035em]">Farm.js telemetry</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Enter the server-side dashboard token to open anonymous product-health metrics.
        </p>
        <form action="/api/telemetry/dashboard/session" method="post" className="mt-6">
          <label
            htmlFor="telemetry-dashboard-token"
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45"
          >
            Dashboard token
          </label>
          <input
            id="telemetry-dashboard-token"
            name="token"
            type="password"
            required
            autoComplete="current-password"
            className="mt-2 h-11 w-full border border-white/15 bg-black px-3 font-mono text-sm text-white outline-none transition-colors focus:border-white/45"
          />
          {message ? (
            <p role="alert" className="mt-3 text-xs leading-5 text-red-300/80">
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            className="mt-4 h-10 w-full border border-white bg-white px-4 font-mono text-xs font-medium uppercase tracking-[0.14em] text-black transition-colors hover:bg-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Open dashboard
          </button>
        </form>
        <p className="mt-4 text-xs leading-5 text-white/35">
          The token is exchanged server-side for a 12-hour HttpOnly cookie and is never stored in
          the page URL.
        </p>
      </section>
    </main>
  );
}

export default async function TelemetryPage({ searchParams }: TelemetryPageProps) {
  const params = (await searchParams) ?? {};
  if (!hasDashboardAccess()) return <AccessPanel error={first(params.error)} />;
  const data = await loadTelemetryData(readLimit(params.limit));

  if (data.status !== "ready") return <StatusPanel data={data} />;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-black px-3 py-4 text-white sm:px-5 lg:px-8 lg:py-6">
      <PageRails />
      <div className="relative mx-auto max-w-[1800px]">
        <header className="border border-white/10 bg-black p-5 sm:p-7">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                <Activity className="size-3.5" strokeWidth={1.7} aria-hidden="true" />
                Product health / anonymous
              </div>
              <h1 className="mt-4 text-3xl font-medium tracking-[-0.045em] sm:text-4xl">
                Farm.js telemetry
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
                Coarse, anonymous CLI and project-creation signals. No paths, repositories, source,
                credentials, user identities, IP addresses, or user-agent strings are stored.
              </p>
            </div>
            <p className="font-mono text-[11px] text-white/40">
              Refreshed {formatDate(new Date())}
            </p>
            {process.env.FARM_TELEMETRY_DASHBOARD_TOKEN ? (
              <form action="/api/telemetry/dashboard/session" method="post">
                <input type="hidden" name="action" value="logout" />
                <button
                  type="submit"
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40 underline decoration-white/20 underline-offset-4 hover:text-white"
                >
                  End dashboard session
                </button>
              </form>
            ) : null}
          </div>
        </header>

        <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total events" value={formatNumber(data.totalEvents)} icon={Database} />
          <StatCard
            label="Last 24 hours"
            value={formatNumber(data.eventsLast24h)}
            icon={Activity}
          />
          <StatCard
            label="Anonymous installations"
            value={formatNumber(data.uniqueInstallations)}
            icon={Fingerprint}
          />
          <StatCard
            label="Projects created"
            value={formatNumber(data.projectsCreated)}
            icon={PackageCheck}
          />
        </section>

        <section className="mt-3 grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          <GroupTable title="Event types" rows={data.eventTypes} />
          <GroupTable title="CLI commands" rows={data.commands} />
          <GroupTable title="Farm versions" rows={data.versions} />
          <GroupTable title="Starter templates" rows={data.templates} />
          <GroupTable title="Renderers" rows={data.renderers} />
          <GroupTable title="Package managers" rows={data.packageManagers} />
          <GroupTable title="Platforms" rows={data.platforms} />
        </section>

        <section className="mt-3 border border-white/10 bg-black">
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-white/45" strokeWidth={1.7} aria-hidden="true" />
              <h2 className="text-sm font-medium">Recent events</h2>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
              newest first
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <thead className="bg-white/[0.025] font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                <tr>
                  <th className="px-4 py-2 font-normal">Received</th>
                  <th className="px-4 py-2 font-normal">Event</th>
                  <th className="px-4 py-2 font-normal">Detail</th>
                  <th className="px-4 py-2 font-normal">Version</th>
                  <th className="px-4 py-2 font-normal">Source</th>
                  <th className="px-4 py-2 font-normal">Runtime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {data.recentEvents.length ? (
                  data.recentEvents.map((event) => {
                    const detail = event.command || event.template || event.renderer || "-";
                    return (
                      <tr key={event.id}>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-white/40">
                          {formatDate(event.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-white">
                          {event.eventType}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-white/70">{detail}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-white/70">
                          {event.packageVersion}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-white/55">
                          {event.source}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-white/45">
                          node {event.nodeMajor} / {event.platform} / {event.architecture}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-white/40">
                      <Boxes className="mx-auto mb-3 size-5" strokeWidth={1.6} aria-hidden="true" />
                      No telemetry events have been received yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  BookOpenText,
  ExternalLink,
  FileText,
  GitFork,
  Layers3,
  Menu,
  Newspaper,
  Network,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import githubIconUrl from "simple-icons/icons/github.svg?url";
import farmingLabsLogoUrl from "../assets/farming-labs-logo-dark.svg?url";
import { launchPost } from "../lib/blog";

const navItems = [
  {
    index: "01",
    label: "Guide",
    href: "/docs/getting-started",
    icon: BookOpen,
  },
  { index: "02", label: "Migrations", href: "/docs/migrations", icon: GitFork },
  {
    index: "03",
    label: "Integrations",
    href: "/docs/integrations",
    icon: Blocks,
  },
  { index: "04", label: "Resources", href: "/docs", icon: FileText },
  { index: "05", label: "Blog", href: "/blog", icon: Newspaper },
  { index: "06", label: "Agents", href: "/agents", icon: Network },
] as const;

const footerGroups = [
  {
    title: "Framework",
    icon: BookOpen,
    brand: null,
    action: ["Read guide", "/docs/getting-started"],
    links: [
      ["Getting started", "/docs/getting-started"],
      ["Routing", "/docs/routing"],
      ["Blog", "/blog"],
      ["Middleware", "/docs/middleware"],
    ],
  },
  {
    title: "Product",
    icon: Layers3,
    brand: null,
    action: ["Integrations", "/docs/integrations"],
    links: [
      ["Integrations", "/docs/integrations"],
      ["API client", "/docs/api-client"],
      ["Deployment", "/docs/deployment"],
      ["Agent infrastructure", "/agents"],
    ],
  },
  {
    title: "Open source",
    icon: GitFork,
    brand: githubIconUrl,
    action: ["View source", "https://github.com/farming-labs/farm.js"],
    links: [["GitHub", "https://github.com/farming-labs/farm.js"]],
  },
] as const;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function BrandIcon({ src, className }: { src: string; className?: string }) {
  return <img alt="" aria-hidden className={cx("brightness-0 invert", className)} src={src} />;
}

function GithubIcon({ className }: { className?: string }) {
  return <BrandIcon className={className} src={githubIconUrl} />;
}

export function IndexedLabel({
  index,
  icon: Icon,
  label,
}: {
  index: string;
  icon?: LucideIcon;
  label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-normal uppercase tracking-normal text-current">
      <span aria-hidden className="text-white/26">
        {index}
      </span>
      <span aria-hidden className="text-white/18">
        /
      </span>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <a
      aria-label="Farm.js home"
      className={cx(
        "shrink-0 font-mono font-normal uppercase tracking-normal text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
        className,
      )}
      href="/"
    >
      FARM<span className="text-white/52">.JS</span>
    </a>
  );
}

function FarmingLabsBrand() {
  return (
    <a
      aria-label="Farming Labs brand assets"
      className="flex shrink-0 items-center text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      href="https://www.farming-labs.dev/brand"
      title="Farming Labs brand"
    >
      <img alt="" aria-hidden className="h-[19px] w-auto" src={farmingLabsLogoUrl} />
    </a>
  );
}

function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <FarmingLabsBrand />
      <Wordmark className="text-[11px]" />
    </div>
  );
}

export function AnnouncementBar() {
  return (
    <div className="farm-announcement flex min-h-7 flex-wrap items-center justify-center gap-x-2 border-b border-white/12 px-4 font-mono text-[10px] font-normal uppercase tracking-normal">
      <span className="text-white/76">Farm.js v0.1.0 is released</span>
      <a
        className="inline-flex min-h-7 shrink-0 items-center text-white/80 underline decoration-white/40 underline-offset-2 hover:text-white hover:decoration-white active:text-white/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        href={launchPost.href}
      >
        Read the announcement
      </a>
    </div>
  );
}

export function SiteHeader({ activePage }: { activePage?: "blog" | "agents" }) {
  return (
    <header className="farm-full-rule sticky top-0 z-50 bg-black/94 backdrop-blur-xl">
      <div className="flex h-11 w-full items-stretch">
        <div className="flex shrink-0 items-center px-4 sm:px-7">
          <BrandLockup />
        </div>

        <nav
          aria-label="Primary navigation"
          className="hidden min-w-0 flex-1 items-stretch border-l border-white/12 xl:flex"
        >
          {navItems.map((item) => (
            <a
              key={item.label}
              aria-current={activePage && item.href === `/${activePage}` ? "page" : undefined}
              className="aria-[current=page]:bg-white/[0.04] aria-[current=page]:text-white flex h-full min-w-0 flex-auto items-center border-r border-white/12 px-3 font-mono uppercase tracking-normal text-white/48 transition-colors duration-150 hover:bg-white/[0.035] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white xl:px-4"
              href={item.href}
            >
              <IndexedLabel index={item.index} icon={item.icon} label={item.label} />
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden shrink-0 items-stretch xl:flex">
          <a
            aria-label="Open Farm.js on GitHub"
            className="grid size-11 place-items-center border-l border-white/12 text-white/52 transition-colors duration-150 hover:bg-white/[0.035] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
            href="https://github.com/farming-labs/farm.js"
            title="GitHub"
          >
            <GithubIcon className="size-4" />
          </a>
          <a
            className="inline-flex h-11 items-center gap-1.5 border-l border-white/12 bg-white px-5 font-mono text-[10px] font-normal uppercase tracking-normal text-black transition-colors duration-150 hover:bg-white/88 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
            href="/docs"
          >
            <BookOpenText aria-hidden className="size-3.5" strokeWidth={1.6} />
            Docs
          </a>
        </div>

        <details className="group relative ml-auto border-l border-white/12 xl:hidden">
          <summary className="grid size-11 cursor-pointer list-none place-items-center text-white transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
            <span className="sr-only">Open navigation</span>
            <Menu aria-hidden className="size-4 group-open:hidden" strokeWidth={1.5} />
            <X aria-hidden className="hidden size-4 group-open:block" strokeWidth={1.5} />
          </summary>
          <nav
            aria-label="Mobile navigation"
            className="absolute -right-px top-11 w-screen overflow-hidden border border-white/14 bg-black shadow-2xl shadow-black/60"
          >
            {[...navItems, { index: "07", label: "Docs", href: "/docs", icon: BookOpenText }].map(
              (item) => (
                <a
                  key={item.label}
                  aria-current={activePage && item.href === `/${activePage}` ? "page" : undefined}
                  className="flex h-12 items-center border-b border-white/10 px-4 font-mono uppercase tracking-normal text-white/58 last:border-b-0 hover:bg-white/[0.04] hover:text-white"
                  href={item.href}
                >
                  <IndexedLabel index={item.index} icon={item.icon} label={item.label} />
                </a>
              ),
            )}
          </nav>
        </details>
      </div>
    </header>
  );
}

type FooterLink = readonly [label: string, href: string];

function FooterActionLink({
  brand,
  href,
  icon: Icon,
  label,
}: {
  brand: string | null;
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  const DirectionIcon = href.startsWith("http") ? ArrowUpRight : ArrowRight;

  return (
    <a
      className="group flex h-12 items-center justify-between border-b border-white/12 px-4 font-mono text-[9px] font-normal uppercase !tracking-[0.04em] text-white/58 transition-[background-color,color] duration-150 hover:bg-white/[0.035] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
      href={href}
    >
      <span className="flex min-w-0 items-center gap-2">
        {brand ? (
          <BrandIcon className="size-3.5 shrink-0 opacity-72" src={brand} />
        ) : (
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
        )}
        <span className="truncate">{label}</span>
      </span>
      <DirectionIcon
        aria-hidden
        className="size-3.5 shrink-0 text-white/30 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-white/72"
        strokeWidth={1.5}
      />
    </a>
  );
}

function FooterLinksGroup({ title, links }: { title: string; links: readonly FooterLink[] }) {
  return (
    <div className="px-4 py-4 md:min-h-[154px]">
      <h3 className="mb-2 font-mono text-[10px] font-normal uppercase !tracking-[0.04em] text-white/34">
        {title}
      </h3>
      <ul className="grid">
        {links.map(([label, href]) => {
          const DirectionIcon = href.startsWith("http") ? ArrowUpRight : ArrowRight;
          const isGitHub = href.includes("github.com");

          return (
            <li key={label}>
              <a
                className="group flex min-h-7 items-center justify-between gap-2 font-mono text-[9px] font-normal uppercase !tracking-[0.04em] text-white/48 transition-colors duration-150 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href={href}
              >
                <span className="flex items-center gap-2">
                  {isGitHub ? <GithubIcon className="size-3.5 opacity-72" /> : null}
                  <span>{label}</span>
                </span>
                <DirectionIcon
                  aria-hidden
                  className="size-3 shrink-0 text-white/0 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-white/56"
                  strokeWidth={1.5}
                />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="w-full">
      <div className="grid grid-cols-1 divide-y divide-white/12 md:grid-cols-4 md:divide-x md:divide-y-0">
        <div>
          <div className="flex h-12 items-center border-b border-white/12 px-4">
            <BrandLockup />
          </div>
          <div className="px-4 py-4 md:min-h-[154px]">
            <p className="max-w-[15rem] font-mono text-[9px] font-normal uppercase leading-5 !tracking-[0.04em] text-white/42">
              A Framework for Product integrated Apps
            </p>
          </div>
        </div>
        {footerGroups.map((group) => (
          <div key={group.title}>
            <FooterActionLink
              brand={group.brand}
              href={group.action[1]}
              icon={group.icon}
              label={group.action[0]}
            />
            <FooterLinksGroup links={group.links} title={group.title} />
          </div>
        ))}
      </div>
      <div className="farm-top-rule flex flex-col gap-2 px-4 py-3 font-mono text-[10px] font-normal uppercase !tracking-[0.04em] text-white/34 sm:flex-row sm:items-center sm:justify-between">
        <span>&copy; {new Date().getFullYear()} Farm.js</span>
        <a
          className="inline-flex items-center gap-1.5 transition-colors duration-150 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          href="https://www.farming-labs.dev"
        >
          farming-labs.dev <ExternalLink aria-hidden className="size-3" strokeWidth={1.5} />
        </a>
      </div>
    </footer>
  );
}

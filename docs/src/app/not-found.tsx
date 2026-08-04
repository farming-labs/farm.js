import { FARM_VERSION } from "@farm.js/core/version";
import { ArrowLeft, ArrowRight, BookOpenText, FileQuestion, Route, Terminal } from "lucide-react";
import { FlickeringGrid } from "../components/ui/flickering-grid";

interface NotFoundProps {
  pathname?: string;
}

const recoveryLinks = [
  { index: "01", label: "Getting started", href: "/docs/getting-started" },
  { index: "02", label: "Browse integrations", href: "/docs/integrations" },
  { index: "03", label: "Read the guide", href: "/docs" },
] as const;

function Wordmark() {
  return (
    <a
      aria-label="Farm.js home"
      className="font-mono text-[11px] font-normal uppercase tracking-normal text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      href="/"
    >
      FARM<span className="text-white/52">.JS</span>
    </a>
  );
}

function IndexedLabel({ index, label }: { index: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-normal uppercase tracking-normal text-current">
      <span className="text-white/26">{index}</span>
      <span aria-hidden className="text-white/18">
        /
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

export default function NotFound({ pathname }: NotFoundProps) {
  const requestedPath = pathname || "/unknown-route";

  return (
    <div className="farm-home min-h-screen overflow-x-hidden bg-black font-sans text-white selection:bg-white selection:text-black">
      <a
        aria-label={`Farm.js ${FARM_VERSION} is open source and in beta. View the documentation.`}
        className="farm-announcement flex h-5 items-center justify-center gap-2 border-b border-white/12 px-4 font-mono text-[10px] font-normal uppercase tracking-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
        href="/docs"
      >
        <span className="text-white/52">Open source</span>
        <span aria-hidden className="text-white/24">
          /
        </span>
        <span className="text-white/76">Farm.js {FARM_VERSION}</span>
      </a>

      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content flex min-h-[calc(100svh-1.25rem)] min-w-0 flex-col">
          <header className="farm-full-rule relative z-40 border-b border-white/12 bg-black/94 backdrop-blur-xl">
            <div className="flex h-11 items-stretch">
              <div className="flex shrink-0 items-center px-4 sm:px-7">
                <Wordmark />
              </div>
              <div className="hidden min-w-0 flex-1 items-center border-l border-white/12 px-5 text-white/42 sm:flex">
                <IndexedLabel index="00" label="Route boundary / not found" />
              </div>
              <a
                className="ml-auto inline-flex h-11 shrink-0 items-center gap-1.5 border-l border-white/12 px-4 font-mono text-[10px] font-normal uppercase tracking-normal text-white/58 transition-[background-color,color] duration-150 hover:bg-white/[0.04] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white sm:px-5"
                href="/docs"
              >
                <BookOpenText aria-hidden className="size-3.5" strokeWidth={1.5} />
                Docs
              </a>
            </div>
          </header>

          <main className="relative flex flex-1 flex-col">
            <section className="farm-full-rule grid flex-1 lg:grid-cols-[minmax(0,1fr)_23rem]">
              <div className="relative z-10 flex min-w-0 flex-col justify-center px-6 py-14 sm:px-10 sm:py-20 lg:px-14 lg:py-24 xl:px-20">
                <div className="text-white/46">
                  <IndexedLabel index="404" label="No matching page route" />
                </div>

                <div className="mt-8 max-w-[43rem]">
                  <p className="font-mono text-[10px] uppercase tracking-normal text-white/32">
                    Error / Not found
                  </p>
                  <h1 className="mt-3 text-balance font-geist-pixel text-4xl font-medium leading-[0.98] tracking-normal text-white sm:text-5xl lg:text-[3.5rem]">
                    This route isn&apos;t in the field.
                  </h1>
                  <p className="mt-5 max-w-[38rem] text-sm leading-6 text-white/52 sm:text-[15px]">
                    Farm.js couldn&apos;t match this request to a page. The route may have moved, or
                    the address might be incomplete.
                  </p>
                </div>

                <div className="mt-8 max-w-[43rem] border border-white/14 bg-black">
                  <div className="flex h-9 items-center justify-between border-b border-white/10 px-3 font-mono text-[9px] font-normal uppercase tracking-normal text-white/34">
                    <span className="flex items-center gap-1.5">
                      <Terminal aria-hidden className="size-3" strokeWidth={1.5} />
                      Request trace
                    </span>
                    <span>text/plain</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-3 px-3 py-4 font-mono text-[11px] sm:px-4 sm:text-xs">
                    <span className="shrink-0 text-white/36">GET</span>
                    <code className="min-w-0 flex-1 truncate text-white/72" title={requestedPath}>
                      {requestedPath}
                    </code>
                    <span className="shrink-0 border border-white/16 bg-white/[0.055] px-2 py-1 text-[9px] uppercase text-white/68">
                      404 / no match
                    </span>
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row">
                  <a
                    className="inline-flex h-11 items-center justify-center gap-2 border border-white bg-white px-5 font-mono text-[10px] font-normal uppercase tracking-normal text-black transition-[background-color,transform] duration-150 hover:bg-white/88 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    href="/"
                  >
                    <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.5} />
                    Back to home
                  </a>
                  <a
                    className="inline-flex h-11 items-center justify-center gap-2 border border-white/18 bg-black px-5 font-mono text-[10px] font-normal uppercase tracking-normal text-white transition-[background-color,border-color,transform] duration-150 hover:border-white/42 hover:bg-white/[0.06] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    href="/docs/getting-started"
                  >
                    <BookOpenText aria-hidden className="size-3.5" strokeWidth={1.5} />
                    Get started
                    <ArrowRight aria-hidden className="size-3" strokeWidth={1.5} />
                  </a>
                </div>
              </div>

              <aside className="relative min-h-[25rem] overflow-hidden border-t border-white/12 bg-white/[0.018] lg:min-h-0 lg:border-l lg:border-t-0">
                <div
                  aria-hidden
                  className="farm-hero-flicker pointer-events-none absolute inset-0 opacity-75"
                >
                  <FlickeringGrid
                    className="absolute inset-0"
                    color="rgb(255, 255, 255)"
                    flickerChance={0.7}
                    gridGap={8}
                    maxOpacity={0.28}
                    squareSize={2}
                  />
                </div>

                <div className="relative z-10 flex h-full min-h-[25rem] flex-col p-6 sm:p-8 lg:min-h-0">
                  <div className="flex items-center justify-between text-white/38">
                    <IndexedLabel index="SYS" label="Router status" />
                    <FileQuestion aria-hidden className="size-4" strokeWidth={1.35} />
                  </div>

                  <div className="my-auto py-10 text-center">
                    <div className="font-geist-pixel text-[7rem] font-medium leading-none tracking-[-0.08em] text-white sm:text-[8rem] lg:text-[7rem]">
                      404
                    </div>
                    <div className="mx-auto mt-5 flex w-fit items-center gap-2 border border-white/14 bg-black px-3 py-2 font-mono text-[9px] uppercase tracking-normal text-white/46">
                      <Route aria-hidden className="size-3.5" strokeWidth={1.5} />
                      Route resolution failed
                    </div>
                  </div>

                  <div className="border border-white/12 bg-black/92">
                    {recoveryLinks.map((item) => (
                      <a
                        key={item.href}
                        className="group flex h-11 items-center justify-between border-b border-white/10 px-3 text-white/48 transition-[background-color,color] duration-150 last:border-b-0 hover:bg-white/[0.045] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
                        href={item.href}
                      >
                        <IndexedLabel index={item.index} label={item.label} />
                        <ArrowRight
                          aria-hidden
                          className="size-3.5 shrink-0 text-white/26 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-white/72"
                          strokeWidth={1.5}
                        />
                      </a>
                    ))}
                  </div>
                </div>
              </aside>
            </section>
          </main>

          <footer className="farm-top-rule flex flex-col gap-2 px-4 py-3 font-mono text-[9px] font-normal uppercase tracking-normal text-white/34 sm:flex-row sm:items-center sm:justify-between">
            <span>Request ended with status 404</span>
            <span className="text-white/22">Farm.js route boundary</span>
          </footer>
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}

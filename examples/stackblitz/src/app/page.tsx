import { Counter } from "../components/counter";
import { Guestbook } from "../components/guestbook";

// This page renders on the server. The two "use client" components below are
// hydrated as islands, and the rest of the page ships no JavaScript.
export default function HomePage() {
  const renderedAt = new Date().toLocaleTimeString("en-US", { hour12: false });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Farm.js Playground
        </h1>
        <p className="text-[15px] leading-relaxed text-neutral-400">
          A product-integrated full-stack framework on Vite: typesafe APIs
          and server functions, integrations as typed modules, and an
          experimental compiler that turns component updates into direct DOM
          patches. This page rendered on the server at{" "}
          <code className="text-neutral-200">{renderedAt}</code>. Edit{" "}
          <code className="text-neutral-200">src/app/page.tsx</code> and watch
          it hot-reload.
        </p>
        <div className="flex gap-4 text-sm text-neutral-400">
          <a
            href="https://farmjs.dev"
            className="underline underline-offset-4 hover:text-white"
          >
            Docs
          </a>
          <a
            href="https://github.com/farming-labs/farm.js"
            className="underline underline-offset-4 hover:text-white"
          >
            GitHub ★
          </a>
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-white/10 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Client island
        </h2>
        <p className="text-sm text-neutral-400">
          Only this counter's JavaScript is sent to the browser. The rest of
          the page stays server-only.
        </p>
        <Counter />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-white/10 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Server Function guestbook
        </h2>
        <p className="text-sm text-neutral-400">
          The form calls a <code>createServerFn</code> mutation through a
          typed API client, validated with Zod on the server.
        </p>
        <Guestbook />
      </section>
    </main>
  );
}

import React from "react";
import {
  OptimizedBoundary,
  type StrataDocument,
  type StrataNode,
} from "@farmjs/plugin/rsc/optimized-boundary";
import { Counter } from "../components/Counter";
import { createStaticContentDocument } from "./document";

export const metadata = {
  title: "Optimized Boundary | Farm.js RSC Demo",
  description: "Experimental optimized host-content boundaries carried through RSC",
};

interface PageProps {
  searchParams?: Record<string, string>;
}

function reactAttributes(attributes: Record<string, string> | undefined) {
  if (!attributes) return {};

  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name === "class" ? "className" : name,
      value,
    ]),
  );
}

function renderReactNode(node: StrataNode, key: string): React.ReactNode {
  if (node.type === "text") return node.value;

  return React.createElement(
    node.tag,
    { ...reactAttributes(node.attributes), key },
    ...(node.children || []).map((child, index) => renderReactNode(child, `${key}.${index}`)),
  );
}

function ReactDocument({ document }: { document: StrataDocument }) {
  return (
    <article
      className="static-content space-y-8 rounded-xl border border-slate-700 bg-slate-900/40 p-6"
      data-static-content="react"
    >
      {(document.children || []).map((node, index) => renderReactNode(node, String(index)))}
    </article>
  );
}

export default function StaticContentPage({ searchParams = {} }: PageProps) {
  const mode = searchParams.mode === "react" ? "react" : "optimized";
  const document = createStaticContentDocument();

  return (
    <div className="space-y-8">
      <div className="space-y-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Experimental
        </p>
        <h1 className="text-4xl font-bold text-white">Optimized boundary comparison</h1>
        <p className="mx-auto max-w-3xl text-slate-400">
          Both modes render the same typed host-only document. The optimized boundary automatically
          compiles its interior into one safe HTML value while normal mode sends a React element
          tree.
        </p>
        <div className="flex justify-center gap-3">
          <a
            href="/static-content?mode=optimized"
            data-mode-link="optimized"
            className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold hover:bg-emerald-500"
          >
            Optimized boundary
          </a>
          <a
            href="/static-content?mode=react"
            data-mode-link="react"
            className="rounded-lg bg-slate-600 px-4 py-2 font-semibold hover:bg-slate-500"
          >
            React tree
          </a>
        </div>
        <p className="font-mono text-sm text-cyan-300" data-render-mode={mode}>
          Current representation: {mode}
          {mode === "optimized" ? " · native-rendered host content" : " · React-owned host tree"}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {mode === "optimized" ? (
          <OptimizedBoundary
            as="article"
            className="static-content space-y-8 rounded-xl border border-emerald-700/60 bg-slate-900/40 p-6"
            document={document}
            data-static-content="optimized"
          />
        ) : (
          <ReactDocument document={document} />
        )}

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Counter />
          <p className="mt-4 text-sm text-slate-400">
            Change the count, then switch representations. This Client Component should retain its
            state because React still owns the surrounding shell.
          </p>
        </aside>
      </div>
    </div>
  );
}

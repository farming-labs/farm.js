import { Fragment, isValidElement, type ComponentPropsWithoutRef } from "react";
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import typescript from "shiki/langs/typescript.mjs";
import vesper from "shiki/themes/vesper.mjs";
import { AgentWaitlist } from "./components/agents/waitlist";
import { BlogCodeCopy } from "./components/blog/code-copy-button";
import { BlogFigure } from "./components/blog/figures";
import { BlogVideo } from "./components/blog/video";

// Farm loads this map only on the server for source-authored Markdown routes.
// Load the blog's grammars once, with the same dark palette as the docs.
const highlighter = createHighlighterCoreSync({
  themes: [vesper],
  langs: [bash, typescript],
  engine: createJavaScriptRegexEngine(),
});
const languages = new Set(highlighter.getLoadedLanguages());
// The launch film's code palette over vesper: plain code soft grey, keywords and punctuation dim,
// names a step brighter, strings brightest (the docs map the same colours in docs-overrides.css).
const FILM_PALETTE: Record<string, string> = {
  "#FFFFFF": "#a1a1a1",
  "#FFF": "#a1a1a1",
  "#A0A0A0": "#6b6b6b",
  "#FFC799": "#d4d4d4",
  "#FFCFA8": "#d4d4d4",
  "#FF8080": "#d4d4d4",
  "#99FFE4": "#e8e8e8",
};
const filmColor = (color?: string) => (color && FILM_PALETTE[color.toUpperCase()]) ?? "#a1a1a1";

function Code({ children, className, ...props }: ComponentPropsWithoutRef<"code">) {
  const language = className?.match(/(?:^|\s)language-([^\s]+)/)?.[1];
  if (typeof children !== "string" || !language || !languages.has(language)) {
    return (
      <code {...props} className={className}>
        {children}
      </code>
    );
  }

  const lines = highlighter.codeToTokensBase(children, { lang: language, theme: "vesper" });
  return (
    <code {...props} className={className} data-highlighted="true">
      {lines.map((tokens, line) => (
        <Fragment key={line}>
          {line > 0 ? "\n" : null}
          {tokens.map((token, index) => (
            <span key={index} style={{ color: filmColor(token.color) }}>
              {token.content}
            </span>
          ))}
        </Fragment>
      ))}
    </code>
  );
}

function Pre({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const code = isValidElement<{ className?: string; children?: unknown }>(children)
    ? children.props
    : undefined;
  const language = code?.className?.match(/language-([^\s]+)/)?.[1];
  const label =
    language === "bash" || language === "sh"
      ? "Terminal"
      : language === "ts" || language === "typescript"
        ? "TypeScript"
        : "Code";
  return (
    <div className="blog-code-block">
      <div className="blog-code-toolbar">
        <span>{label}</span>
        <div className="blog-code-actions">
          <span aria-hidden="true">
            {language === "typescript" || language === "ts" ? "TS" : language}
          </span>
          <BlogCodeCopy
            text={typeof code?.children === "string" ? code.children : ""}
            label={label}
          />
        </div>
      </div>
      <pre tabIndex={0} aria-label={`${label} code`} {...props}>
        {children}
      </pre>
    </div>
  );
}

export const components = { code: Code, pre: Pre, AgentWaitlist, BlogFigure, BlogVideo };

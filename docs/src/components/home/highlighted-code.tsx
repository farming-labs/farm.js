import { Code2 } from "lucide-react";
import { highlight } from "sugar-high";

interface HighlightedCodeProps {
  className?: string;
  code: string;
  label: string;
  language: string;
}

export function HighlightedCode({ className, code, label, language }: HighlightedCodeProps) {
  const highlightedCode = highlight(code.trim()).replace(
    /<\/span>\n<span class="sh__line"/g,
    '</span><span class="sh__line"',
  );

  return (
    <figure
      className={[
        "min-w-0 max-w-full overflow-hidden border border-white/16 bg-black shadow-[0_24px_70px_rgba(0,0,0,0.55)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <figcaption className="flex h-10 min-w-0 items-center justify-between gap-4 border-b border-white/10 px-4 font-mono text-[9px] tracking-normal text-white/38">
        <span className="flex min-w-0 items-center gap-2">
          <Code2 aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
          <span className="truncate">{label}</span>
        </span>
        <span className="shrink-0 uppercase text-white/24">{language}</span>
      </figcaption>
      <pre
        aria-label={`${label} code`}
        className="max-w-full overflow-x-auto py-4 font-mono text-[10.5px] leading-6 tracking-normal sm:text-[11px]"
        tabIndex={0}
      >
        <code
          className="farm-highlighted-code block min-w-full"
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </figure>
  );
}

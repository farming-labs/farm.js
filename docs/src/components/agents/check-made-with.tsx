import {
  type SimpleIcon,
  siAstro,
  siDocusaurus,
  siDrupal,
  siEleventy,
  siFramer,
  siGatsby,
  siGhost,
  siGitbook,
  siHexo,
  siHugo,
  siJekyll,
  siNextdotjs,
  siNuxt,
  siReactrouter,
  siRemix,
  siShopify,
  siSvelte,
  siTanstack,
  siVitepress,
  siWebflow,
  siWix,
  siWordpress,
} from "simple-icons";
import farmingLabsLogoUrl from "../../assets/farming-labs-logo-dark.svg?url";
import type { AgentCheckReport } from "../../lib/agents-check";

/**
 * Marks for what the check recognizes, by the name it reports (Simple Icons, CC0; each mark
 * is its owner's trademark). A name not listed here shows no mark.
 */
const MARKS: Record<string, SimpleIcon> = {
  "Next.js": siNextdotjs,
  Nuxt: siNuxt,
  SvelteKit: siSvelte,
  Astro: siAstro,
  "React Router": siReactrouter,
  Remix: siRemix,
  "TanStack Start": siTanstack,
  Gatsby: siGatsby,
  Docusaurus: siDocusaurus,
  VitePress: siVitepress,
  WordPress: siWordpress,
  Shopify: siShopify,
  Webflow: siWebflow,
  Framer: siFramer,
  // Named by their generator meta tag.
  Hugo: siHugo,
  Jekyll: siJekyll,
  Ghost: siGhost,
  Hexo: siHexo,
  Eleventy: siEleventy,
  Drupal: siDrupal,
  GitBook: siGitbook,
  "Wix.com Website Builder": siWix,
};

/** A brand color when it reads on the page's black, otherwise the page's text color. */
function onBlack(hex: string) {
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05 >= 3 ? `#${hex}` : "#ededed";
}

/**
 * What a checked site is made with, as a small mark beside its name that says so on hover.
 * Farm.js gets the Farming Labs mark and links home, with its version when the site's manifest
 * names one; a framework the check recognizes gets its own mark; anything else shows nothing.
 */
export function AgentCheckMadeWith({
  report,
}: {
  report: Pick<AgentCheckReport, "farm" | "framework" | "farmVersion">;
}) {
  if (report.farm || report.framework === "Farm.js") {
    const label = `Made with Farm.js${report.farmVersion ? ` ${report.farmVersion}` : ""}`;
    return (
      <a className="agent-check-made-with" href="/" aria-label={label} data-tip={label}>
        <img alt="" aria-hidden src={farmingLabsLogoUrl} />
      </a>
    );
  }
  const mark = report.framework ? MARKS[report.framework] : undefined;
  if (!mark) return null;
  const label = `Made with ${report.framework}`;
  return (
    <span className="agent-check-made-with" role="img" aria-label={label} data-tip={label}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d={mark.path} fill={onBlack(mark.hex)} />
      </svg>
    </span>
  );
}

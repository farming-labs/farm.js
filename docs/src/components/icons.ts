import { createElement, forwardRef } from "react";
import type { LucideProps } from "lucide-react";
import {
  Activity as LucideActivity,
  ArrowRight as LucideArrowRight,
  ArrowUpRight as LucideArrowUpRight,
  Atom as LucideAtom,
  Blocks as LucideBlocks,
  BookOpen as LucideBookOpen,
  BookOpenText as LucideBookOpenText,
  Bot as LucideBot,
  Braces as LucideBraces,
  Check as LucideCheck,
  ChevronRight as LucideChevronRight,
  CloudCog as LucideCloudCog,
  Code2 as LucideCode2,
  Copy as LucideCopy,
  Cpu as LucideCpu,
  Database as LucideDatabase,
  ExternalLink as LucideExternalLink,
  File as LucideFile,
  FileCode2 as LucideFileCode2,
  FileJson2 as LucideFileJson2,
  FileOutput as LucideFileOutput,
  FileText as LucideFileText,
  Folder as LucideFolder,
  FolderOpen as LucideFolderOpen,
  FolderTree as LucideFolderTree,
  GitFork as LucideGitFork,
  Layers3 as LucideLayers3,
  LoaderCircle as LucideLoaderCircle,
  Lock as LucideLock,
  Menu as LucideMenu,
  Network as LucideNetwork,
  Newspaper as LucideNewspaper,
  Plug as LucidePlug,
  RefreshCw as LucideRefreshCw,
  Rocket as LucideRocket,
  Route as LucideRoute,
  Server as LucideServer,
  Terminal as LucideTerminal,
  TimerReset as LucideTimerReset,
  Weight as LucideWeight,
  X as LucideX,
} from "lucide-react";

/**
 * The lucide icons the homepage and the site chrome draw, without the attributes lucide prints on
 * every icon: xmlns, width and height, fill, stroke, and line caps. The same values come from the
 * `svg.lucide` rules in globals.css, which keeps about 130 bytes per icon out of the HTML.
 */
const defaults = {
  xmlns: undefined,
  width: undefined,
  height: undefined,
  fill: undefined,
  stroke: undefined,
  strokeLinecap: undefined,
  strokeLinejoin: undefined,
} as const;

// Typed as the icon it wraps, so props and refs read exactly like lucide's own components.
function lean<T extends typeof LucideActivity>(Icon: T): T {
  const LeanIcon = forwardRef<SVGSVGElement, LucideProps>((props, ref) =>
    createElement(Icon, { ...defaults, ...props, ref }),
  );
  LeanIcon.displayName = Icon.displayName;
  return LeanIcon as unknown as T;
}

export const Activity = lean(LucideActivity);
export const ArrowRight = lean(LucideArrowRight);
export const ArrowUpRight = lean(LucideArrowUpRight);
export const Atom = lean(LucideAtom);
export const Blocks = lean(LucideBlocks);
export const BookOpen = lean(LucideBookOpen);
export const BookOpenText = lean(LucideBookOpenText);
export const Bot = lean(LucideBot);
export const Braces = lean(LucideBraces);
export const Check = lean(LucideCheck);
export const ChevronRight = lean(LucideChevronRight);
export const CloudCog = lean(LucideCloudCog);
export const Code2 = lean(LucideCode2);
export const Copy = lean(LucideCopy);
export const Cpu = lean(LucideCpu);
export const Database = lean(LucideDatabase);
export const ExternalLink = lean(LucideExternalLink);
export const File = lean(LucideFile);
export const FileCode2 = lean(LucideFileCode2);
export const FileJson2 = lean(LucideFileJson2);
export const FileOutput = lean(LucideFileOutput);
export const FileText = lean(LucideFileText);
export const Folder = lean(LucideFolder);
export const FolderOpen = lean(LucideFolderOpen);
export const FolderTree = lean(LucideFolderTree);
export const GitFork = lean(LucideGitFork);
export const Layers3 = lean(LucideLayers3);
export const LoaderCircle = lean(LucideLoaderCircle);
export const Lock = lean(LucideLock);
export const Menu = lean(LucideMenu);
export const Network = lean(LucideNetwork);
export const Newspaper = lean(LucideNewspaper);
export const Plug = lean(LucidePlug);
export const RefreshCw = lean(LucideRefreshCw);
export const Rocket = lean(LucideRocket);
export const Route = lean(LucideRoute);
export const Server = lean(LucideServer);
export const Terminal = lean(LucideTerminal);
export const TimerReset = lean(LucideTimerReset);
export const Weight = lean(LucideWeight);
export const X = lean(LucideX);

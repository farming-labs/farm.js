import {
  Braces,
  Code2,
  Eye,
  FileText,
  IdCard,
  ListTree,
  type LucideIcon,
  MousePointerClick,
  ShieldCheck,
  Tag,
  Wrench,
} from "lucide-react";

/** One icon per check id, shared by the landing list and the report. */
export const AGENT_CHECK_ICONS: Record<string, LucideIcon> = {
  readable: Eye,
  markdown: FileText,
  "llms-txt": ListTree,
  robots: ShieldCheck,
  metadata: Tag,
  mcp: Wrench,
  openapi: Braces,
  "json-ld": Code2,
  "agent-card": IdCard,
  webmcp: MousePointerClick,
};

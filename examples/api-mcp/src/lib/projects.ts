export type ProjectStatus = "active" | "planned";

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
}

// Demo-only process-local data. Config and routes can be evaluated by separate
// module loaders in development. Real apps should use a shared database/store.
const demo = globalThis as typeof globalThis & { __farmApiMcpProjects?: Project[] };

export const projects: Project[] = demo.__farmApiMcpProjects ??= [
  { id: "farm-core", name: "Farm core", status: "active" },
  { id: "edge-docs", name: "Docs on the edge", status: "active" },
  { id: "agent-tools", name: "Agent tools", status: "planned" },
];

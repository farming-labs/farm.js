export type ProjectStatus = "active" | "planned";

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
}

export const projects: Project[] = [
  { id: "farm-core", name: "Farm core", status: "active" },
  { id: "edge-docs", name: "Docs on the edge", status: "active" },
  { id: "agent-tools", name: "Agent tools", status: "planned" },
];

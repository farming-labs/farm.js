export const FARM_TELEMETRY_COMMANDS = [
  "dev",
  "build",
  "start",
  "auth:migrate",
  "upgrade",
  "generate",
  "doctor",
  "explain",
  "preview",
  "migrate",
  "cron:list",
  "cron:run",
  "add:integration",
  "deploy",
] as const;

export const FARM_CREATE_APP_TELEMETRY_COMMANDS = ["create", "list-templates"] as const;

export const FARM_TELEMETRY_TEMPLATES = [
  "basic",
  "react-compiler",
  "auth",
  "better-auth",
  "ai",
  "auth0",
  "authjs",
  "autumn",
  "clerk",
  "jobs-inngest",
  "jobs-trigger",
  "polar",
  "resend",
  "stripe",
  "supabase",
  "unkey",
  "workos",
] as const;

export const FARM_TELEMETRY_RENDERERS = ["react", "preact", "solid", "vue", "svelte"] as const;
export const FARM_TELEMETRY_PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export const FARM_TELEMETRY_DEPLOY_TARGETS = [
  "vercel",
  "cloudflare",
  "netlify",
  "node",
  "custom",
] as const;

declare module "@farm.js/cli/add-integration" {
  export type FarmIntegrationProvider =
    | "ai"
    | "auth0"
    | "authjs"
    | "autumn"
    | "better-auth"
    | "clerk"
    | "jobs-inngest"
    | "jobs-trigger"
    | "polar"
    | "resend"
    | "stripe"
    | "supabase"
    | "unkey"
    | "workos";

  export interface AddFarmIntegrationResult {
    env: string[];
    notes: string[];
  }

  export function addFarmIntegration(options: {
    root?: string;
    provider: string;
    ui?: boolean;
  }): Promise<AddFarmIntegrationResult>;
}

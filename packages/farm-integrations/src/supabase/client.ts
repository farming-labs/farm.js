import { api } from "@farmjs/core/client";

export const supabaseAuthFormFields = {
  email: "email",
  password: "password",
  returnTo: "returnTo",
} as const;

export interface SupabaseCredentials {
  email: string;
  password: string;
  returnTo?: string;
}

export interface SupabaseOAuthInput {
  provider: string;
  returnTo?: string;
}

export interface SupabaseRedirectResult {
  redirectTo: string;
}

export interface SupabaseSignUpResult extends SupabaseRedirectResult {
  emailConfirmationRequired?: boolean;
  email?: string;
  message?: string;
}

export interface SupabaseSessionResult {
  authenticated: boolean;
  user?: Record<string, unknown>;
}

export interface SupabaseLogoutInput {
  returnTo?: string;
}

export const supabaseClient = {
  login: api.post<SupabaseCredentials, SupabaseRedirectResult>("/auth/login"),
  signup: api.post<SupabaseCredentials, SupabaseSignUpResult>("/auth/signup"),
  oauth: api.get<SupabaseOAuthInput, SupabaseRedirectResult>("/auth/login", {
    responseFormat: "json",
  }),
  logout: api.post<SupabaseLogoutInput, SupabaseRedirectResult>("/auth/logout"),
  session: api.get<SupabaseSessionResult>("/auth/session", {
    responseFormat: "json",
  }),
};

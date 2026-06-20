import { api } from "@farmjs/core/client";

export interface WorkOSRedirectQuery {
  returnTo?: string;
}

export interface WorkOSRedirectResult {
  redirectTo: string;
}

export interface WorkOSSessionResult {
  authenticated: boolean;
  sessionId?: string;
  organizationId?: string;
  user?: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profilePictureUrl?: string | null;
  };
}

export const workosClient = {
  login: api.get<WorkOSRedirectQuery, WorkOSRedirectResult>("/login", {
    responseFormat: "json",
  }),
  signup: api.get<WorkOSRedirectQuery, WorkOSRedirectResult>("/signup", {
    responseFormat: "json",
  }),
  logout: api.post<never, WorkOSRedirectResult>("/logout", {
    responseFormat: "json",
  }),
  session: api.get<WorkOSSessionResult>("/auth/session", {
    responseFormat: "json",
  }),
};

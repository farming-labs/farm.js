import { api } from "@farm.js/core/client";

export interface Auth0RedirectQuery {
  returnTo?: string;
}

export interface Auth0RedirectResult {
  redirectTo: string;
}

export interface Auth0ProfileResult {
  authenticated: boolean;
  user?: Record<string, unknown>;
}

export const auth0Client = {
  login: api.get<Auth0RedirectQuery, Auth0RedirectResult>("/auth/login", {
    responseFormat: "json",
  }),
  signup: api.get<Auth0RedirectQuery, Auth0RedirectResult>("/auth/signup", {
    responseFormat: "json",
  }),
  logout: api.get<Auth0RedirectResult>("/auth/logout", {
    responseFormat: "json",
  }),
  profile: api.get<Auth0ProfileResult>("/auth/profile", {
    responseFormat: "json",
  }),
};

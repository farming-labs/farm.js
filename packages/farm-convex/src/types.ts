import type { ChildProcess } from "node:child_process";
import type { ReactNode } from "react";

import type {
  FarmIntegrationLogger,
  FarmIntegrationProviderComponentReference,
  FarmIntegrationRouteMethod,
} from "@farm.js/core";

export type ConvexTokenReader = (
  request: Request,
) => Promise<string | null | undefined> | string | null | undefined;

export type ConvexService = "auth" | "billing";

export type ConvexServiceSide = "convex" | "farm";

export type ConvexHomes = Partial<Record<ConvexService, ConvexServiceSide>>;

export type ConvexPairRelation = "conflict" | "together";

export interface ConvexDevOptions {
  args?: readonly string[];
}

export interface ConvexIntegrationInput {
  url?: string;
  siteURL?: string;
  provider?: FarmIntegrationProviderComponentReference;
  dev?: boolean | ConvexDevOptions;
  token?: ConvexTokenReader;
  /** Same-origin path the browser fetches the visitor's Convex token from, such as "/api/auth/token". */
  tokenPath?: string;
  home?: ConvexHomes;
  functionsDirectory?: string;
  log?: FarmIntegrationLogger;
  use?: readonly ConvexExtension[];
  /** Turn on helpers for the components in convex.config.ts. @default true */
  detect?: boolean;
}

/** A route on the app's own domain that Farm forwards to the Convex site URL. */
export interface ConvexExtensionRoute {
  /** Farm route pattern, such as "/api/auth/[...auth]" or "/api/webhooks/polar". */
  path: string;
  /** Methods to forward. Defaults to GET and POST. */
  methods?: readonly FarmIntegrationRouteMethod[];
  /** Path on the Convex site URL. Defaults to the incoming path. */
  to?: string;
}

/** A path on the Convex site URL that turns the visitor's session cookie into a Convex token. */
export interface ConvexSiteToken {
  path: string;
  /** Skip the request unless the cookie header contains this, such as "session_token=". */
  cookie?: string;
}

/** A service that lives in Convex, such as auth or billing, wired into Farm by convex({ use }). */
export interface ConvexExtension {
  name: string;
  /**
   * What kind of service the component is, for the check that it is not also set up in Farm.
   * An extension that signs visitors in counts as auth.
   */
  service?: ConvexService;
  /** The Convex component it needs in convex.config.ts, such as "@convex-dev/polar". */
  component?: string;
  routes?: readonly ConvexExtensionRoute[];
  /** Reads the visitor's Convex token on the server. Only one extension can sign visitors in. */
  token?: ConvexTokenReader;
  /** Reads the visitor's token from a path on the Convex site URL instead of `token`. */
  siteToken?: ConvexSiteToken;
  /** Same-origin path the browser fetches the visitor's Convex token from. */
  tokenPath?: string;
  /** Browser provider used instead of the default one. */
  provider?: FarmIntegrationProviderComponentReference;
}

export interface ConvexDeploymentURLs {
  url: string;
  siteURL: string;
}

export interface ConvexRuntime extends ConvexDeploymentURLs {
  token?: ConvexTokenReader;
}

export interface ConvexProviderProps {
  url: string;
  /** Same-origin path to fetch the visitor's Convex token from; omit for signed-out clients. */
  tokenPath?: string;
  children?: ReactNode;
}

export interface ConvexServerOptions {
  request?: Request;
  token?: string;
}

export interface ConvexPair {
  service: ConvexService;
  component: string;
  integration: string;
  relation: ConvexPairRelation;
}

export interface ConvexServiceSetup {
  service: ConvexService;
  side: ConvexServiceSide;
  name: string;
}

export interface ConvexHomeConflict {
  service: ConvexService;
  component: string;
  integration: string;
}

export interface ConvexFarmConfigView {
  root?: string;
  auth?: unknown;
  integrations?: Record<string, ConvexIntegrationView | undefined>;
}

export interface ConvexIntegrationView {
  type?: string;
}

export interface ConvexDevState {
  child?: ChildProcess;
}

/** Options for component(): what Farm should do for a Convex component. */
export interface ConvexComponentOptions {
  /** Shown in errors and warnings. Defaults to the component's package name. */
  name?: string;
  /** Paths on your domain forwarded to Convex: { "/api/webhooks/resend": "/resend-webhook" }. */
  routes?: Readonly<Record<string, string>> | readonly ConvexExtensionRoute[];
  /**
   * Receive the component's webhooks on your domain. `true` uses /api/webhooks/<name> for a known
   * component; a string sets the path.
   */
  webhooks?: string | true;
  /** The webhook path the component registers in convex/http.ts, if it is not the default. */
  convexPath?: string;
  token?: ConvexTokenReader;
  tokenPath?: string;
  provider?: FarmIntegrationProviderComponentReference;
}

/** What Farm knows about a well-known Convex component. */
export interface ConvexKnownComponent {
  name: string;
  service?: ConvexService;
  routes?: readonly ConvexExtensionRoute[];
  webhook?: { path: string; convexPath: string };
  siteToken?: ConvexSiteToken;
  tokenPath?: string;
}

export interface ConvexAdapterOptions {
  url?: string;
  secret?: string;
  module?: string;
}

export interface ConvexStorageOptions extends ConvexAdapterOptions {
  namespace?: string;
}

export interface ConvexAdapterCaller {
  query<Result>(name: string, args: Record<string, unknown>): Promise<Result>;
  mutation<Result>(name: string, args: Record<string, unknown>): Promise<Result>;
}

export interface ConvexRuntimeHolder {
  __farmConvexRuntime?: ConvexRuntime;
}

export interface ForwardRequestInit extends RequestInit {
  duplex: "half";
}

export interface ConvexPluginInput {
  dev: ConvexDevOptions | undefined;
  homes: ConvexHomes;
  functionsDirectory: string;
  extensions: readonly ConvexExtension[];
  /** No deployment yet: farm dev runs convex dev to create one. */
  waitingForDeployment?: boolean;
}

export interface ConvexKeyPrefixer {
  addPrefix(key: string): string;
  removePrefix(key: string): string;
}

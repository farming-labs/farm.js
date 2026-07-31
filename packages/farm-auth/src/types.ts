export interface FarmAuthEmailAndPasswordConfig {
  /** Require a verified email before creating a session. @default false */
  requireEmailVerification?: boolean;
  /** Smallest accepted password length. @default 8 */
  minPasswordLength?: number;
  /** Largest accepted password length. @default 128 */
  maxPasswordLength?: number;
}

export interface FarmAuthSessionConfig {
  /** Session lifetime in seconds. @default 604800 */
  expiresIn?: number;
  /** Session refresh interval in seconds. @default 86400 */
  updateAge?: number;
}

export interface FarmAuthDatabaseConfig {
  /**
   * Postgres connection string. Defaults to DATABASE_URL.
   * Local development falls back to SQLite when no URL is present.
   */
  url?: string;
  /** Local SQLite path. @default ".farm/auth.sqlite" */
  path?: string;
  /** Automatically update the schema in development. @default true */
  migrateInDevelopment?: boolean;
}

export interface FarmAuthConfig {
  /** Set false to disable auth without removing its configuration. @default true */
  enabled?: boolean;
  /** Display name used by authentication emails and metadata. */
  appName?: string;
  /** Route prefix for the auth endpoints. @default "/api/auth" */
  basePath?: string;
  /**
   * Email/password authentication. It is enabled by default; set false to
   * disable it when adding another sign-in method.
   */
  emailAndPassword?: boolean | FarmAuthEmailAndPasswordConfig;
  session?: FarmAuthSessionConfig;
  database?: FarmAuthDatabaseConfig;
}

export type FarmAuthUserConfig = boolean | FarmAuthConfig;

export interface ResolvedFarmAuthConfig {
  enabled: boolean;
  appName?: string;
  basePath: string;
  emailAndPassword: {
    enabled: boolean;
    requireEmailVerification: boolean;
    minPasswordLength: number;
    maxPasswordLength: number;
  };
  session: {
    expiresIn: number;
    updateAge: number;
  };
  database: {
    url?: string;
    path: string;
    migrateInDevelopment: boolean;
  };
}

export interface FarmAuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FarmAuthSessionData {
  id: string;
  userId: string;
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface FarmAuthSession {
  session: FarmAuthSessionData;
  user: FarmAuthUser;
}

export interface FarmAuthLookupOptions {
  /** Return a 401 Response when no session exists. */
  required?: boolean;
  /** Override the current Farm request, primarily for route handlers and tests. */
  request?: Request;
}

export interface FarmAuthCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface FarmAuthSignUpInput extends FarmAuthCredentials {
  name: string;
}

export interface FarmAuthClientOptions {
  /** Must match auth.basePath when that option is customized. */
  basePath?: string;
  /** Optional absolute origin for non-browser clients. */
  baseURL?: string;
}

import path from "node:path";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

const database = new Database(path.join(process.cwd(), "better-auth.sqlite"));

const socialProviders = {
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
  ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        },
      }
    : {}),
};

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "farm-example-better-auth-secret-for-local-dev-only",
  database,
  trustedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 4,
    maxPasswordLength: 128,
  },
  socialProviders,
  plugins: [twoFactor(), passkey(), organization()],
});

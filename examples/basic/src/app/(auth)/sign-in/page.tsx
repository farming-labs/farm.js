import type { Metadata } from "@farm.js/core";

export const metadata: Metadata = {
  title: "Sign in | Farm.js",
};

export default function SignInPage() {
  return <h1 data-testid="auth-page">Sign in</h1>;
}

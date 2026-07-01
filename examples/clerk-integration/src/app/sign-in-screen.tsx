"use client";

import { SignIn } from "@clerk/react";

export function SignInScreen() {
  return (
    <main className="page-shell">
      <section className="card form-card clerk-card">
        <h1>Clerk Sign In</h1>
        <p>Sign in with the real Clerk component, then continue to the dashboard.</p>
        <p>
          Use an existing <code>+clerk_test</code> account for local testing.
          If Clerk asks for an email code, enter <code>424242</code>.
        </p>
        <div className="clerk-host">
          <SignIn
            fallbackRedirectUrl="/dashboard"
            path="/sign-in"
            routing="path"
            signUpUrl="/sign-up"
          />
        </div>
      </section>
    </main>
  );
}

"use client";

import { SignUp } from "@clerk/react";

export function SignUpScreen() {
  return (
    <main className="page-shell">
      <section className="card form-card clerk-card">
        <h1>Clerk Sign Up</h1>
        <p>Create a user with the real Clerk sign-up component.</p>
        <p>
          For local testing, use an email ending with <code>+clerk_test</code>.
          If Clerk requests email verification, enter <code>424242</code>.
        </p>
        <div className="clerk-host">
          <SignUp
            fallbackRedirectUrl="/dashboard"
            path="/sign-up"
            routing="path"
            signInUrl="/sign-in"
          />
        </div>
      </section>
    </main>
  );
}

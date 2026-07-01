"use client";

import { useState } from "react";
import { signIn } from "../../../auth";

export default function SignInPage() {
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    setPending(true);
    const response = await signIn("github");

    if (response.status < 400) {
      window.location.href = "/dashboard";
      return;
    }

    setPending(false);
  }

  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Sign In</h1>
        <p>Use the exported Auth.js helper to start the sign-in flow.</p>
        <button className="primary-button" disabled={pending} onClick={handleSignIn} type="button">
          {pending ? "Working..." : "Sign In with GitHub"}
        </button>
        <a className="inline-link" href="/">
          Back home
        </a>
      </section>
    </main>
  );
}

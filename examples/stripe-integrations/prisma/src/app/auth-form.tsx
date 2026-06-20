"use client";

import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
}

export function AuthForm({ mode }: AuthFormProps) {
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    const name = String(formData.get("name") || "");

    const response =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });

    if (response.error) {
      setError(response.error.message ?? "Authentication failed");
      setPending(false);
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <section className="card form-card">
      <h1>{mode === "sign-in" ? "Sign In" : "Create Account"}</h1>
      <p>
        {mode === "sign-in"
          ? "Use the Better Auth client to create a session and enter the dashboard."
          : "Create a demo account through Better Auth, then continue to the dashboard."}
      </p>
      <form className="mock-form" onSubmit={submit}>
        {mode === "sign-up" ? (
          <label>
            Name
            <input defaultValue="Farm User" name="name" placeholder="Farm User" type="text" />
          </label>
        ) : null}
        <label>
          Email
          <input
            defaultValue="person@farmjs.dev"
            name="email"
            placeholder="person@farmjs.dev"
            type="email"
          />
        </label>
        <label>
          Password
          <input
            defaultValue="secret123"
            name="password"
            placeholder="••••••••"
            type="password"
          />
        </label>
        <button className="primary-button" disabled={!hydrated || pending} type="submit">
          {!hydrated
            ? "Loading client..."
            : pending
              ? "Working..."
              : mode === "sign-in"
                ? "Sign In"
                : "Sign Up"}
        </button>
      </form>
      {error ? <div className="notice notice-error">{error}</div> : null}
      <a className="secondary-link" href="/">
        Back home
      </a>
    </section>
  );
}

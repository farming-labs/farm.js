"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type AuthMode = "sign-in" | "sign-up";

type AuthScreenProps = {
  mode: AuthMode;
  initialReturnTo?: string;
  error?: string;
  message?: string;
  email?: string;
};

type Feedback =
  | {
      tone: "error" | "success";
      message: string;
    }
  | null;

function normalizeInitialFeedback(props: Pick<AuthScreenProps, "error" | "message" | "email">): Feedback {
  if (props.error) {
    return {
      tone: "error",
      message: props.error,
    };
  }

  if (props.message === "check-email") {
    return {
      tone: "success",
      message: props.email
        ? `Check ${props.email} to confirm your account, then sign in.`
        : "Check your email to confirm your account, then sign in.",
    };
  }

  if (props.message) {
    return {
      tone: "success",
      message: props.message,
    };
  }

  return null;
}

export default function AuthScreen(props: AuthScreenProps) {
  const [hydrated, setHydrated] = useState(false);
  const [returnTo, setReturnTo] = useState(props.initialReturnTo || "/dashboard");
  const [email, setEmail] = useState(props.email || "");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(normalizeInitialFeedback(props));
  const [pendingAction, setPendingAction] = useState<"submit" | null>(null);

  useEffect(() => {
    setHydrated(true);

    const currentUrl = new URL(window.location.href);
    const nextReturnTo = currentUrl.searchParams.get("returnTo");
    if (nextReturnTo) {
      setReturnTo(nextReturnTo);
    }

    const nextError = currentUrl.searchParams.get("error") || undefined;
    const nextMessage = currentUrl.searchParams.get("message") || undefined;
    const nextEmail = currentUrl.searchParams.get("email") || undefined;

    if (nextEmail && !props.email) {
      setEmail(nextEmail);
    }

    setFeedback(
      normalizeInitialFeedback({
        error: nextError ?? props.error,
        message: nextMessage ?? props.message,
        email: nextEmail ?? props.email,
      }),
    );
  }, [props.email, props.error, props.message]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("submit");
    setFeedback(null);

    if (props.mode === "sign-in") {
      const result = await api.supabase.login({
        body: {
          email,
          password,
          returnTo,
        },
      });
      if (result.error) {
        setFeedback({
          tone: "error",
          message: result.error.message,
        });
      } else if (result.data) {
        window.location.assign(result.data.redirectTo);
      }

      setPendingAction(null);
      return;
    }

    const result = await api.supabase.signup({
      body: {
        email,
        password,
        returnTo,
      },
    });

    if (result.error) {
      setFeedback({
        tone: "error",
        message: result.error.message,
      });
    } else if (result.data) {
      window.location.assign(result.data.redirectTo);
    }

    setPendingAction(null);
  }

  const submitLabel =
    !hydrated
      ? "Loading client..."
      : props.mode === "sign-in"
        ? pendingAction
          ? "Signing in..."
          : "Sign in"
        : pendingAction
          ? "Creating account..."
          : "Create account";

  return (
    <main className="page-shell auth-page-shell">
      <section className="auth-split">
        <section className="auth-panel auth-panel-hero">
          <span className="eyebrow">Supabase Auth</span>
          <h1>Secure access, server-first.</h1>
          <p>{returnTo === "/dashboard" ? "Continue to /dashboard" : `Continue to ${returnTo}`}</p>
        </section>

        <section className="auth-panel auth-panel-form">
          <nav className="auth-tabs" aria-label="Auth mode">
            <a
              className={`auth-tab ${props.mode === "sign-in" ? "auth-tab-active" : ""}`}
              href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
            >
              Sign in
            </a>
            <a
              className={`auth-tab ${props.mode === "sign-up" ? "auth-tab-active" : ""}`}
              href={`/sign-up?returnTo=${encodeURIComponent(returnTo)}`}
            >
              Sign up
            </a>
          </nav>

          <div className="auth-header">
            <span className="eyebrow">Supabase x Farm</span>
            <h2>{props.mode === "sign-in" ? "Sign in" : "Sign up"}</h2>
          </div>

          {feedback ? (
            <div className={`auth-notice auth-notice-${feedback.tone}`}>{feedback.message}</div>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-label">
              <span>Email</span>
              <input
                className="auth-input"
                type="email"
                value={email}
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label className="auth-label">
              <span>Password</span>
              <input
                className="auth-input"
                type="password"
                value={password}
                autoComplete={props.mode === "sign-in" ? "current-password" : "new-password"}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            <button className="auth-submit" type="submit" disabled={!hydrated || pendingAction !== null}>
              {hydrated && pendingAction ? <span className="button-spinner" aria-hidden="true" /> : null}
              <span>{submitLabel}</span>
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

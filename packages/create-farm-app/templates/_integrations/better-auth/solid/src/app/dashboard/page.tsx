"use client";

import { createSignal, onMount, Show } from "solid-js";
import { authClient } from "../../lib/auth-client";

type SessionData = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;

export default function DashboardPage() {
  const [session, setSession] = createSignal<SessionData | null>(null);
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    const response = await authClient.getSession();
    if (response.error || !response.data?.user) {
      window.location.replace("/sign-in");
      return;
    }
    setSession(response.data);
    setPending(false);
  });

  async function signOut() {
    setPending(true);
    setError(null);
    const response = await authClient.signOut();
    if (response.error) {
      setError(response.error.message ?? "Could not sign out.");
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <Show
      when={session()}
      fallback={
        <main class="loading-shell" aria-live="polite">
          <div class="loading-block">
            <span class="loading-label">Verifying protected session</span>
            <div class="loading-line wide" />
            <div class="loading-line" />
          </div>
        </main>
      }
    >
      {(current) => (
        <main class="dashboard-shell">
          <div class="dashboard-heading">
            <div>
              <span class="section-index">PROTECTED / MIDDLEWARE VERIFIED</span>
              <h1>Welcome back, {current().user.name}.</h1>
              <p>{current().user.email}</p>
            </div>
            <div class="sign-out-control">
              <button class="button button-secondary" disabled={pending()} onClick={signOut}>
                {pending() ? "Signing out…" : "Sign out"}
              </button>
              {error() ? <span class="inline-error">{error()}</span> : null}
            </div>
          </div>
        </main>
      )}
    </Show>
  );
}

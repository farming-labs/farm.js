"use client";

import { useState } from "react";
import { signOut as endSession } from "@farm.js/auth/client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);

    try {
      const response = await endSession();
      if (response.error) {
        setError(response.error.message ?? "Could not sign out.");
        setPending(false);
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Could not reach the authentication service.");
      setPending(false);
    }
  }

  return (
    <div className="sign-out-control">
      <button
        className="button button-secondary"
        disabled={pending}
        onClick={signOut}
        type="button"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <span className="inline-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

"use client";

import { useClerk } from "@clerk/react";
import { useEffect } from "react";

export function SignOutScreen() {
  const clerk = useClerk();

  useEffect(() => {
    void clerk.signOut({ redirectUrl: "/" });
  }, [clerk]);

  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Signing Out</h1>
        <p>Ending the current Clerk session…</p>
      </section>
    </main>
  );
}

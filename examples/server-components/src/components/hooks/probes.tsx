"use client";
import { useEffect, useState } from "react";
import { Link, useBlocker, useNavigation, usePageState, useRouter } from "@farm.js/core/client";

// One Farm client API each, so a probe that never hydrates names the API that stalls.
function Probe({ name, children }: { name: string; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <p data-testid={`probe-${name}`} data-ready={ready ? "true" : "false"}>
      {children}
    </p>
  );
}

export function RouterProbe() {
  const router = useRouter();
  return <Probe name="router">{`router: ${typeof router.push}`}</Probe>;
}

export function NavigationProbe() {
  const navigation = useNavigation();
  return <Probe name="navigation">{`navigation: ${navigation.pending ? "pending" : "idle"}`}</Probe>;
}

export function PageStateProbe() {
  const state = usePageState<{ panel?: string }>();
  const router = useRouter();
  return (
    <Probe name="page-state">
      <button type="button" onClick={() => router.pushState({ panel: "details" })}>
        {`page state: ${state?.panel ?? "none"}`}
      </button>
    </Probe>
  );
}

export function BlockerProbe() {
  useBlocker({ when: false, message: "Leave?" });
  return <Probe name="blocker">blocker</Probe>;
}

export function LinkProbe() {
  return (
    <Probe name="link">
      <Link href="/">link home</Link>
    </Probe>
  );
}

"use client";

import { loadRemote, preloadRemote } from "@farm.js/federation/client";
import { useEffect, useState, type ComponentType } from "react";

interface UpgradeCardProps {
  workspace: string;
  onUpgrade?: (seats: number) => void;
}

interface UpgradeCardModule {
  default: ComponentType<UpgradeCardProps>;
}

type RemoteState =
  | { status: "loading" }
  | { status: "ready"; Component: ComponentType<UpgradeCardProps> }
  | { status: "error"; message: string };

export function FederatedCheckout() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RemoteState>({ status: "loading" });
  const [confirmation, setConfirmation] = useState<string>();

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void loadRemote<UpgradeCardModule>("checkout/UpgradeCard")
      .then((module) => {
        if (active) setState({ status: "ready", Component: module.default });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          message: remoteFailureMessage(error),
        });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return (
      <div className="remote-state" aria-live="polite" aria-busy="true">
        <span className="loader" aria-hidden="true" />
        <strong>Connecting to checkout</strong>
        <p>Resolving the producer manifest and exposed module.</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="remote-state remote-state--error" role="alert">
        <span className="state-code">REMOTE_UNAVAILABLE</span>
        <strong>Checkout did not load</strong>
        <p>{state.message}</p>
        <button
          type="button"
          onPointerEnter={() => void preloadRemote("checkout").catch(() => undefined)}
          onClick={() => setAttempt((current) => current + 1)}
        >
          Retry connection
        </button>
      </div>
    );
  }

  const RemoteUpgradeCard = state.Component;
  return (
    <div className="remote-result">
      <RemoteUpgradeCard
        workspace="Acme storefront"
        onUpgrade={(seats) => setConfirmation(`Checkout received ${seats} seats from the host.`)}
      />
      <p className="confirmation" aria-live="polite">
        {confirmation ?? "Interaction events can flow back to the host through typed props."}
      </p>
    </div>
  );
}

function remoteFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("Failed to get manifest")) {
    return "The checkout manifest could not be reached. Start the producer or check its public URL and CORS headers.";
  }
  return "The checkout module could not load. Check that the producer and host use compatible exposed modules.";
}

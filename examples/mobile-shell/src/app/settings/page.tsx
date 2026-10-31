import type { Metadata } from "@farm.js/core";
import { Link } from "@farm.js/core/client";
import { HapticsDemo } from "./haptics-demo";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <h1>Settings</h1>
      <div className="card">
        <p>
          Haptics go through <code>native.haptics.impact()</code>. In the shell that is the message
          bridge; in a browser it falls back to <code>navigator.vibrate</code>.
        </p>
        <HapticsDemo />
      </div>
      <div className="actions">
        <Link className="button secondary" href="/settings/about">
          About this spike
        </Link>
      </div>
    </>
  );
}

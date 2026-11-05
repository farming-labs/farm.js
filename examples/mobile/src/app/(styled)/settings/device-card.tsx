"use client";

import { native, type NativeCallError } from "@farm.js/core/native";
import { useEffect, useState } from "react";

type DeviceState =
  | { status: "checking" }
  | { status: "web" }
  | { status: "app"; model: string }
  | { status: "error"; message: string };

/**
 * The app's own Device module (src/native/NativeDevice.ts) called from this web screen.
 * `mobile.modules.Device.web` in farm.config.ts registers it with the Android shell's bridge. In a
 * browser, and in the iOS shell, `available()` is false.
 */
export function DeviceCard() {
  // The server render and the first client render agree; the shell is checked after hydration.
  const [device, setDevice] = useState<DeviceState>({ status: "checking" });
  const [vibrateError, setVibrateError] = useState<string>();

  useEffect(() => {
    if (!native.Device.available()) {
      setDevice({ status: "web" });
      return;
    }
    let current = true;
    native.Device.model().then(
      (model) => current && setDevice({ status: "app", model }),
      (error: NativeCallError) =>
        current && setDevice({ status: "error", message: `${error.code}: ${error.message}` }),
    );
    return () => {
      current = false;
    };
  }, []);

  const label =
    device.status === "app"
      ? device.model
      : device.status === "web"
        ? "not in the app"
        : device.status === "error"
          ? `unavailable (${device.message})`
          : "checking";

  return (
    <section className="card" aria-label="Device">
      <p data-testid="web-device-model">Device: {label}</p>
      {device.status === "app" ? (
        <div className="actions">
          <button
            className="button"
            data-testid="web-vibrate"
            onClick={() => {
              setVibrateError(undefined);
              native.Device.vibrate(200).catch((error: Error) => setVibrateError(error.message));
            }}
            type="button"
          >
            Vibrate
          </button>
        </div>
      ) : null}
      {vibrateError ? <p role="alert">{vibrateError}</p> : null}
    </section>
  );
}

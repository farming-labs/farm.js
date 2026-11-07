"use client";

import { native, type NativeCallError } from "@farm.js/core/native";
import { Image, PhotoPicker } from "@farm.js/ui";
import { useEffect, useState } from "react";

type DeviceState =
  | { status: "checking" }
  | { status: "web" }
  | { status: "app"; model: string; references: boolean }
  | { status: "error"; message: string };

/**
 * The app's own Device module (src/native/NativeDevice.ts) called from this web screen.
 * `mobile.modules.Device.web` in farm.config.ts registers it with the shell's bridge on Android
 * and iOS. In a browser, `available()` is false.
 *
 * On Android the photo comes back by reference: `pickPhoto()` resolves a `/__farm/files/<id>` URL
 * the shell answers from the file, so the photo never crosses the bridge as JSON. The iOS shell
 * cannot answer such URLs yet, so there, and in a browser, the same `PhotoPicker` opens the file
 * picker instead.
 */
export function DeviceCard() {
  // The server render and the first client render agree; the shell is checked after hydration.
  const [device, setDevice] = useState<DeviceState>({ status: "checking" });
  const [vibrateError, setVibrateError] = useState<string>();
  const [photo, setPhoto] = useState<string>();
  const [photoError, setPhotoError] = useState<string>();

  useEffect(() => {
    if (!native.Device.available()) {
      setDevice({ status: "web" });
      return;
    }
    let current = true;
    // The shell's OS, from the attribute its bridge script sets: only Android serves references.
    const references = document.documentElement.getAttribute("data-farm-shell") === "android";
    native.Device.model().then(
      (model) => current && setDevice({ status: "app", model, references }),
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
      {device.status === "checking" ? null : (
        <div className="actions">
          <PhotoPicker
            className="button"
            pick={device.status === "app" && device.references ? native.Device.pickPhoto : undefined}
            onPick={(uri) => {
              setPhotoError(undefined);
              setPhoto(uri);
            }}
            onError={(error) => setPhotoError((error as Error).message)}
          >
            Choose a photo
          </PhotoPicker>
        </div>
      )}
      {photo ? (
        <Image src={photo} alt="The photo you picked" width="100%" radius="card" fit="contain" />
      ) : null}
      {photoError ? <p role="alert">{photoError}</p> : null}
    </section>
  );
}

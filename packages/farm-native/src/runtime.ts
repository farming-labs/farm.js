/**
 * Shared state of the native screens in one React Native runtime, and the shell's navigator
 * module. Internal: screens use the hooks in `@farm.js/native`.
 */
import { createContext } from "react";
import { NativeModules } from "react-native";
import type { FarmRouteParams } from "./routes";

/** What the Android shell passes to every native screen as initial props. */
export interface FarmScreenProps {
  /** The shell's id for this screen, used to address it from JS. */
  screen: number;
  /** The absolute URL the screen shows, such as `https://notes.example.com/notes/7`. */
  url: string;
  /** The page route, such as `/notes/[id]`. */
  route: string;
  /** `mobile.server`, or the dev server under `farm dev --mobile`. */
  server: string;
}

export interface FarmScreenState extends FarmScreenProps {
  params: FarmRouteParams;
  basePath: string;
}

/** The shell's `FarmShell` module (a native module in the generated Android project). */
interface FarmShellModule {
  visit(screen: number, url: string, replace: boolean): void;
  fallback(screen: number, reason: string): void;
  setTitle(screen: number, title: string): void;
  rendered(screen: number): void;
  /** Device session (shells generated with mobile session tokens). */
  session?(): Promise<{ appId: string; accessToken: string | null } | null>;
  refreshSession?(failedToken: string): Promise<string | null>;
  signOut?(): Promise<void>;
  /** Native sign-in (`@farm.js/native/internal`): status and body, never cookies or tokens. */
  signIn?(path: string, body: string): Promise<{ status: number; body: string }>;
}

export const FarmScreenContext = createContext<FarmScreenState | null>(null);

export const farmApp = {
  /** Set by the generated entry before any screen renders. */
  basePath: "",
  /** Set when the first screen mounts; every screen in one app has the same server. */
  server: "",
};

export function farmShell(): FarmShellModule | undefined {
  return (NativeModules as { FarmShell?: FarmShellModule }).FarmShell;
}

---
title: "Auth on Mobile"
description: "How a signed-in web session becomes device tokens that native screens and server-function calls send as bearer tokens."
section: "Runtime"
---

# Auth on Mobile

Part of [Mobile Apps](/docs/mobile): one sign-in on the web screen, tokens everywhere else.

## Auth on mobile

Web screens sign in exactly as they do in a browser: the session cookie lives in the WebView's
cookie store. Native screens send no cookies, so after a sign-in the shell trades that cookie
session for a **device token**, and `serverFetch` sends it as `Authorization: Bearer`. A sign-in
on a native screen puts its session cookie in the same store, so one sign-in, on either kind of
screen, signs in both.
On the server, a request with a valid token runs as the same cookie session, so `auth.user()`,
`auth.session()`, an integration's `protectedRoutes`, API routes, and server functions all see the
signed-in user. Nothing to configure: an app with a `mobile` block and a covered auth integration
gets it.

```tsx
// src/app/notes/page.native.tsx: a protected API route, called from a native screen
const response = await serverFetch("/api/notes"); // 401 only if the user is signed out
```

With `@farm.js/auth`, native screens import `signIn`, `signUp`, `getSession`, `useAuth` and
`signOut` from `@farm.js/auth/client`, the same as web pages. Metro resolves the package's
`react-native` build; web bundles do not change.

```tsx
// src/app/account/page.native.tsx
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { useAuth } from "@farm.js/auth/client";

export default function Account() {
  const { user, isPending, signIn, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  if (isPending) return <Text>Loading</Text>;
  if (user) {
    return (
      <View>
        <Text>{user.email}</Text>
        <Button title="Sign out" onPress={() => void signOut()} />
      </View>
    );
  }
  return (
    <View>
      <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput value={password} onChangeText={setPassword} secureTextEntry />
      <Button
        title="Sign in"
        onPress={async () => {
          const result = await signIn({ email, password });
          setError(result.error?.message);
        }}
      />
      {error ? <Text>{error}</Text> : null}
    </View>
  );
}
```

Every call returns what the web client returns. `signIn` and `signUp` resolve with Better Auth's
`{ data, error }`: the user on success, and the same `error` (such as `INVALID_EMAIL_OR_PASSWORD`
with `status: 401`) for a wrong password or a taken email. They reject when the phone is offline,
as the web client does. On success `useAuth()` has the user before the call resolves. Signed out
(no device token, or one the server refuses) is `{ data: null, error: null }` from `getSession()`
and `user: null` from `useAuth()`. Social and OAuth sign-in need a browser session and reject on
native screens for now; `basePath` applies, `baseURL` does not (native screens always call
`mobile.server`).

### How the token is issued

1. The user signs in, on either kind of screen:
   - **On a web screen**, as in a browser. After the page loads or renders, the shell's native
     code (never the WebView) reads the WebView's cookies for the server.
   - **On a native screen**, `signIn` or `signUp` from `@farm.js/auth/client` hands the route and
     body to the shell. Its native code posts them to `mobile.server` itself: `POST` only, only to
     a route under `auth.basePath`, with no cookies and no `Origin`, and it never follows a
     redirect. A success's session cookie goes into the WebView's cookie store, so web screens
     are signed in too; a refused sign-in keeps no cookie and issues nothing. JS gets back the
     route's status and body, never a cookie.
2. It asks `POST /__farm/mobile/session/challenge` for a one-time nonce, sending those cookies. The
   server answers only if the cookies sign someone in.
3. It sends the nonce to `POST /__farm/mobile/session` with the same cookies, and gets an access
   token (15 minutes) and a refresh token (30 days). The response also sets a `farm_mobile`
   cookie in the WebView that names the device.
4. The shell stores the tokens: Android encrypts them with an AES-GCM key in the Android Keystore
   (only ciphertext is in SharedPreferences); iOS keeps them in the Keychain, readable only on this
   device after first unlock. React Native screens get the access token through the shell; the
   refresh token never reaches JS.
5. On a `401`, `serverFetch` asks the shell to refresh once (`POST /__farm/mobile/session/refresh`)
   and retries the call if its body can be sent twice. Refreshes are serialized in the shell.

Every endpoint takes `POST` only, needs an `X-Farm-Mobile: <mobile.id>` header, and refuses any
request with an `Origin` or `Sec-Fetch-*` header: browsers send those on every `POST` and every
`fetch`, so no web page, the app's own included, can mint, refresh, or use a token. Everything is
sent in headers.

A native sign-in is reachable only from React Native screens: on Android it is a method of the
`FarmShell` React Native module, which runs in the React Native runtime, and WebView pages talk
only to the bridge, which has no session methods. Better Auth checks `Origin` only on a request
that carries cookies, browser fetch metadata, or an `Origin`; the shell's sign-in has none, the
same request any non-browser client can send, so it needs no `Origin` and gains nothing a script
with the password could not do. A browser page posting the same route still sends its own
`Origin`, which Better Auth checks as before. The sign-in body is Better Auth's, the same one web
JS reads: it includes the session token, which is no credential on its own (the session cookie is
signed, and `@farm.js/auth` has no bearer plugin).

### On the server

- Tokens are opaque: a device id, a random secret, and a key. Farm storage
  (`getStorage("farm-mobile")`) keeps a SHA-256 of each secret, never the secret, and the
  device's cookies encrypted with AES-GCM under the key, which exists only inside the tokens.
  Mount persistent storage there for production (`storage.mounts`); with the default in-memory
  storage, tokens end when the server restarts and are not shared between instances.
- A request with a valid access token, the `X-Farm-Mobile` id it was issued to, and no browser
  headers runs with the device's cookies in place of its own, without the token, and with `Origin`
  set to its own origin. Server functions, server actions, and integration routes accept it. Its
  response is `Cache-Control: private, no-store`, and cookie changes in it are kept in the device's
  copy instead of being sent to the phone.
- A bearer on a request with browser headers is ignored: the request keeps today's cookie and
  origin checks, so browser CSRF protection is unchanged.
- Refresh rotates both tokens. A refresh token that comes back after it was rotated revokes the
  device, both tokens.
- Each refresh checks that the cookies behind the device still sign in the same session. A session
  that ended or was replaced ends the device.

### Signing out

- **On a web screen:** a sign-out response from the shell's WebView that leaves no session
  revokes the device on the server and clears the `farm_mobile` cookie; the shell sees it gone
  and deletes its tokens. A sign-out called from a native screen through `serverFetch` revokes the
  device the same way.
- **From a native screen:** `signOut()` from `@farm.js/auth/client` ends the server session
  (`POST /api/auth/sign-out` through `serverFetch`), then forgets the device: it revokes the device
  token (`POST /__farm/mobile/session/revoke`), deletes it from the Keystore or Keychain, and
  clears the server's cookies in the WebView. The device step runs even when the server call fails
  or the phone is offline, and the server's error is still returned or thrown.
- `signOut()` from `@farm.js/native` is the low-level "forget this device" step on its own. It
  does not end the server session; with another auth, such as `@farm.js/better-auth`, call its
  sign-out route with `serverFetch` first.
- A refresh the server refuses also deletes the tokens on the device.

### Covered auth integrations

The server reads sessions through an integration's `session(request)`: who the request's cookies
sign in, as `{ id, userId?, expiresAt? }`, or `null`.

| Integration                      | Mobile tokens                                                      |
| -------------------------------- | ------------------------------------------------------------------ |
| `@farm.js/auth` (`auth: true`)   | Covered                                                            |
| `@farm.js/better-auth`           | Covered, through the instance's `api.getSession`                   |
| Auth0, Auth.js, WorkOS, Supabase | Not yet: they need a `session()` reader (follow-up)                |
| Clerk                            | Not yet: its session cookie is refreshed by Clerk's browser script |
| A custom integration             | Add `session(request)` to it                                       |

Without an integration that reads sessions, the endpoints answer `501` and native screens stay
signed out.

In `farm dev`, `@farm.js/auth` trusts the origin the dev server is serving, so web sign-in works
from the Android emulator's `http://10.0.2.2:<port>` and from a device on the LAN under `--host`
without setting `FARM_AUTH_URL`.

### What this protects against, and what it does not

- **Protects against:** a web page, cross-site or the app's own, minting, refreshing, reading, or
  using a token; a forged or guessed token; a token used with another app id; an expired or revoked
  token; a replayed refresh token; a token outliving a web sign-out or the session it came from;
  a storage dump yielding tokens or session cookies.
- **Does not prove** that a request comes from the app's own binary. Any non-browser client that
  already holds the user's session cookie can mint a token with any app id. That gives it nothing
  the cookie did not, since the token lives only as long as that cookie session. Platform
  attestation (App Attest on iOS, Play Integrity on Android) signing the challenge nonce is the
  follow-up that proves the binary.
- Single use of nonces and refresh tokens is best effort across server instances: Farm storage has
  no atomic compare-and-set.
- The `farm_mobile` cookie names its device. Something that can set that cookie in the WebView,
  with a signed-out session, can revoke that device.

### Limits

- Server components apps in islands mode run Farm's own server and get device tokens like any
  app. Apps on the RSC pipeline (`experimental.serverComponents: true` or `{ mode: "rsc" }`)
  cannot use `auth` or `integrations` yet (the pipeline refuses to start with them), so there is
  no session to trade: their native screens stay signed out, and a bearer never gets past their
  middleware.
- The device keeps the cookies it had when the token was issued, plus the rotations its own
  requests receive. A cookie rotated only in the WebView is not copied; the device keeps working
  while its own cookies sign in the same session.
- Native sign-in is email and password (`signIn`, `signUp`). Social and OAuth sign-in need a
  system browser session (follow-up). iOS has the shell side ready but no React Native screens
  yet, so nothing calls it there.
- Not yet run on a physical device. The iOS shell builds with Xcode in CI; its auth flows
  have not been exercised in the simulator.

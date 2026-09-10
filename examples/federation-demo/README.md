# Farm federation demo

This example contains two independently built Farm applications:

- `remote` publishes `checkout/UpgradeCard` through `mf-manifest.json`.
- `host` loads that browser module after hydration through `@farm.js/federation/client`.

Run both applications in separate terminals:

```bash
pnpm --filter farm-federation-remote-demo dev
pnpm --filter farm-federation-host-demo dev
```

Open `http://localhost:4100`. The producer runs at `http://localhost:4101`.

The producer emits remote declarations. The host keeps declaration consumption disabled so it can
build without the producer running. `federated-checkout.tsx` declares the small module contract
passed to `loadRemote<T>()`. Remove `types: false` from the host when the producer manifest is
reachable during its build and declarations should be consumed automatically.

For a production check, build and start the producer before opening the host:

```bash
pnpm --filter farm-federation-remote-demo build
pnpm --filter farm-federation-host-demo build
pnpm --filter farm-federation-remote-demo start
pnpm --filter farm-federation-host-demo start
```

The producer's broad styles are scoped under `.remote-shell`. CSS loaded with a remote module enters
the host document, so exposed UI should avoid unscoped element and global selectors.

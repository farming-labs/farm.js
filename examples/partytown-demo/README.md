# Farm Partytown demo

This example loads a small analytics SDK with `type="text/partytown"`, forwards its typed `track`
call, and shows the event received by a Farm API route.

```bash
pnpm --filter farm-partytown-demo dev
```

The local SDK keeps the demo deterministic. Replace its script URL with a compatible analytics or
tag-manager SDK in an application.

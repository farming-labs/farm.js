# Farm Scripts demo

This example loads two local browser SDKs through `@farm.js/scripts`:

- analytics is blocked until the application grants an `analytics` consent category;
- support chat is loaded only when the visitor clicks the button.

Both SDKs are accessed through typed handles rather than ambient `window` properties.

```bash
pnpm --filter farm-scripts-demo dev
```

The local files keep the example deterministic. Replace their URLs and TypeScript interfaces with
the values from a real provider's browser SDK documentation.

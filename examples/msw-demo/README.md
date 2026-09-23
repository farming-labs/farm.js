# Farm MSW demo

This example loads one mock handler module in both development SSR and the browser.

```bash
pnpm --filter farm-msw-demo dev
```

The server status passes through a Farm API route, while the browser status is requested directly
after hydration. Both calls ultimately target an intentionally nonexistent API and succeed only
because `@farm.js/msw` starts the correct MSW runtime before each request.

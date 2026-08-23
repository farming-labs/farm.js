# Farm.js StackBlitz Playground

A minimal Farm.js app meant to be opened directly in the browser:

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/farming-labs/farm.js/tree/main/examples/stackblitz?file=src%2Fapp%2Fpage.tsx&title=Farm.js%20Playground)

It shows three things in one page:

- **Server rendering**: the page renders on the server, and the render timestamp proves it.
- **Client islands**: only the counter's JavaScript ships to the browser.
- **Typed server calls**: the guestbook form calls a `createServerFn` mutation through a typed, Zod-validated API route (`src/features/guestbook/server.ts`).

## Notes for contributors

Unlike the other examples, this app installs `@farm.js/core` and `@farm.js/cli` from npm instead of `workspace:*`, because StackBlitz opens the directory standalone and runs a plain `npm install`. It is deliberately excluded from the pnpm workspace in the repo root's `pnpm-workspace.yaml`.

To run it locally:

```bash
cd examples/stackblitz
npm install
npm run dev
```

Keep it small: this is the first Farm.js code many people will ever see.

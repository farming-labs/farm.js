# Follow one order through Farm.js

Get a price from a typed HTTP route, deliver a payment event to a waiting checkout, then approve a refund for the same order. The example uses local run storage and simulated payments.

After installing and building the workspace, run this command from the repository root:

```sh
pnpm --dir examples/agent smoke
```

1. The script starts a Farm server on an available port. It asks for three canvas bags at $12 each and checks the total of 3,600 cents. It also checks that a quantity of zero returns HTTP 400. [Quote endpoint](src/app/api/examples/quote/route.ts)
2. It starts a checkout with a fresh order ID and waits for the run to report `waiting`. It posts `payment.succeeded` with that ID and the quoted amount, then checks the completed run’s output. [Checkout agent](src/agents/checkout.ts)
3. It requests a refund for the same order. The refund agent pauses at `approve-refund`. The script approves it locally and checks the final reply before shutting down the server. [Refund agent](src/agents/refund.ts) · [Requests and assertions](scripts/smoke.mjs)

## Add the Rust packing step

The TypeScript quote calculates the price. The Rust route at `/api/examples/packing` takes the same quantity and tells the warehouse how many four-bag boxes to use. Three bags fit in one box. Five need two. The payment still uses the price from the quote.

Install the Rust target once, then run the complete checkout with Polyroute enabled:

```sh
rustup target add wasm32-wasip2
pnpm --dir examples/agent smoke:polyroute
```

Look for `Rust packing plan: 3 bags in 1 box.` before the payment and approval messages. The checkout pins the Polyroute npm beta as a development dependency. The first Rust build also downloads the guest's Cargo dependencies. The ordinary `smoke` command runs the TypeScript checkout with the Rust route disabled.

To inspect the JSON yourself, run `pnpm --dir examples/agent dev:polyroute` and open `/api/examples/packing?quantity=5` on the server it prints. The response is `{"quantity":5,"bagsPerBox":4,"boxes":2}`. The route accepts a single quantity from 1 to 20 and returns HTTP 405 for other methods. Use `fetch` for the Rust endpoint. Farm can generate client types for the TypeScript quote.

For the Node production path, run `pnpm --dir examples/agent build:polyroute`, then `pnpm --dir examples/agent smoke:polyroute:production`. The second command starts the built server, checks the order, and stops it. The build machine needs Rust. Deploy the whole `.farm/.output` directory, including the compiled Wasm assets. [Rust handler](src/app/api/examples/packing/route.rs) · [Plugin configuration](farm.config.ts)

To inspect the responses yourself, run `pnpm --dir examples/agent dev`, open the URL printed by Farm, and follow the quote links. Changing the quantity in the URL changes the price. The manifest lists the agents at `/api/agent/manifest.json`. The smoke script shows the HTTP requests for starting, reading, and resuming a run.

The script supplies the payment event and the human decision. In a deployed shop, verify the payment provider’s signature, authorize event and approval requests, and use persistent storage appropriate to the host. [Farm agent integration](https://farmjs.dev/docs/integrations/agent)

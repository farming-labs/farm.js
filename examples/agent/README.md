# Follow one order through Farm.js

Get a price from a typed HTTP route, deliver a payment event to a waiting checkout, then approve a refund for the same order. The example uses local run storage and simulated payments.

After installing and building the workspace, run this command from the repository root:

```sh
pnpm --dir examples/agent smoke
```

1. The script starts a Farm server on an available port. It asks for three canvas bags at $12 each and checks the total of 3,600 cents. It also checks that a quantity of zero returns HTTP 400. [Quote endpoint](src/app/api/examples/quote/route.ts)
2. It starts a checkout with a fresh order ID and waits for the run to report `waiting`. It posts `payment.succeeded` with that ID and the quoted amount, then checks the completed run’s output. [Checkout agent](src/agents/checkout.ts)
3. It requests a refund for the same order. The refund agent pauses at `approve-refund`. The script approves it locally and checks the final reply before shutting down the server. [Refund agent](src/agents/refund.ts) · [Requests and assertions](scripts/smoke.mjs)

To inspect the responses yourself, run `pnpm --dir examples/agent dev`, open the URL printed by Farm, and follow the quote links. Changing the quantity in the URL changes the price. The manifest lists the agents at `/api/agent/manifest.json`. The smoke script shows the HTTP requests for starting, reading, and resuming a run.

The script supplies the payment event and the human decision. In a deployed shop, verify the payment provider’s signature, authorize event and approval requests, and use persistent storage appropriate to the host. [Farm agent integration](https://farmjs.dev/docs/integrations/agent)

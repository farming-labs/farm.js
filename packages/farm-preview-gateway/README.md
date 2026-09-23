# @farm.js/preview-gateway

Farm.js preview gateway for Vercel-hosted instant preview URLs

Farm.js is currently in beta.

```bash
npm install @farm.js/preview-gateway@beta
```

See the [Farm.js repository](https://github.com/farming-labs/farm.js) for documentation, examples, and support.

The gateway limits public request bodies and local preview response bodies to 5 MiB by default. Use `maxBodyBytes` and `maxResponseBodyBytes` when creating the handler to set lower or higher limits. Oversized local responses are rejected at upload and the waiting public request receives a `502` response instead of being left pending.

Public disconnects are propagated through the request queue. The polling agent aborts the matching localhost fetch instead of leaving abandoned app work running until its timeout.

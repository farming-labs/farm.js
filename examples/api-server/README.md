# Farm API server demo

A backend-only Farm app: a todo API with no pages, no browser bundle, and no React installed.
`renderer: false` in `farm.config.ts` turns the frontend off; everything else is ordinary Farm.

```bash
pnpm dev
```

## What it shows

- **File routes** under `src/app/api`, served from the root with `api: { basePath: "/" }`:

  ```txt
  src/app/api/route.ts             GET /
  src/app/api/todos/route.ts       GET /todos, POST /todos
  src/app/api/todos/[id]/route.ts  GET, PATCH, DELETE /todos/:id
  ```

- **Validated endpoints** with `createEndpoint` and Zod: invalid bodies and queries get a `400`
  with the failing fields before the handler runs.
- **Typed errors**: `GET /todos/99` answers `404 {"code":"notFound",...}` through the declared
  `notFound` error, which the generated client and the OpenAPI document both know about.
- **Middleware** in `src/app/middleware.ts`: every response gets an `x-request-id`, and writes
  need `Authorization: Bearer demo-token`. The token is intentionally visible and local-only; use
  a real authentication integration in production.
- **JSON everywhere**: a path that matches no route answers `404 {"error":"Not found",...}`.
- **OpenAPI** at `/openapi.json`, and health probes at `/_farm/health/live` and
  `/_farm/health/ready`.

## Try it

```bash
curl http://localhost:3000/todos
```

```bash
curl -X POST http://localhost:3000/todos \
  -H "Authorization: Bearer demo-token" \
  -H "Content-Type: application/json" \
  -d '{"title":"Ship the API"}'
```

```bash
curl -X PATCH http://localhost:3000/todos/2 \
  -H "Authorization: Bearer demo-token" \
  -H "Content-Type: application/json" \
  -d '{"done":true}'
```

```bash
curl "http://localhost:3000/todos?done=true"
```

## Production

```bash
pnpm build
```

```bash
pnpm start
```

`farm build` writes a Node server to `.farm/.output` with no client assets; `farm start` runs it
on `HOST` and `PORT`. Change `--preset` in `package.json` to deploy to Bun, Vercel, Cloudflare,
Netlify, or another target.

The todo store lives in process memory, so it resets on restart and is not shared between server
instances. Use a database or Farm storage in a real app.

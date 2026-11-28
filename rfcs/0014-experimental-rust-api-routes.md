# Experimental Rust, Go, and Python API routes

An app that registers Polyroute in its Vite plugins can put a Rust handler at
`src/app/api/<segment>/route.rs`, a Go handler at `src/app/api/<segment>/route.go`, or a Python
handler at `src/app/api/<segment>/route.py`. The compilers and Fetch adapter belong to Polyroute.
Farm owns URL discovery, middleware, method dispatch, and final SSR asset packaging. Use Vite's
resolved plugin list so discovery follows the active plugin in each build.

Start with Rust on the Node server and the default Polyroute runtime. The guest decides
which HTTP methods it accepts. The TypeScript client generator cannot infer its schemas.
Ordinary apps continue to scan JavaScript and TypeScript routes without installing a compiler.

Go follows the same contract. A Go route is its own module, so only `route.go` is an entry; its
`go.mod` and other `.go` files in that directory are not routes.

Python follows it too. Only `route.py` is an entry; the modules it imports from its directory are
not routes.

Verify opt-in and removal, dev edits, method handling, and an isolated production request for
each language. Keep compiled server code out of the public directory. Provider and other language
support need separate production verification.

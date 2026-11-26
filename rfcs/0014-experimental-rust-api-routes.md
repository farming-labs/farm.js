# Experimental Rust API routes

An app that registers Polyroute in its Vite plugins can put a Rust handler at
`src/app/api/<segment>/route.rs`. The compiler and Fetch adapter belong to Polyroute.
Farm owns URL discovery, middleware, method dispatch, and final SSR asset packaging.
Use Vite's resolved plugin list so discovery follows the active plugin in each build.

Start with Rust on the Node server and the default Polyroute runtime. The guest decides
which HTTP methods it accepts. The TypeScript client generator cannot infer its schemas.
Ordinary apps continue to scan JavaScript and TypeScript routes without installing a compiler.

Verify opt-in and removal, dev edits, method handling, and an isolated production request.
Keep compiled server code out of the public directory. Provider and other language support
need separate production verification.

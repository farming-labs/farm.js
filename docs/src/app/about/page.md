---
title: "About Farm.js"
description: "Farm.js is an open source, MIT-licensed full-stack framework for the web and agents, built by Farming Labs on Vite and Nitro."
---

# About Farm.js

Farm.js is an open source, full-stack framework for the web and agents. Every Farm.js app serves its pages to people and to AI agents: server-rendered HTML, a Markdown copy of each page, and `llms.txt`, on by default. It is built and maintained by [Farming Labs](https://farming-labs.dev).

## What it does

Farm.js is built on [Vite](https://vite.dev) for development and [Nitro](https://nitro.build) for production servers. An app gets typed file routes, API routes with a generated typed client, Server Actions, React Server Components, and streaming server rendering in one project. React is the default renderer, and Preact, Solid, Vue, and Svelte adapters use the same routing and server contracts.

Around that core, Farm.js ships first-party integrations for auth, billing, email, background jobs, storage, and agent runtimes, a docs engine with search and an MCP server, and deployment to Vercel, Cloudflare, Netlify, Firebase, Docker, or any Node server. Apps can turn their server functions into MCP tools that agents call, and run agent runtimes such as Eve or Cloudflare Agents beside the app.

## Who builds it

Farming Labs is the team behind Farm.js. The project started in October 2025 under the [farming-labs](https://github.com/farming-labs) GitHub organization and is maintained by KinfeMichael Tariku ([@KinfishT](https://x.com/KinfishT)), with contributions from the community. Farming Labs also builds the [docs engine](https://github.com/farming-labs/docs) this site runs on and the agent infrastructure described on [/agents](/agents).

## Open source

Farm.js is free to use under the [MIT license](https://github.com/farming-labs/farm.js/blob/main/LICENSE). The source code, issues, and release history are public on [GitHub](https://github.com/farming-labs/farm.js), and the packages are published to npm under the [`@farm.js`](https://www.npmjs.com/org/farm.js) scope.

The first stable release, [Farm.js 0.1.0](/blog/0.1.0), shipped on October 1, 2026. The [stability policy](/docs/stability) says what each release line covers: patch releases keep stable APIs working, and a minor release removes a stable API only after deprecating it first.

## This site

farmjs.dev is a Farm.js app. Its source lives in the [`docs/`](https://github.com/farming-labs/farm.js/tree/main/docs) folder of the repository, next to the framework it documents, so the site is also a working example of the framework. Every page here, including this one, has a Markdown version at the same address with `.md` added.

- [Get started](/docs/getting-started)
- [Read the blog](/blog)
- [Contact the team](/contact)
- [Privacy](/privacy)

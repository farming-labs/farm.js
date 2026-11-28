---
title: "The Farm.js blog"
description: "Releases, engineering notes, and ideas from the people building Farm.js."
---

# The Farm.js blog

Releases, engineering notes, and ideas.

## [Rust and Go API routes are in public beta](/blog/rust-and-go-routes)

Farm now serves route.rs and route.go next to route.ts through the experimental Polyroute plugin. How to try it, how it works, what the numbers say, and what the beta does not do yet.

## [Build durable agents with your framework and Farm Infra](/blog/durable-agents)

Build a refund agent that waits for approval and resumes after a restart. Keep your agent framework and web app, then choose Farm Infra storage, wake-ups, and approvals.

## [Farm.js 0.2 preview. From an API route to a native screen.](/blog/0.2)

What changed since Farm.js 0.1, from backend-only apps and Rust endpoints to React rendering, native screens, and Farm Infra.

## [Build your own renderer, build your own full-stack framework](/blog/bring-your-own-renderer)

A step-by-step guide to plugging any UI library into Farm: a descriptor, three small modules, hooks over Farm's stores, islands, and two ways to use ui-sdk components. Every snippet comes from a working app you can clone, farming-labs/leaf.

## [I asked 105 developer sites for Markdown. A third answered with HTML.](/blog/agent-markdown-scan)

What 105 developer-tool sites send an AI agent that asks for Markdown. A third answer with only HTML, the median docs page is 35 times bigger as HTML, and the frameworks and build tools developers use are furthest behind.

## [How Farm draws a page natively, and when it bails out](/blog/native-internals)

How a `page.tsx` becomes Android views and UIKit with no JavaScript on the phone, the three layers of bailout that fall back to the web page, and why a JSON tree from the server is not the bridge React Native removed.

## [Making your site agent-native](/blog/agent-native)

Agents meet your site in four layers: content they can read, an index that points at it, rules about who may use it, and tools they can call. Most "AI-ready" work stops at the first. What the other three take, with the requests and responses to prove each one.

## [Your web app, native](/blog/web-to-native)

Farm's analyzer reads each page and picks a tier — a native screen with no JavaScript, a React Native screen, or a web screen. How it maps your components and decides.

## [Farm.js v0.1.0: Stable, Integrated, and Agent-Native](/blog/0.1.0)

Farm.js 0.1 is the first release with a compatibility promise. A tour of what shipped: DevTools, the plugin and integration ecosystems, five renderers, a CLI that explains your app, and apps built for agents.

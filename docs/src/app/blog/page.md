---
title: "The Farm.js blog"
description: "Releases, engineering notes, and ideas from the people building Farm.js."
---

# The Farm.js blog

Releases, engineering notes, and ideas.

## [Bring your own renderer](/blog/bring-your-own-renderer)

I wrote a 385-line React-like library to find out what Farm needs from a renderer. The answer is three modules and eleven named exports, plus two fixes it took to get there: a default export nobody documented, and a development entry that loaded React for every renderer.

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

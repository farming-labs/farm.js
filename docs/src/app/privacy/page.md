---
title: "Privacy"
description: "What farmjs.dev collects, where it goes, and how to reach Farming Labs about it: hosting, analytics, the agent-ready check, the waitlist, and Farm.js CLI telemetry."
---

# Privacy

This page describes what farmjs.dev, the Farm.js website and documentation run by [Farming Labs](https://farming-labs.dev), collects when you visit it and when you use its tools. It is written from the site's source code, which is public in the [`docs/`](https://github.com/farming-labs/farm.js/tree/main/docs) folder of the Farm.js repository. Last updated October 24, 2026.

## In short

- You can read the whole site without an account, and the site sets no cookies for visitors.
- The site measures traffic with privacy-focused analytics that use a random identifier in your browser's storage, not a cookie.
- Anything you type into a form (an address to check, an email for the waitlist) is sent only when you submit it.

## Hosting

farmjs.dev is hosted on [Vercel](https://vercel.com). Like any web server, Vercel receives your IP address, your browser's user agent, and the address you request in order to serve each page, and it keeps request logs under its own [privacy policy](https://vercel.com/legal/privacy-policy).

## Analytics

**Databuddy.** The site pages outside `/docs` (the homepage, `/agents`, the blog, and pages like this one) load [Databuddy](https://www.databuddy.cc)'s script from `cdn.databuddy.cc`, which sends events to `basket.databuddy.cc`. It records the page path and title, the referring page, campaign (UTM) parameters, language, time zone, viewport size, time on the page, scroll depth, and page-load performance (Web Vitals). It keeps a random visitor identifier in `localStorage` (`did`) and a session identifier in `sessionStorage` (`did_session`). It sets no cookies.

**Farm.js Infrastructure.** The server reports each request to Farm.js Infrastructure at `app.farmjs.dev`, run by Farming Labs: the matched route pattern rather than the full address, the method, the status code, the response time, and whether the request came from a known AI agent, worked out from the user agent. The user agent itself, your IP address, the full URL, query strings, headers, cookies, and request bodies are not sent.

**Docs engine.** The documentation under `/docs` runs on the Farming Labs [docs engine](https://github.com/farming-labs/docs), which reports usage to `docs.farming-labs.dev`. Each docs page view sends the site address, the page path, the locale, and the docs engine version from your browser, without cookies. The server also reports when the docs search API, Markdown pages, `llms.txt`, or the docs MCP server are used, with the name of the feature or MCP tool. These reports carry no visitor identifier, though like any request, the browser-side report reaches that server with your IP address and user agent.

## Tools and forms

**Agent-ready check.** When you run the check at [/agents/check](/agents/check), the address you enter is sent to Farm.js Infrastructure at `app.farmjs.dev`, which loads public pages of that site (about fifteen requests) and stores the report. A result's link names the site it checked (`/agents/check?url=…`) and runs the check again when someone opens it; those pages are marked so search engines do not index them. Your IP address is passed along so the service can limit how many checks one visitor runs.

**Agent infrastructure waitlist.** The waitlist on [/agents](/agents) stores the email address you submit, the page you signed up from, and the time, in the site's database. Farming Labs uses it to send updates about agent infrastructure and early access. Email [contact@farming-labs.dev](mailto:contact@farming-labs.dev) to be removed.

**Search.** Docs search runs on farmjs.dev itself; your queries go to no other service. The search box keeps your last few selected results in `localStorage` (`fd:omni:recents`) so it can show them again.

**Open in AI.** The docs page menu links to ChatGPT, Claude, Cursor, and other assistants with a prompt that includes the page address. Nothing is sent to them unless you click, and then their own policies apply.

**Agent feedback.** Agents can post feedback about the docs to `/api/docs?feedback=agent` or through the docs MCP server. The site checks the shape of the feedback and does not store it.

The blog shows its author's avatar from `avatars.githubusercontent.com`, and the site's fonts, images, and videos are served from farmjs.dev.

## Farm.js CLI telemetry

farmjs.dev also receives the Farm.js CLI's anonymous usage telemetry and the check-ins that production Farm.js apps send, both described with their exact fields in [Anonymous telemetry](/docs/telemetry). CLI events carry the Farm.js and Node versions, operating system, command, and similar project facts, with an installation identifier that the server hashes before storing it; your IP address and user agent are not stored. Events are deleted after a retention window, 90 days by default. The telemetry page explains how to turn it off with `farm telemetry disable` or the `DO_NOT_TRACK` environment variable.

## Cookies

Visitors get no cookies from farmjs.dev. The only cookie the site sets, `farm_telemetry_dashboard`, is a 12-hour sign-in cookie for the maintainers' telemetry dashboard at `/telemetry`.

## Contact

Questions about this page, or requests about data the site holds about you, go to [contact@farming-labs.dev](mailto:contact@farming-labs.dev). See [Contact](/contact) for other ways to reach the team.

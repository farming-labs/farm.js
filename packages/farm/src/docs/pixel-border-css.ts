export const farmDocsPixelBorderCss = String.raw`
/* Farm docs pixel-border bridge.
 * This follows the local @farming-labs/docs pixel-border theme while covering
 * the frameworkless HTML emitted by the Farm docs runtime.
 */

:root {
  --color-fd-background: #000;
  --color-fd-foreground: oklch(0.985 0.001 106.423);
  --color-fd-card: hsl(0 0% 4%);
  --color-fd-card-foreground: oklch(0.985 0.001 106.423);
  --color-fd-popover: hsl(0 0% 4%);
  --color-fd-popover-foreground: oklch(0.985 0.001 106.423);
  --color-fd-primary: oklch(0.985 0.001 106.423);
  --color-fd-primary-foreground: oklch(0.216 0.006 56.043);
  --color-fd-secondary: hsl(0 0% 8%);
  --color-fd-secondary-foreground: oklch(0.985 0.001 106.423);
  --color-fd-muted: hsl(0 0% 10%);
  --color-fd-muted-foreground: hsl(0 0% 55%);
  --color-fd-accent: hsl(0 0% 10%);
  --color-fd-accent-foreground: oklch(0.985 0.001 106.423);
  --color-fd-border: hsl(0 0% 15%);
  --color-fd-ring: hsl(0 0% 30%);
  --fd-pixel-modal-border: color-mix(
    in srgb,
    var(--color-fd-foreground) 10%,
    transparent
  );
  --fd-pixel-modal-shadow: color-mix(
    in srgb,
    var(--color-fd-foreground) 8%,
    transparent
  );
  --fd-nav-height: 44px;
  --fd-banner-height: 0px;
  --fd-tocnav-height: 0px;
  --scrollbar-thumb: var(--color-fd-border);
  --scrollbar-thumb-hover: var(--color-fd-ring);
  --scrollbar-track: transparent;
  --radius: 0px;
  --font-geist-sans: "Geist Sans";
  --font-geist-mono: "Geist Mono";
}

.dark {
  --color-fd-background: #000 !important;
}

html,
body,
#nd-docs-layout {
  background-color: var(--color-fd-background) !important;
}

@font-face {
  font-family: "Geist Sans";
  font-display: block;
  font-style: normal;
  font-weight: 100 900;
  src:
    local("Geist Sans"),
    url("/assets/Geist-Variable-CrgPqtmy.woff2") format("woff2"),
    url("/node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2") format("woff2");
}

@font-face {
  font-family: "Geist Mono";
  font-display: block;
  font-style: normal;
  font-weight: 100 900;
  src:
    local("Geist Mono"),
    url("/assets/GeistMono-Variable-BNLlm6Cd.woff2") format("woff2"),
    url("/node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2") format("woff2");
}

* {
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  scrollbar-width: thin;
}

html {
  scroll-padding-top: calc(
    var(--fd-nav-height, 56px) + var(--fd-banner-height, 0px) + var(--fd-tocnav-height, 0px) + 24px
  );
}

body {
  overscroll-behavior: none;
}

html[data-farm-docs-sidebar="open"],
html[data-farm-docs-sidebar="open"] body {
  overflow: hidden;
}

code:not(pre code) {
  overflow-wrap: break-word;
  word-break: break-word;
}

#nd-docs-layout,
#nd-docs-layout * {
  border-radius: 0 !important;
}

.topbar {
  grid-column: 2 / -1;
  width: 100%;
}

.topbar-actions,
.mobile-topbar-actions {
  display: flex;
  height: 100%;
  min-width: 0;
  align-items: stretch;
  margin-left: auto;
}

.mobile-topbar {
  display: none;
}

.sidebar-backdrop {
  display: none;
}

.fd-mobile-nav-btn {
  display: inline-flex;
  width: var(--fd-mobile-nav-height, 56px);
  height: 100%;
  flex: 0 0 var(--fd-mobile-nav-height, 56px);
  align-items: center;
  justify-content: center;
  border: 0;
  border-right: 1px solid var(--color-fd-border);
  background: transparent;
  color: var(--color-fd-foreground);
  cursor: pointer;
  padding: 0;
}

.fd-mobile-nav-btn svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.mobile-topbar-link {
  display: inline-flex;
  height: 100%;
  min-width: 0;
  align-items: center;
  color: var(--color-fd-muted-foreground);
  font-family: var(--fd-docs-font-mono);
  font-size: 12px;
  letter-spacing: 0.03em;
  text-decoration: none;
  text-transform: uppercase;
}

.mobile-topbar-link {
  border-left: 1px solid var(--color-fd-border);
  padding: 0 14px;
}

.sidebar-brand {
  justify-content: flex-start;
}

.sidebar-brand > a {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  flex: 0 0 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-brand-logo {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: var(--color-fd-foreground);
}

.sidebar-brand-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-brand-suffix {
  opacity: 0.52;
}

.sidebar-brand > span {
  flex: 0 0 auto;
  margin-left: auto;
}

.fd-docs-search-trigger {
  display: inline-flex;
  width: auto;
  min-width: 46px;
  height: 26px;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  overflow: hidden;
  border: 1px solid var(--color-fd-border);
  background: color-mix(in srgb, var(--color-fd-foreground) 4%, transparent);
  color: var(--color-fd-muted-foreground);
  cursor: pointer;
  padding: 0 5px 0 7px;
  font-family: var(--fd-docs-font-mono);
  font-size: 10px;
  letter-spacing: 0;
  line-height: 1;
  text-transform: uppercase;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease;
  appearance: none;
}

.fd-docs-search-trigger:hover,
.fd-docs-search-trigger:focus-visible,
.fd-docs-search-trigger[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--color-fd-foreground) 28%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 8%, transparent);
  color: var(--color-fd-foreground);
}

.fd-docs-search-trigger:focus-visible {
  outline: 1px solid var(--color-fd-foreground);
  outline-offset: 2px;
}

.fd-docs-search-trigger svg {
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.fd-docs-search-trigger kbd {
  display: inline-flex;
  min-width: 24px;
  min-height: 16px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 1px solid var(--color-fd-border);
  background: var(--color-fd-background);
  padding: 1px 4px;
  color: currentColor;
  font-family: inherit;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1;
}

.topbar-actions .fd-docs-search-trigger,
.mobile-topbar-actions .fd-docs-search-trigger {
  width: auto;
  min-width: 54px;
  height: 100%;
  flex: 0 0 auto;
  border: 0;
  border-left: 1px solid var(--color-fd-border);
  background: transparent;
  padding: 0 12px;
}

.topbar-actions .fd-docs-search-trigger:hover,
.topbar-actions .fd-docs-search-trigger:focus-visible,
.mobile-topbar-actions .fd-docs-search-trigger:hover,
.mobile-topbar-actions .fd-docs-search-trigger:focus-visible {
  background: color-mix(in srgb, var(--color-fd-foreground) 6%, transparent);
}

.fd-toc {
  position: sticky;
  top: var(--fd-docs-row-1);
  grid-area: toc;
  display: flex;
  flex-direction: column;
  width: var(--fd-toc-width);
  height: calc(var(--fd-docs-height) - var(--fd-docs-row-1));
  padding: 3rem 1rem 0.5rem 0;
}

.fd-toc-inner {
  min-width: 0;
}

.fd-toc-title {
  display: inline-flex;
  align-items: center;
  margin: 0 0 1rem;
  color: var(--color-fd-muted-foreground);
  gap: 0.375rem;
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.4;
}

.fd-toc-title svg {
  width: 1rem;
  height: 1rem;
}

.toc-scroll {
  overflow: auto;
  min-height: 0;
  padding: 0.75rem 0;
  scrollbar-width: none;
}

.toc-track {
  position: relative;
}

.toc-thumb {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 1px;
  background: var(--color-fd-primary);
  transition: clip-path 150ms ease;
}

.toc-links {
  display: flex;
  flex-direction: column;
  border-inline-start: 1px solid color-mix(in srgb, var(--color-fd-foreground) 10%, transparent);
}

.toc-link {
  display: block;
  padding: 0.375rem 0 0.375rem 0.75rem;
  color: var(--color-fd-muted-foreground);
  font-size: 0.875rem;
  line-height: 1.45;
  text-decoration: none;
  overflow-wrap: anywhere;
  transition: color 150ms ease;
}

.toc-link:first-child {
  padding-top: 0;
}

.toc-link:last-child {
  padding-bottom: 0;
}

.toc-link[data-depth="3"] {
  padding-left: 1.5rem;
  font-size: 0.8125rem;
}

.toc-link[data-depth="4"],
.toc-link[data-depth="5"],
.toc-link[data-depth="6"] {
  padding-left: 2rem;
  font-size: 0.8125rem;
}

.toc-link[data-active="true"] {
  color: var(--color-fd-primary);
}

.toc-link:hover {
  color: var(--color-fd-accent-foreground);
}

.toc-empty {
  margin: 0;
  color: var(--color-fd-muted-foreground);
  font-size: 0.875rem;
}

.code-block {
  --fd-code-header-bg: color-mix(
    in srgb,
    var(--color-fd-foreground) 5%,
    var(--color-fd-background)
  );
  --fd-code-body-bg: color-mix(in srgb, var(--color-fd-foreground) 8%, var(--color-fd-background));
  width: 100%;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--color-fd-border) !important;
  background: var(--fd-code-body-bg);
  box-shadow: 3px 3px 0 0 var(--color-fd-border) !important;
}

.code-block-header {
  min-height: 28px;
  padding: 3px 7px 3px 9px;
}

.code-block-title {
  font-size: 10px;
  line-height: 1.2;
  text-transform: lowercase;
}

.code-block pre {
  margin: 0;
  max-width: 100%;
  background: var(--fd-code-body-bg);
}

.code-block code {
  border: 0 !important;
  background: transparent !important;
  padding: 0 !important;
}

.fd-breadcrumb {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0;
  margin: 0 0 0.5rem;
  color: var(--color-fd-muted-foreground);
  font-family: var(--fd-font-mono, var(--font-geist-mono, ui-monospace, monospace));
  font-size: 0.75rem;
  letter-spacing: 0.01em;
  line-height: 1.4;
  text-transform: uppercase;
}

.fd-breadcrumb-item {
  display: inline-flex;
  min-width: 0;
  align-items: center;
}

.fd-breadcrumb-link {
  color: inherit;
  font-family: var(--fd-font-mono, var(--font-geist-mono, ui-monospace, monospace));
  text-decoration: none;
}

.fd-breadcrumb-link:hover {
  color: var(--color-fd-foreground);
}

.fd-breadcrumb-parent {
  opacity: 0.6;
  font-weight: 400;
}

.fd-breadcrumb-sep {
  margin: 0 0.375rem;
  opacity: 0.4;
  font-size: 0.75rem;
}

.fd-breadcrumb-current {
  color: var(--color-fd-foreground);
  font-family: var(--fd-font-mono, var(--font-geist-mono, ui-monospace, monospace));
  font-weight: 500;
}

.fd-last-updated-inline,
.fd-last-updated-footer {
  color: var(--color-fd-muted-foreground);
  font-family: var(--fd-docs-font-mono);
  font-size: 0.6875rem;
  line-height: 1.5;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.fd-page-action-btn {
  border-radius: 0 !important;
  box-shadow: 2px 2px 0 0 var(--color-fd-border);
  font-family: var(--fd-docs-font-mono) !important;
  font-size: 0.75rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.fd-page-action-btn .fd-page-action-check-icon {
  display: none;
}

.fd-page-action-btn[data-copied="true"] .fd-page-action-copy-icon {
  display: none;
}

.fd-page-action-btn[data-copied="true"] .fd-page-action-check-icon {
  display: block;
}

@media (max-width: 1020px) {
  :root {
    --fd-mobile-nav-height: 56px;
    --fd-sidebar-edge: 20px;
    --fd-sidebar-guide-x: 58px;
    --fd-sidebar-link-x: 88px;
    --fd-sidebar-sub-guide-x: calc(var(--fd-sidebar-link-x) + 7px);
    --fd-sidebar-sub-link-x: calc(var(--fd-sidebar-sub-guide-x) + 28px);
  }

  html {
    scroll-padding-top: calc(var(--fd-mobile-nav-height, 56px) + 24px);
  }

  body {
    overflow-x: hidden;
  }

  #nd-docs-layout {
    display: block !important;
    min-height: 100dvh;
    border-top: 0;
    padding-top: var(--fd-mobile-nav-height, 56px);
  }

  .mobile-topbar {
    position: fixed;
    inset: 0 0 auto;
    z-index: 80;
    display: flex;
    height: var(--fd-mobile-nav-height, 56px);
    align-items: stretch;
    border-bottom: 1px solid var(--color-fd-border);
    background: color-mix(in srgb, var(--color-fd-background) 94%, transparent);
    backdrop-filter: blur(12px);
  }

  .mobile-topbar a:hover,
  .fd-mobile-nav-btn:hover {
    color: var(--color-fd-foreground);
  }

  .topbar {
    display: none !important;
  }

  .omni-overlay {
    z-index: 100;
  }

  .omni-content {
    z-index: 101;
  }

  .sidebar-backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: block;
    background: color-mix(in srgb, var(--color-fd-background) 72%, transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease;
  }

  #nd-docs-layout[data-sidebar-open="true"] .sidebar-backdrop {
    opacity: 1;
    pointer-events: auto;
  }

  aside#nd-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 90;
    width: min(342px, calc(100vw - 42px));
    height: 100dvh;
    max-height: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-right: 1px solid var(--color-fd-border);
    border-bottom: 0;
    transform: translate3d(-100%, 0, 0);
    transition: transform 180ms ease;
    will-change: transform;
  }

  #nd-docs-layout[data-sidebar-open="true"] aside#nd-sidebar {
    transform: translate3d(0, 0, 0);
  }

  main {
    padding: 34px 20px 64px;
  }

  article#nd-page {
    width: 100%;
    margin: 0;
  }

  #nd-docs-layout .fd-toc {
    display: none !important;
  }

  .prose h1 {
    font-size: 32px;
    letter-spacing: 0;
    line-height: 1.16;
  }

  .code-block {
    margin: 16px 0;
    box-shadow: 2px 2px 0 0 var(--color-fd-border) !important;
  }

  .code-block-header {
    min-height: 26px;
    padding: 2px 6px 2px 8px;
  }

  .code-copy-floating {
    top: 6px;
    right: 6px;
  }

  #nd-docs-layout figure.shiki.code-block pre,
  .code-block pre {
    padding: 12px 11px !important;
    font-size: 12px;
    line-height: 1.5;
  }

  .sh__line {
    min-height: 1.5em;
  }

  .fd-page-nav {
    grid-template-columns: 1fr !important;
  }

  .fd-page-nav-next {
    align-items: flex-start;
    text-align: left;
  }

  .mobile-topbar-actions .fd-docs-search-trigger {
    min-width: 44px;
    padding: 0 14px;
  }

  .mobile-topbar-actions .fd-docs-search-trigger kbd {
    display: none;
  }
}

@media (max-width: 640px) {
  .code-block-header {
    min-height: 22px;
    padding: 1px 4px 1px 7px;
  }

  .code-block-title {
    font-size: 9px;
  }

  .code-copy {
    width: 20px;
    height: 20px;
  }

  .code-copy svg {
    width: 12px;
    height: 12px;
  }

  .code-copy-floating {
    top: 5px;
    right: 5px;
  }

  #nd-docs-layout figure.shiki.code-block pre,
  .code-block pre {
    padding: 10px !important;
    font-size: 11px;
    line-height: 1.55;
  }

  .sh__line {
    min-height: 1.55em;
  }
}

/* Search styling mirrors @farming-labs/theme's shared Omni palette so Farm
 * matches the Next.js and other framework adapters pixel-for-pixel. The CSS
 * stays bundled because production adapters cannot resolve theme files from
 * node_modules at request time. */
/* ═══════════════════════════════════════════════════════════════════
 * Omni Command Palette — core styles
 * Uses fumadocs CSS variables so it auto-adapts to every theme.
 * ═══════════════════════════════════════════════════════════════════ */

@keyframes omni-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes omni-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
@keyframes omni-scale-in {
  from {
    opacity: 0;
    transform: translateX(-50%) scale(0.98) translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) scale(1) translateY(0);
  }
}
@keyframes omni-scale-out {
  from {
    opacity: 1;
    transform: translateX(-50%) scale(1) translateY(0);
  }
  to {
    opacity: 0;
    transform: translateX(-50%) scale(0.98) translateY(-6px);
  }
}

@keyframes omni-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.omni-spin {
  animation: omni-spin 1s linear infinite;
}

.omni-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(2px);
  animation: omni-fade-in 150ms ease-out;
}

.omni-content {
  --omni-content-top: clamp(5rem, 16vh, 7rem);
  position: fixed;
  z-index: 51;
  top: var(--omni-content-top);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  width: min(720px, calc(100% - 1rem));
  border-radius: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--color-fd-border, #d4d4d4) 70%, transparent);
  background: var(--color-fd-popover, #fafafa);
  color: var(--color-fd-popover-foreground, var(--color-fd-foreground, #272727));
  font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text",
      ui-sans-serif, sans-serif);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  outline: none;
  overscroll-behavior: contain;
  animation: omni-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

@media (max-width: 639px) {
  .omni-content {
    --omni-content-top: 1rem;
    top: var(--omni-content-top);
    width: calc(100% - 1rem);
    max-height: calc(100vh - 2rem);
  }
}

/* Header */
.omni-header {
  border-bottom: 1px solid var(--color-fd-border, #262626);
}
.omni-search-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
}
.omni-search-icon {
  color: var(--color-fd-muted-foreground, #a3a3a3);
  flex-shrink: 0;
}
.omni-search-icon svg {
  width: 1.25rem;
  height: 1.25rem;
}
.omni-search-input {
  width: 0;
  flex: 1;
  background: transparent;
  outline: none;
  font-size: 1.125rem;
  line-height: 1.75rem;
  color: var(--color-fd-popover-foreground, var(--color-fd-foreground, #272727));
  border: none;
}
.omni-search-input::placeholder {
  color: var(--color-fd-muted-foreground, #a3a3a3);
}
.omni-kbd {
  border-radius: 0.375rem;
  border: 1px solid var(--color-fd-border, #d4d4d4);
  background: transparent;
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  color: var(--color-fd-muted-foreground, #a3a3a3);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      "Liberation Mono", "Courier New", monospace);
  line-height: 1rem;
}
.omni-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-width: 2.5rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-fd-border, #d4d4d4);
  padding: 0.375rem 0.5rem;
  color: var(--color-fd-muted-foreground, #a3a3a3);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      "Liberation Mono", "Courier New", monospace);
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 500;
  transition:
    background 120ms,
    color 120ms;
  cursor: pointer;
  background: none;
}
.omni-close-btn:hover {
  color: var(--color-fd-accent-foreground, var(--color-fd-foreground, #171717));
  background: var(--color-fd-accent, #e5e5e5);
}
.omni-close-btn svg {
  display: none;
}

/* Body / listbox */
.omni-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: min(540px, calc(100vh - var(--omni-content-top, 7rem) - 8rem));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0.5rem;
}
.omni-body::-webkit-scrollbar {
  width: 6px;
}
.omni-body::-webkit-scrollbar-track {
  background: transparent;
}
.omni-body::-webkit-scrollbar-thumb {
  background: var(--color-fd-muted, #262626);
  border-radius: 3px;
}

/* Loading */
.omni-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0.625rem;
  color: var(--color-fd-muted-foreground, #a3a3a3);
  font-size: 0.875rem;
}

/* Groups */
.omni-group {
  padding: 0;
}
.omni-group-label {
  display: none;
}
.omni-group-items {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

/* Items */
.omni-item {
  position: relative;
  display: block;
  width: 100%;
  flex-shrink: 0;
  border-radius: 0.5rem;
  padding: 0.75rem 0.875rem;
  text-align: left;
  font-size: 0.875rem;
  line-height: 1.25rem;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--color-fd-foreground, #fafafa);
  transition: background 80ms;
}
.omni-item:hover,
.omni-item-active {
  background: var(--color-fd-accent, rgba(209, 209, 209, 0.5));
}
.omni-item-active {
  color: var(--color-fd-accent-foreground, #171717);
}
.omni-item-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.omni-item-icon {
  display: none;
}
.omni-item-active .omni-item-icon {
  color: var(--color-fd-accent-foreground, #fafafa);
}
.omni-item-text {
  min-width: 0;
}
.omni-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-fd-popover-foreground, var(--color-fd-foreground, #272727));
  font-weight: 500;
  line-height: 1.35;
}
.omni-item-subtitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  line-height: 1rem;
  color: var(--color-fd-muted-foreground, #a3a3a3);
  opacity: 1;
}
.omni-item-active .omni-item-subtitle {
  color: var(--color-fd-muted-foreground, #737373);
  opacity: 1;
}
.omni-item-description {
  min-width: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  margin-top: 0.625rem;
  padding-left: 0.75rem;
  border-left: 1px solid color-mix(in srgb, var(--color-fd-border, #d4d4d4) 70%, transparent);
  color: color-mix(in srgb, var(--color-fd-popover-foreground, #272727) 82%, transparent);
  font-size: 0.875rem;
  line-height: 1.5rem;
  font-weight: 400;
}
.omni-item-badge {
  display: none;
}
.omni-item-ext {
  display: none;
}
.omni-item-ext:hover {
  color: var(--color-fd-foreground, #fafafa);
  background: var(--color-fd-muted, #262626);
}
.omni-item-shortcuts {
  display: none;
  align-items: center;
  gap: 0.25rem;
  font-size: 10px;
  color: var(--color-fd-muted-foreground, #a3a3a3);
}
@media (min-width: 640px) {
  .omni-item-shortcuts {
    display: flex;
  }
}
.omni-kbd-sm {
  border-radius: 0.25rem;
  background: var(--color-fd-muted, #262626);
  padding: 0.125rem 0.25rem;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      "Liberation Mono", "Courier New", monospace);
}
.omni-item-chevron {
  display: none;
}
/* Highlight */
.omni-highlight {
  border-radius: 0;
  background: transparent;
  padding: 0;
  color: var(--color-fd-primary, #ca8a04);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Empty states */
.omni-empty-group {
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  color: var(--color-fd-muted-foreground, #a3a3a3);
}
.omni-empty {
  padding: 1.5rem 0.75rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--color-fd-muted-foreground, #a3a3a3);
}
.omni-empty-icon {
  width: 2rem;
  height: 2rem;
  margin: 0 auto 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--color-fd-muted, #262626);
}

/* Footer */
.omni-footer {
  border-top: 1px solid var(--color-fd-border, #262626);
  background: color-mix(in srgb, var(--color-fd-secondary, #f5f5f5) 50%, transparent);
}
.omni-footer-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  font-size: 0.75rem;
  color: var(--color-fd-muted-foreground, #a3a3a3);
}
.omni-footer-hints {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.omni-footer-hint {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  white-space: nowrap;
}
.omni-footer-hint svg {
  box-sizing: border-box;
  width: 1.375rem;
  height: 1.375rem;
  padding: 0.25rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-fd-border, #d4d4d4);
  background: color-mix(in srgb, var(--color-fd-muted, #e5e5e5) 70%, transparent);
  color: var(--color-fd-muted-foreground, #737373);
  flex-shrink: 0;
}
.omni-footer-hint-desktop {
  display: none;
}
.omni-footer-filter {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  white-space: nowrap;
}
@media (min-width: 640px) {
  .omni-footer-hint-desktop {
    display: flex;
  }
}
.omni-filter-label {
  color: var(--color-fd-muted-foreground, #a3a3a3);
}
.omni-filter-value {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-fd-popover-foreground, var(--color-fd-foreground, #272727));
}
.omni-filter-button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 0;
  background: transparent;
  color: var(--color-fd-popover-foreground, var(--color-fd-foreground, #272727));
  font: inherit;
  cursor: pointer;
  padding: 0;
}
.omni-filter-button:hover {
  color: var(--color-fd-accent-foreground, var(--color-fd-foreground, #171717));
}
.omni-filter-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.5rem);
  z-index: 1;
  width: 10rem;
  border: 1px solid var(--color-fd-border, #d4d4d4);
  border-radius: 0.5rem;
  background: var(--color-fd-popover, #fafafa);
  padding: 0.25rem;
  box-shadow: 0 16px 32px -20px rgba(0, 0, 0, 0.45);
}
.omni-filter-option {
  display: flex;
  width: 100%;
  align-items: center;
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--color-fd-popover-foreground, var(--color-fd-foreground, #272727));
  cursor: pointer;
  font: inherit;
  padding: 0.5rem 0.625rem;
  text-align: left;
}
.omni-filter-option:hover,
.omni-filter-option-active {
  background: var(--color-fd-accent, rgba(209, 209, 209, 0.5));
}

/* ─── Omni Command Palette (pixel-border theme) ─────────────────── */

.omni-content {
  border-radius: 0 !important;
  border: 1px solid var(--fd-pixel-modal-border);
  box-shadow:
    2px 2px 0 0 var(--fd-pixel-modal-shadow),
    0 0 0 1px color-mix(in srgb, var(--color-fd-foreground) 3%, transparent);
}

.omni-item {
  border-radius: 0 !important;
}

.omni-kbd,
.omni-kbd-sm {
  border-radius: 0 !important;
  border: 1px solid var(--color-fd-border, hsl(0 0% 15%));
}

.omni-close-btn {
  border-radius: 0 !important;
}

.omni-empty-icon {
  border-radius: 0 !important;
}

.omni-search-input {
  font-family: var(--fd-font-sans, system-ui, -apple-system, sans-serif);
}

.omni-group-label {
  font-family: var(--fd-font-mono, ui-monospace, monospace);
  letter-spacing: 0.08em;
}

.omni-footer-inner {
  font-family: var(--fd-font-mono, ui-monospace, monospace);
}

.omni-footer-hint svg {
  border-radius: 0 !important;
}

.omni-filter-menu,
.omni-filter-option {
  border-radius: 0 !important;
}

.omni-highlight {
  background: color-mix(in srgb, var(--color-fd-primary, #6366f1) 25%, transparent);
  border-radius: 0 !important;
}

/* Farm's frameworkless topbar uses a compact search trigger. */
.topbar-actions .fd-docs-search-trigger {
  width: 56px;
  min-width: 56px;
  justify-content: center;
  padding: 0 10px;
}

.topbar-actions .fd-docs-search-trigger kbd {
  min-width: 36px;
  height: 19px;
  min-height: 19px;
  flex: 0 0 auto;
  gap: 4px;
  border-color: color-mix(in srgb, var(--color-fd-foreground) 14%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 5%, transparent);
  padding: 0 5px;
  font-size: 9px;
}

/* Farm's mobile shell sits above the frameworkless docs canvas. Keep the
 * shared Omni palette above it without changing the cross-framework styling. */
.omni-overlay {
  z-index: 100;
}

.omni-content {
  z-index: 101;
}

@media (max-width: 1023px) {
  .mobile-topbar-actions .fd-docs-search-trigger {
    width: 44px;
    min-width: 44px;
    justify-content: center;
    padding: 0;
  }

  .mobile-topbar-actions .fd-docs-search-trigger kbd {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .omni-overlay,
  .omni-content {
    animation: none;
  }
}
`;

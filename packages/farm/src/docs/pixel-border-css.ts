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
  --color-fd-primary: oklch(0.985 0.001 106.423);
  --color-fd-muted: hsl(0 0% 10%);
  --color-fd-muted-foreground: hsl(0 0% 55%);
  --color-fd-accent-foreground: oklch(0.985 0.001 106.423);
  --color-fd-border: hsl(0 0% 15%);
  --color-fd-ring: hsl(0 0% 30%);
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

.mobile-topbar-brand,
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

.mobile-topbar-brand {
  overflow: hidden;
  padding: 0 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-topbar-link {
  border-left: 1px solid var(--color-fd-border);
  padding: 0 14px;
}

.sidebar-brand {
  justify-content: flex-start;
}

.sidebar-brand > a {
  min-width: 0;
  overflow: hidden;
  flex: 0 0 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Search layout is bundled here because production adapters cannot rely on
 * resolving @farming-labs/theme files from node_modules at request time. */
@keyframes omni-fade-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes omni-scale-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-6px) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}

@keyframes omni-spin {
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
  animation: omni-fade-in 150ms ease-out;
}

.omni-content {
  --omni-content-top: clamp(5rem, 16vh, 7rem);
  position: fixed;
  top: var(--omni-content-top);
  left: 50%;
  display: flex;
  width: min(720px, calc(100% - 1rem));
  max-height: calc(100dvh - var(--omni-content-top) - 1rem);
  transform: translateX(-50%);
  flex-direction: column;
  color: var(--color-fd-foreground);
  outline: none;
  overscroll-behavior: contain;
  animation: omni-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.omni-header {
  border-bottom: 1px solid var(--color-fd-border);
}

.omni-search-row {
  display: flex;
  align-items: center;
}

.omni-search-icon {
  flex-shrink: 0;
}

.omni-search-input {
  width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--color-fd-foreground);
  outline: none;
}

.omni-search-input::placeholder {
  color: var(--color-fd-muted-foreground);
}

.omni-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-fd-border);
  background: none;
  color: var(--color-fd-muted-foreground);
  cursor: pointer;
}

.omni-close-btn svg {
  display: none;
}

.omni-body {
  min-height: 0;
  overflow: auto;
  flex: 1 1 auto;
  overscroll-behavior: contain;
}

.omni-loading {
  display: flex;
  align-items: center;
}

.omni-group {
  padding: 0;
}

.omni-group-items {
  display: flex;
  flex-direction: column;
}

.omni-item {
  position: relative;
  display: block;
  width: 100%;
  flex-shrink: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.omni-item-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.omni-item-icon,
.omni-item-badge,
.omni-item-ext,
.omni-item-chevron {
  display: none;
}

.omni-item-text,
.omni-item-label,
.omni-item-subtitle,
.omni-item-description {
  min-width: 0;
}

.omni-item-label,
.omni-item-subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.omni-item-description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.omni-highlight {
  padding: 0;
}

.omni-empty {
  text-align: center;
}

.omni-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0.5rem;
}

.omni-footer {
  border-top: 1px solid var(--color-fd-border);
}

.omni-footer-inner,
.omni-footer-hints,
.omni-footer-hint,
.omni-footer-filter,
.omni-filter-button,
.omni-filter-option {
  display: flex;
  align-items: center;
}

.omni-footer-inner {
  justify-content: space-between;
}

.omni-footer-hints {
  flex-wrap: wrap;
}

.omni-footer-hint,
.omni-footer-filter {
  white-space: nowrap;
}

.omni-footer-filter {
  position: relative;
  margin-left: auto;
}

.omni-filter-button,
.omni-filter-option {
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.omni-filter-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.5rem);
  z-index: 1;
  border: 1px solid var(--color-fd-border);
}

.omni-filter-option {
  width: 100%;
  background: transparent;
  text-align: left;
}

/* Docs command search */
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

.omni-overlay {
  z-index: 100;
  background: color-mix(in srgb, var(--color-fd-background) 68%, transparent);
  backdrop-filter: blur(8px);
}

.omni-content {
  --omni-content-top: clamp(72px, 13vh, 104px);
  z-index: 101;
  width: min(720px, calc(100vw - 32px));
  max-height: min(680px, calc(100dvh - var(--omni-content-top) - 24px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-fd-foreground) 20%, transparent);
  background: color-mix(in srgb, var(--color-fd-background) 93%, var(--color-fd-card));
  box-shadow:
    4px 4px 0 color-mix(in srgb, var(--color-fd-foreground) 11%, transparent),
    0 28px 88px color-mix(in srgb, #000 58%, transparent);
  font-family: var(--fd-docs-font-sans);
}

.omni-header {
  flex: 0 0 auto;
  padding: 8px;
  border-bottom-color: color-mix(in srgb, var(--color-fd-foreground) 12%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 1.5%, transparent);
}

.omni-search-row {
  min-height: 50px;
  gap: 10px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--color-fd-foreground) 11%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 3%, transparent);
}

.omni-search-icon {
  display: inline-flex;
  color: color-mix(in srgb, var(--color-fd-foreground) 62%, transparent);
}

.omni-search-icon svg {
  width: 18px;
  height: 18px;
  stroke-width: 1.6;
}

.omni-search-input {
  min-width: 0;
  width: 100%;
  padding: 0;
  font-family: var(--fd-docs-font-sans);
  font-size: 15px;
  line-height: 1.4;
  letter-spacing: -0.01em;
}

.omni-close-btn {
  min-width: 40px;
  height: 24px;
  flex: 0 0 auto;
  border-color: color-mix(in srgb, var(--color-fd-foreground) 13%, transparent);
  background: var(--color-fd-background);
  padding: 0 7px;
  font-family: var(--fd-docs-font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.omni-close-btn:hover,
.omni-close-btn:focus-visible {
  border-color: color-mix(in srgb, var(--color-fd-foreground) 28%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 9%, transparent);
  color: var(--color-fd-foreground);
}

.omni-close-btn:focus-visible,
.omni-item:focus-visible,
.omni-filter-button:focus-visible,
.omni-filter-option:focus-visible {
  outline: 1px solid var(--color-fd-foreground);
  outline-offset: 1px;
}

.omni-body {
  min-height: 184px;
  max-height: none;
  padding: 10px;
  background: color-mix(in srgb, var(--color-fd-background) 97%, var(--color-fd-card));
  scrollbar-gutter: stable;
}

.omni-group + .omni-group {
  margin-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--color-fd-foreground) 8%, transparent);
  padding-top: 8px;
}

.omni-group-label {
  display: block;
  padding: 2px 8px 8px;
  color: color-mix(in srgb, var(--color-fd-foreground) 45%, transparent);
  font-family: var(--fd-docs-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  line-height: 1rem;
  text-transform: uppercase;
}

.omni-group-items {
  gap: 4px;
}

.omni-item {
  min-height: 62px;
  border: 1px solid transparent;
  border-left-width: 2px;
  padding: 10px 12px;
  color: var(--color-fd-foreground);
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    transform 120ms ease;
}

.omni-item:hover,
.omni-item-active {
  border-left-color: color-mix(in srgb, var(--color-fd-foreground) 72%, transparent);
  border-top-color: color-mix(in srgb, var(--color-fd-foreground) 9%, transparent);
  border-right-color: color-mix(in srgb, var(--color-fd-foreground) 9%, transparent);
  border-bottom-color: color-mix(in srgb, var(--color-fd-foreground) 9%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 7.5%, transparent);
  color: var(--color-fd-foreground);
}

.omni-item:active {
  transform: translateY(1px);
}

.omni-item-subtitle {
  margin-bottom: 4px;
  color: color-mix(in srgb, var(--color-fd-foreground) 44%, transparent);
  font-family: var(--fd-docs-font-mono);
  font-size: 10px;
  line-height: 1.4;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.omni-item-active .omni-item-subtitle {
  color: color-mix(in srgb, var(--color-fd-foreground) 58%, transparent);
}

.omni-item-label {
  color: var(--color-fd-foreground);
  font-family: var(--fd-docs-font-sans);
  font-size: 14px;
  font-weight: 560;
  line-height: 1.4;
  letter-spacing: -0.01em;
}

.omni-item-description {
  -webkit-line-clamp: 2;
  margin-top: 5px;
  border-left: 0;
  padding-left: 0;
  color: color-mix(in srgb, var(--color-fd-foreground) 55%, transparent);
  font-family: var(--fd-docs-font-sans);
  font-size: 12.5px;
  line-height: 1.5;
}

.omni-highlight {
  background: color-mix(in srgb, var(--color-fd-foreground) 12%, transparent);
  color: var(--color-fd-foreground);
  text-decoration: none;
}

.omni-loading,
.omni-empty {
  min-height: 184px;
  align-items: center;
  justify-content: center;
}

.omni-loading {
  padding: 24px;
}

.omni-empty {
  display: flex;
  flex-direction: column;
  padding: 32px 24px;
  color: color-mix(in srgb, var(--color-fd-foreground) 52%, transparent);
  font-family: var(--fd-docs-font-sans);
  font-size: 13px;
  line-height: 1.5;
}

.omni-empty-icon {
  width: 34px;
  height: 34px;
  margin-bottom: 12px;
  border: 1px solid color-mix(in srgb, var(--color-fd-foreground) 12%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 3%, transparent);
  color: color-mix(in srgb, var(--color-fd-foreground) 56%, transparent);
}

.omni-footer {
  flex: 0 0 auto;
  border-top-color: color-mix(in srgb, var(--color-fd-foreground) 10%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 1.5%, transparent);
}

.omni-footer-inner {
  min-height: 42px;
  gap: 12px;
  padding: 0 14px;
  color: color-mix(in srgb, var(--color-fd-foreground) 46%, transparent);
  font-size: 10px;
  letter-spacing: 0.025em;
}

.omni-footer-hints {
  gap: 12px;
}

.omni-footer-hint svg {
  width: 18px;
  height: 18px;
  border-color: color-mix(in srgb, var(--color-fd-foreground) 12%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 3%, transparent);
  padding: 3px;
}

.omni-filter-button {
  min-height: 24px;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--color-fd-foreground) 12%, transparent);
  background: var(--color-fd-background);
  padding: 0 7px;
}

.omni-filter-button:hover {
  border-color: color-mix(in srgb, var(--color-fd-foreground) 24%, transparent);
  background: color-mix(in srgb, var(--color-fd-foreground) 8%, transparent);
  color: var(--color-fd-foreground);
}

.omni-filter-menu {
  width: 148px;
  border-color: color-mix(in srgb, var(--color-fd-foreground) 16%, transparent);
  background: var(--color-fd-background);
  padding: 4px;
  box-shadow: 4px 4px 0 color-mix(in srgb, var(--color-fd-foreground) 10%, transparent);
}

.omni-filter-option {
  min-height: 30px;
  padding: 0 8px;
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

@media (max-width: 639px) {
  .omni-content {
    --omni-content-top: calc(
      var(--fd-mobile-nav-height, 56px) + max(10px, env(safe-area-inset-top))
    );
    top: var(--omni-content-top);
    width: calc(100vw - 16px);
    max-height: calc(100dvh - var(--omni-content-top) - max(10px, env(safe-area-inset-bottom)));
    box-shadow:
      3px 3px 0 color-mix(in srgb, var(--color-fd-foreground) 10%, transparent),
      0 18px 56px color-mix(in srgb, #000 42%, transparent);
  }

  .omni-header {
    padding: 6px;
  }

  .omni-search-row {
    min-height: 48px;
    gap: 8px;
    padding: 0 11px;
  }

  .omni-search-input {
    font-size: 16px;
  }

  .omni-close-btn {
    width: 44px;
    min-width: 44px;
    height: 36px;
    padding: 0;
    font-size: 9px;
  }

  .omni-body {
    min-height: 148px;
    padding: 6px;
  }

  .omni-group-label {
    padding: 7px 7px 5px;
  }

  .omni-item {
    min-height: 56px;
    padding: 9px 10px;
  }

  .omni-item-description {
    font-size: 11px;
  }

  .omni-loading,
  .omni-empty {
    min-height: 148px;
  }

  .omni-footer-inner {
    min-height: 40px;
    justify-content: flex-end;
    padding: 0 8px;
  }

  .omni-footer-hints {
    display: none;
  }

  .omni-filter-button {
    min-height: 32px;
    padding: 0 9px;
  }

  .omni-filter-option {
    min-height: 36px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .omni-overlay,
  .omni-content {
    animation: none;
  }

  .omni-item {
    transition: none;
  }
}
`;

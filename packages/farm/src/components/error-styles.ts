/**
 * Shared styles for Farm's default HTTP error page.
 *
 * Kept framework-agnostic so the same fallback can be used by the development
 * renderer and generated production runtimes.
 */
export const DEFAULT_ERROR_STYLES = `
body {
  margin: 0;
  background: #080808;
}

.farm-default-error {
  --farm-error-bg: #080808;
  --farm-error-panel: #0d0d0d;
  --farm-error-fg: #f3f3f3;
  --farm-error-muted: #9a9a9a;
  --farm-error-subtle: #6f6f6f;
  --farm-error-line: rgba(255, 255, 255, 0.1);
  --farm-error-line-strong: rgba(255, 255, 255, 0.2);
  --farm-error-button-bg: #f1f1f1;
  --farm-error-button-fg: #0a0a0a;
  --farm-error-source-line: rgba(255, 255, 255, 0.055);
  --farm-error-source-marker: #f3f3f3;
  --farm-error-font-sans: "Geist Variable", "Geist Sans", Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --farm-error-font-mono: "Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  color: var(--farm-error-fg);
  background: var(--farm-error-bg);
  font-family: var(--farm-error-font-sans);
  font-synthesis: none;
  color-scheme: dark;
  text-rendering: optimizeLegibility;
}

.farm-default-error,
.farm-default-error * {
  box-sizing: border-box;
}

.farm-default-error__frame {
  width: min(100%, 1180px);
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  margin: 0 auto;
  padding: clamp(24px, 4vw, 52px);
}

.farm-default-error__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--farm-error-muted);
  font-family: var(--farm-error-font-mono);
  font-size: 11px;
  font-weight: 520;
  line-height: 1;
  letter-spacing: 0.08em;
}

.farm-default-error__brand > span:first-child {
  color: var(--farm-error-fg);
}

.farm-default-error__brand-divider,
.farm-default-error__status-divider,
.farm-default-error__footer-divider {
  color: var(--farm-error-subtle);
}

.farm-default-error__content {
  width: min(100%, 680px);
  min-width: 0;
  align-self: center;
  margin: 0 auto;
  padding: clamp(64px, 10vh, 112px) 0;
}

.farm-default-error--development .farm-default-error__content {
  width: min(100%, 900px);
}

.farm-default-error > .farm-default-error__content {
  align-self: center;
  padding-right: 24px;
  padding-left: 24px;
}

.farm-default-error__status,
.farm-default-error__eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 24px;
  color: var(--farm-error-muted);
  font-family: var(--farm-error-font-mono);
  font-size: 12px;
  font-weight: 520;
  line-height: 1.4;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}

.farm-default-error__status-mark {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  background: var(--farm-error-fg);
}

.farm-default-error__code {
  margin: 0 0 18px;
  color: var(--farm-error-fg);
  font-family: var(--farm-error-font-mono);
  font-size: clamp(48px, 8vw, 72px);
  font-weight: 540;
  line-height: 0.95;
  letter-spacing: -0.055em;
}

.farm-default-error__summary {
  margin: 0;
}

.farm-default-error__title {
  max-width: 680px;
  margin: 0;
  color: var(--farm-error-fg);
  font-family: var(--farm-error-font-sans);
  font-size: clamp(36px, 5.2vw, 56px);
  font-weight: 560;
  line-height: 1.04;
  letter-spacing: -0.052em;
  text-wrap: balance;
}

.farm-default-error__message {
  max-width: 590px;
  margin: 18px 0 0;
  color: var(--farm-error-muted);
  font-family: var(--farm-error-font-sans);
  font-size: clamp(16px, 2vw, 19px);
  line-height: 1.55;
  letter-spacing: -0.012em;
  overflow-wrap: anywhere;
}

.farm-default-error__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 30px;
}

.farm-default-error__action {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 17px;
  border: 1px solid var(--farm-error-line-strong);
  border-radius: 7px;
  color: var(--farm-error-fg);
  background: transparent;
  font: inherit;
  font-family: var(--farm-error-font-mono);
  font-size: 13px;
  font-weight: 560;
  line-height: 1;
  letter-spacing: 0.015em;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, transform 100ms ease-out;
}

.farm-default-error__action--primary {
  border-color: var(--farm-error-button-bg);
  color: var(--farm-error-button-fg);
  background: var(--farm-error-button-bg);
}

.farm-default-error__panel {
  margin-top: 42px;
  border-top: 1px solid var(--farm-error-line-strong);
}

.farm-default-error__row {
  min-height: 45px;
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  border-bottom: 1px solid var(--farm-error-line);
}

.farm-default-error__label,
.farm-default-error__value,
.farm-default-error__details-title,
.farm-default-error__source-path,
.farm-default-error__meta,
.farm-default-error__footer-action {
  font-family: var(--farm-error-font-mono);
}

.farm-default-error__label {
  color: var(--farm-error-subtle);
  font-size: 10px;
  font-weight: 560;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.farm-default-error__value {
  min-width: 0;
  padding: 11px 0;
  color: var(--farm-error-muted);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.farm-default-error__details {
  padding: 24px 0 0;
  border-bottom: 1px solid var(--farm-error-line);
}

.farm-default-error__details-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.farm-default-error__details-title {
  margin: 0;
  color: var(--farm-error-muted);
  font-size: 10px;
  font-weight: 560;
  line-height: 1;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.farm-default-error__copy {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border: 1px solid var(--farm-error-line);
  border-radius: 6px;
  color: var(--farm-error-muted);
  background: transparent;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
}

.farm-default-error__source {
  overflow: hidden;
  border: 1px solid var(--farm-error-line);
  border-radius: 7px;
  background: var(--farm-error-panel);
}

.farm-default-error__source-path {
  margin: 0;
  padding: 10px 13px;
  border-bottom: 1px solid var(--farm-error-line);
  color: var(--farm-error-muted);
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.farm-default-error__source-code {
  margin: 0;
  padding: 8px 0;
  overflow-x: auto;
  color: var(--farm-error-fg);
  font-family: var(--farm-error-font-mono);
  font-size: 12px;
  line-height: 1.75;
  tab-size: 2;
}

.farm-default-error__source-line {
  min-width: max-content;
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  padding: 0 14px 0 0;
  border-left: 1px solid transparent;
}

.farm-default-error__source-line--active {
  border-left-color: var(--farm-error-source-marker);
  background: var(--farm-error-source-line);
}

.farm-default-error__source-gutter {
  padding-right: 14px;
  color: var(--farm-error-subtle);
  text-align: right;
  user-select: none;
}

.farm-default-error__source-line--active .farm-default-error__source-gutter {
  color: var(--farm-error-source-marker);
}

.farm-default-error__source-text {
  white-space: pre;
}

.farm-default-error__details-empty {
  margin: 0;
  padding: 14px;
  border: 1px solid var(--farm-error-line);
  border-radius: 7px;
  color: var(--farm-error-muted);
  background: var(--farm-error-panel);
  font-family: var(--farm-error-font-mono);
  font-size: 12px;
  line-height: 1.5;
}

.farm-default-error__meta {
  margin: 12px 0 20px;
  color: var(--farm-error-subtle);
  font-size: 10px;
  line-height: 1.5;
  letter-spacing: 0.035em;
}

.farm-default-error__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding-top: 24px;
}

.farm-default-error__footer-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  color: var(--farm-error-muted);
  background: transparent;
  font-size: 10px;
  font-weight: 540;
  line-height: 1.4;
  letter-spacing: 0.065em;
  text-decoration: none;
  cursor: pointer;
  transition: color 150ms ease-out;
}

.farm-default-error__docs-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  stroke: currentColor;
  stroke-width: 1.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.farm-default-error__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (hover: hover) and (pointer: fine) {
  .farm-default-error__action:hover {
    border-color: var(--farm-error-fg);
    background: var(--farm-error-source-line);
  }

  .farm-default-error__action--primary:hover {
    border-color: var(--farm-error-muted);
    background: var(--farm-error-muted);
  }

  .farm-default-error__copy:hover {
    border-color: var(--farm-error-line-strong);
    color: var(--farm-error-fg);
    background: var(--farm-error-source-line);
  }

  .farm-default-error__footer-action:hover {
    color: var(--farm-error-fg);
  }
}

.farm-default-error__copy:active,
.farm-default-error__action:active {
  transform: translateY(1px);
}

.farm-default-error__copy:focus-visible,
.farm-default-error__action:focus-visible,
.farm-default-error__footer-action:focus-visible {
  outline: 2px solid var(--farm-error-fg);
  outline-offset: 3px;
}

@media (max-width: 620px) {
  .farm-default-error__frame {
    padding: 22px 18px 26px;
  }

  .farm-default-error__content {
    padding: 56px 0 68px;
  }

  .farm-default-error > .farm-default-error__content {
    padding: 48px 18px;
  }

  .farm-default-error__title {
    font-size: clamp(34px, 11vw, 44px);
  }

  .farm-default-error__message {
    margin-top: 15px;
  }

  .farm-default-error__actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .farm-default-error__action {
    width: 100%;
  }

  .farm-default-error__row {
    grid-template-columns: 1fr;
    gap: 2px;
    padding: 11px 0;
  }

  .farm-default-error__value {
    padding: 0;
  }

  .farm-default-error__details-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .farm-default-error__copy {
    width: 100%;
  }

  .farm-default-error__source-line {
    grid-template-columns: 54px minmax(0, 1fr);
  }
}

@media (prefers-color-scheme: light) {
  .farm-default-error {
    --farm-error-bg: #f7f7f5;
    --farm-error-panel: #ffffff;
    --farm-error-fg: #141414;
    --farm-error-muted: #666666;
    --farm-error-subtle: #8a8a8a;
    --farm-error-line: rgba(0, 0, 0, 0.1);
    --farm-error-line-strong: rgba(0, 0, 0, 0.19);
    --farm-error-button-bg: #141414;
    --farm-error-button-fg: #ffffff;
    --farm-error-source-line: rgba(0, 0, 0, 0.045);
    --farm-error-source-marker: #141414;
    color-scheme: light;
  }
}

.dark .farm-default-error,
[data-theme="dark"] .farm-default-error,
[data-color-scheme="dark"] .farm-default-error {
  --farm-error-bg: #080808;
  --farm-error-panel: #0d0d0d;
  --farm-error-fg: #f3f3f3;
  --farm-error-muted: #9a9a9a;
  --farm-error-subtle: #6f6f6f;
  --farm-error-line: rgba(255, 255, 255, 0.1);
  --farm-error-line-strong: rgba(255, 255, 255, 0.2);
  --farm-error-button-bg: #f1f1f1;
  --farm-error-button-fg: #0a0a0a;
  --farm-error-source-line: rgba(255, 255, 255, 0.055);
  --farm-error-source-marker: #f3f3f3;
  color-scheme: dark;
}

.light .farm-default-error,
[data-theme="light"] .farm-default-error,
[data-color-scheme="light"] .farm-default-error {
  --farm-error-bg: #f7f7f5;
  --farm-error-panel: #ffffff;
  --farm-error-fg: #141414;
  --farm-error-muted: #666666;
  --farm-error-subtle: #8a8a8a;
  --farm-error-line: rgba(0, 0, 0, 0.1);
  --farm-error-line-strong: rgba(0, 0, 0, 0.19);
  --farm-error-button-bg: #141414;
  --farm-error-button-fg: #ffffff;
  --farm-error-source-line: rgba(0, 0, 0, 0.045);
  --farm-error-source-marker: #141414;
  color-scheme: light;
}

@media (prefers-reduced-motion: reduce) {
  .farm-default-error__copy,
  .farm-default-error__action,
  .farm-default-error__footer-action {
    transition: none;
  }

  .farm-default-error__copy:active,
  .farm-default-error__action:active {
    transform: none;
  }
}
`;

/**
 * Shared styles for Farm's default HTTP error page.
 *
 * Kept framework-agnostic so the same fallback can be used by the development
 * renderer and generated production runtimes.
 */
export const DEFAULT_ERROR_STYLES = `
body {
  margin: 0;
}

.farm-default-error {
  --farm-error-bg: #fafafa;
  --farm-error-fg: #171717;
  --farm-error-muted: #737373;
  --farm-error-line: rgba(0, 0, 0, 0.1);
  --farm-error-line-strong: rgba(0, 0, 0, 0.22);
  --farm-error-panel: rgba(0, 0, 0, 0.018);
  --farm-error-button-fg: #ffffff;
  --farm-error-source-line: rgba(185, 28, 28, 0.08);
  --farm-error-source-marker: #b91c1c;
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: clamp(28px, 6vw, 72px) 24px;
  color: var(--farm-error-fg);
  background: var(--farm-error-bg);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color-scheme: light;
}

.farm-default-error,
.farm-default-error * {
  box-sizing: border-box;
}

.farm-default-error__content {
  width: min(100%, 840px);
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.farm-default-error__code {
  margin: 0;
  color: var(--farm-error-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: clamp(76px, 13vw, 112px);
  font-weight: 800;
  line-height: 0.78;
  letter-spacing: -0.08em;
  text-align: center;
  transform: translateX(-3px);
}

@supports (-webkit-text-stroke: 1px currentColor) {
  .farm-default-error__code {
    color: var(--farm-error-bg);
    -webkit-text-stroke: 1.5px var(--farm-error-fg);
    text-shadow: 2px 2px 0 var(--farm-error-fg);
  }
}

.farm-default-error__eyebrow {
  width: min(100%, 590px);
  display: flex;
  align-items: center;
  align-self: center;
  gap: 16px;
  margin: 34px 0 28px;
  color: var(--farm-error-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  white-space: nowrap;
}

.farm-default-error__eyebrow::before,
.farm-default-error__eyebrow::after {
  content: "";
  height: 1px;
  flex: 1 1 auto;
  background: var(--farm-error-line-strong);
}

.farm-default-error__summary {
  margin-bottom: 28px;
  text-align: center;
}

.farm-default-error__title {
  margin: 0;
  font-size: clamp(20px, 3vw, 26px);
  font-weight: 540;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.farm-default-error__message {
  max-width: 680px;
  margin: 8px auto 0;
  color: var(--farm-error-muted);
  font-size: 15px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.farm-default-error__panel {
  border: 1px solid var(--farm-error-line-strong);
  background: var(--farm-error-panel);
}

.farm-default-error__row {
  min-height: 58px;
  display: grid;
  grid-template-columns: minmax(124px, 180px) minmax(0, 1fr);
  align-items: center;
  border-bottom: 1px solid var(--farm-error-line);
}

.farm-default-error__row:last-child {
  border-bottom: 0;
}

.farm-default-error__label,
.farm-default-error__value,
.farm-default-error__details-title,
.farm-default-error__source-path,
.farm-default-error__meta {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.farm-default-error__label {
  padding: 0 22px;
  color: var(--farm-error-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.farm-default-error__value {
  min-width: 0;
  padding: 15px 22px;
  color: var(--farm-error-fg);
  font-size: 14px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.farm-default-error__details {
  padding: 20px 22px 18px;
}

.farm-default-error__details-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.farm-default-error__details-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.farm-default-error__copy {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border: 1px solid var(--farm-error-line);
  border-radius: 0;
  color: var(--farm-error-fg);
  background: transparent;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: border-color 150ms ease-out, background 150ms ease-out;
}

.farm-default-error__source {
  border: 1px solid var(--farm-error-line);
  background: var(--farm-error-bg);
  overflow: hidden;
}

.farm-default-error__source-path {
  margin: 0;
  padding: 11px 14px;
  border-bottom: 1px solid var(--farm-error-line);
  color: var(--farm-error-fg);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.farm-default-error__source-code {
  margin: 0;
  padding: 8px 0;
  overflow-x: auto;
  color: var(--farm-error-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
  color: var(--farm-error-muted);
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
  padding: 15px;
  border: 1px solid var(--farm-error-line);
  color: var(--farm-error-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.farm-default-error__meta {
  margin: 14px 0 0;
  color: var(--farm-error-muted);
  font-size: 10px;
  line-height: 1.5;
  letter-spacing: 0.04em;
  text-align: center;
}

.farm-default-error__actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

.farm-default-error__action {
  min-width: 152px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  border: 1px solid var(--farm-error-line-strong);
  border-radius: 0;
  color: var(--farm-error-fg);
  background: transparent;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  text-decoration: none;
  cursor: pointer;
  transition: opacity 150ms ease-out, transform 100ms ease-out;
}

.farm-default-error__action--primary {
  border-color: var(--farm-error-fg);
  color: var(--farm-error-button-fg);
  background: var(--farm-error-fg);
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
  .farm-default-error__copy:hover {
    border-color: var(--farm-error-line-strong);
    background: var(--farm-error-panel);
  }

  .farm-default-error__action:hover {
    opacity: 0.76;
  }
}

.farm-default-error__copy:active,
.farm-default-error__action:active {
  transform: translateY(1px);
}

.farm-default-error__copy:focus-visible,
.farm-default-error__action:focus-visible {
  outline: 1px solid var(--farm-error-fg);
  outline-offset: 2px;
}

@media (max-width: 620px) {
  .farm-default-error {
    place-items: start center;
    padding: 48px 16px 32px;
  }

  .farm-default-error__eyebrow {
    margin-top: 28px;
  }

  .farm-default-error__row {
    grid-template-columns: 1fr;
    gap: 5px;
    padding: 14px 16px;
  }

  .farm-default-error__label,
  .farm-default-error__value {
    padding: 0;
  }

  .farm-default-error__details {
    padding: 16px;
  }

  .farm-default-error__details-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .farm-default-error__copy {
    width: 100%;
  }

  .farm-default-error__source-line {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .farm-default-error__actions {
    flex-direction: column;
  }

  .farm-default-error__action {
    width: 100%;
  }
}

@media (prefers-color-scheme: dark) {
  .farm-default-error {
    --farm-error-bg: #0a0a0a;
    --farm-error-fg: #ededed;
    --farm-error-muted: #a1a1a1;
    --farm-error-line: rgba(255, 255, 255, 0.1);
    --farm-error-line-strong: rgba(255, 255, 255, 0.22);
    --farm-error-panel: rgba(255, 255, 255, 0.018);
    --farm-error-button-fg: #0a0a0a;
    --farm-error-source-line: rgba(248, 113, 113, 0.12);
    --farm-error-source-marker: #f87171;
    color-scheme: dark;
  }
}

.dark .farm-default-error,
[data-theme="dark"] .farm-default-error,
[data-color-scheme="dark"] .farm-default-error {
  --farm-error-bg: #0a0a0a;
  --farm-error-fg: #ededed;
  --farm-error-muted: #a1a1a1;
  --farm-error-line: rgba(255, 255, 255, 0.1);
  --farm-error-line-strong: rgba(255, 255, 255, 0.22);
  --farm-error-panel: rgba(255, 255, 255, 0.018);
  --farm-error-button-fg: #0a0a0a;
  --farm-error-source-line: rgba(248, 113, 113, 0.12);
  --farm-error-source-marker: #f87171;
  color-scheme: dark;
}

.light .farm-default-error,
[data-theme="light"] .farm-default-error,
[data-color-scheme="light"] .farm-default-error {
  --farm-error-bg: #fafafa;
  --farm-error-fg: #171717;
  --farm-error-muted: #737373;
  --farm-error-line: rgba(0, 0, 0, 0.1);
  --farm-error-line-strong: rgba(0, 0, 0, 0.22);
  --farm-error-panel: rgba(0, 0, 0, 0.018);
  --farm-error-button-fg: #ffffff;
  --farm-error-source-line: rgba(185, 28, 28, 0.08);
  --farm-error-source-marker: #b91c1c;
  color-scheme: light;
}

@media (prefers-reduced-motion: reduce) {
  .farm-default-error__copy,
  .farm-default-error__action {
    transition: none;
  }

  .farm-default-error__copy:active,
  .farm-default-error__action:active {
    transform: none;
  }
}
`;

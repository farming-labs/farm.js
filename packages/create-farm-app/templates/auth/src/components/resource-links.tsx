interface ResourceLinkAction {
  href: string;
  label: string;
}

interface ResourceLinksProps {
  className: string;
  primary?: ResourceLinkAction;
}

function DocsIcon() {
  return (
    <svg
      className="resource-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      className="resource-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.47.11-3.05 0 0 .96-.31 3.16 1.18A10.95 10.95 0 0 1 12 6.1c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.27c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

function ResourceSeparator() {
  return (
    <span className="resource-separator" aria-hidden="true">
      /
    </span>
  );
}

export function ResourceLinks({ className, primary }: ResourceLinksProps) {
  return (
    <nav className={className} aria-label="Starter resources">
      {primary ? (
        <span className="resource-link-item">
          <a className="resource-link-primary" href={primary.href}>
            {primary.label}
          </a>
        </span>
      ) : null}
      <span className="resource-link-item">
        {primary ? <ResourceSeparator /> : null}
        <a href="https://farm.js.dev">
          <DocsIcon />
          <span>Docs</span>
        </a>
      </span>
      <span className="resource-link-item">
        <ResourceSeparator />
        <a href="https://github.com/farming-labs/farm.js">
          <GitHubIcon />
          <span>GitHub</span>
        </a>
      </span>
    </nav>
  );
}

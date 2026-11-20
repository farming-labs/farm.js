import type * as React from "react";

type Runtime = typeof React;

// React 18 and 19 use different delimiters for server IDs. Both encode sibling positions
// from the root up, in base 32. A single-child array adds a high one bit, so the marker
// also records leading zero bits in the layout's last fork.
function positionBits(id: string): string {
  const digits = /^(?::R([0-9a-v]+):|«R([0-9a-v]+)»|_R_([0-9a-v]+)_)$/.exec(id);
  const value = digits?.[1] ?? digits?.[2] ?? digits?.[3];
  if (!value) throw new Error("Farm could not read the React hydration position for this page.");
  return Array.from(value, (digit) => parseInt(digit, 32).toString(2).padStart(5, "0"))
    .join("")
    .replace(/^0+/, "");
}

export function markPagePosition(react: Runtime, boundary: React.ReactElement) {
  function PageBoundary() {
    return react.cloneElement(boundary as React.ReactElement<Record<string, unknown>>, {
      "data-farm-id-position": react.useId(),
    });
  }
  return [react.createElement(PageBoundary, { key: "page" })];
}

type LayoutPositionProps = {
  react: Runtime;
  children: React.ReactNode;
  marker?: string;
};

// The same wrapper on both sides measures from inside the app's integration providers.
// Its array marks the high bit of the position, including a last fork with leading zeros.
function LayoutPosition({ react, children, marker }: LayoutPositionProps): React.ReactNode {
  const id = react.useId();
  // A client mount after React's hydration recovery has fresh IDs.
  if (!marker || /^(?:_r_|:r|«r)/.test(id)) return children;
  const base = "1" + positionBits(id);
  // The server's page boundary also calls useId, adding a bit below its marker.
  const target = "1" + positionBits(marker);
  if (!target.endsWith(base)) {
    throw new Error("Farm could not match the page's server and client provider positions.");
  }
  let bits = target.slice(0, target.length - base.length);
  let node = react.createElement(react.Fragment, { key: "page" }, children);
  // Each fork is a run of bits containing a one. Rebuild from the innermost fork out.
  // Split zero runs between adjacent ones to keep even wide sibling lists inexpensive.
  while (bits.length) {
    const one = bits.indexOf("1");
    if (one === -1) throw new Error("Farm received an invalid React page position.");
    const nextOne = bits.indexOf("1", one + 1);
    const end = nextOne === -1 ? bits.length : one + 1 + Math.floor((nextOne - one - 1) / 2);
    const fork = bits.slice(0, end);
    const slot = 2 ** (fork.length - one - 1);
    const size = 2 ** (fork.length - 1);
    if (size > 65536)
      throw new Error("Farm could not hydrate a page with this many layout siblings.");
    const children = Array<React.ReactNode>(size).fill(null);
    children[slot - 1] = node;
    node = react.createElement(react.Fragment, { key: "fork" }, children);
    bits = bits.slice(end);
  }
  return node;
}

export function markLayoutPosition(react: Runtime, children: React.ReactNode, marker?: string) {
  return [react.createElement(LayoutPosition, { key: "position", react, children, marker })];
}

export function restorePagePosition(react: Runtime, container: Element, page: React.ReactNode) {
  const marker = container.getAttribute("data-farm-id-position");
  return marker ? markLayoutPosition(react, page, marker) : page;
}

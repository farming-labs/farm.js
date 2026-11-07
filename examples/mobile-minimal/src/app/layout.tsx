import type { LayoutProps, Metadata } from "@farm.js/core";

export const metadata: Metadata = {
  title: "Trail Guide",
  description: "The smallest Farm app that is also a native app: pages only, no native code.",
};

// No stylesheet: @farm.js/ui styles itself from tokens, and a CSS import in a layout would keep
// every route under it off the native tier.
export default function RootLayout({ children }: LayoutProps) {
  return <>{children}</>;
}

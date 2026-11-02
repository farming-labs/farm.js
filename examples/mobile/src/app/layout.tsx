import type { LayoutProps, Metadata } from "@farm.js/core";

export const metadata: Metadata = {
  title: "Farm Field Notes",
  description: "A Farm.js app that is a web site in the browser and a native-shell app on Android.",
};

// No stylesheet here: the analyzer reads every layout above a route, and a CSS import would keep
// the /lab routes web. Styled routes get globals.css from the (styled) group layout.
export default function RootLayout({ children }: LayoutProps) {
  return <>{children}</>;
}

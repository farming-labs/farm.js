import type { Metadata } from "@farm.js/core";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS React AOT comparison",
  description:
    "Compare a FARMJS AOT-compiled state update with the normal React update path.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Federated storefront",
  description: "A Farm host loading an independently deployed checkout module.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <div className="host-shell">{children}</div>;
}

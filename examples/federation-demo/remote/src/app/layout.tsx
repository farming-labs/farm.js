import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Checkout producer",
  description: "A Farm application publishing a federated checkout module.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <div className="remote-shell">{children}</div>;
}

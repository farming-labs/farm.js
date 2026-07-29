import React from "react";
import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm.js App",
  description: "A modern React meta-framework built on Vite",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="bg-gray-50 antialiased">
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}

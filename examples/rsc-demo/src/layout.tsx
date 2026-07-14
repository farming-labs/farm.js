// Root layout - Server Component (default)
// This wraps all pages and provides common structure

import React from "react";

export const metadata = {
  title: "Farm.js RSC Demo",
  description: "React Server Components demo with Farm.js",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <nav className="bg-slate-800/50 backdrop-blur-sm border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center gap-8">
            <a href="/" className="text-xl font-bold text-emerald-400">
              🌾 Farm.js RSC
            </a>
            <div className="flex gap-4">
              <a
                href="/"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Home
              </a>
              <a
                href="/about"
                className="text-slate-300 hover:text-white transition-colors"
              >
                About
              </a>
              <a
                href="/counter"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Counter
              </a>
              <a
                href="/form"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Form
              </a>
              <a
                href="/server-fn-middleware"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Middleware
              </a>
              <a
                href="/server-query"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Queries
              </a>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

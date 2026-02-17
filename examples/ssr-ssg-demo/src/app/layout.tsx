import type { LayoutProps } from "@farmjs/core";
import "./globals.css";

export const metadata = {
  title: "Farm.js SSR/SSG Demo",
  description: "Demonstrating SSR and SSG capabilities in Farm.js",
};

export default function RootLayout({ children }: LayoutProps) {
  // Layout renders body content only - the SSR wrapper handles html/head/body
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <a href="/" className="text-xl font-bold text-green-600">
              Farm.js SSR/SSG Demo
            </a>
            <div className="flex gap-4 flex-wrap">
              <a href="/" className="text-gray-600 hover:text-green-600">
                Home (SSR)
              </a>
              <a href="/about" className="text-gray-600 hover:text-green-600">
                About (SSG)
              </a>
              <a href="/team" className="text-gray-600 hover:text-green-600">
                Team (SSG)
              </a>
              <a href="/products" className="text-gray-600 hover:text-green-600">
                Products (ISR)
              </a>
              <a href="/dashboard" className="text-gray-600 hover:text-green-600">
                Dashboard
              </a>
              <a href="/blog/hello-world" className="text-gray-600 hover:text-green-600">
                Blog
              </a>
              <a href="/api-demo" className="text-gray-600 hover:text-green-600">
                API Demo
              </a>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

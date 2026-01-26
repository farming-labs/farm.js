import React from 'react'
import type { LayoutProps, Metadata } from '@farmjs/core'

export const metadata: Metadata = {
  title: 'Farm.js Playground',
  description: 'Testing ground for Farm.js features'
}

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style dangerouslySetInnerHTML={{
          __html: `
            * { box-sizing: border-box; }
            body { 
              margin: 0; 
              font-family: system-ui, -apple-system, sans-serif;
              background: #f8fafc;
            }
            .container { 
              max-width: 1200px; 
              margin: 0 auto; 
              padding: 2rem; 
            }
            .nav {
              background: white;
              border-bottom: 1px solid #e2e8f0;
              padding: 1rem 0;
              margin-bottom: 2rem;
            }
            .nav-content {
              max-width: 1200px;
              margin: 0 auto;
              padding: 0 2rem;
              display: flex;
              gap: 2rem;
              align-items: center;
            }
            .nav a {
              text-decoration: none;
              color: #475569;
              font-weight: 500;
              padding: 0.5rem 1rem;
              border-radius: 0.375rem;
              transition: all 0.2s;
            }
            .nav a:hover {
              background: #f1f5f9;
              color: #1e293b;
            }
            .logo {
              font-size: 1.5rem;
              font-weight: bold;
              color: #1e293b;
            }
          `
        }} />
      </head>
      <body>
        <nav className="nav">
          <div className="nav-content">
            <div className="logo">🚜 Farm.js Playground</div>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/users">Users</a>
            <a href="/users/123">User 123</a>
            <a href="/blog">Blog</a>
            <a href="/blog/hello-world">Blog Post</a>
          </div>
        </nav>
        <div className="container">
          {children}
        </div>
      </body>
    </html>
  )
}


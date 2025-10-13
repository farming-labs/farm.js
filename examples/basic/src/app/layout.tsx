import React from 'react'
import type { LayoutProps, Metadata } from 'farm'

export const metadata: Metadata = {
  title: 'Farm.js Basic Example',
  description: 'A basic example showcasing Farm.js features'
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
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
            .nav { 
              background: #f8f9fa; 
              padding: 1rem 0; 
              margin-bottom: 2rem; 
              border-bottom: 1px solid #dee2e6;
            }
            .nav-content { 
              max-width: 800px; 
              margin: 0 auto; 
              padding: 0 2rem;
              display: flex;
              gap: 2rem;
              align-items: center;
            }
            .nav a { 
              text-decoration: none; 
              color: #495057; 
              font-weight: 500;
              padding: 0.5rem 1rem;
              border-radius: 4px;
              transition: background-color 0.2s;
            }
            .nav a:hover { background: #e9ecef; }
            .logo { font-weight: bold; color: #212529; }
          `
        }} />
      </head>
      <body>
        <nav className="nav">
          <div className="nav-content">
            <div className="logo">🚜 Farm.js Basic Example</div>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
          </div>
        </nav>
        <div className="container">
          {children}
        </div>
      </body>
    </html>
  )
}


import React from 'react'
import type { LayoutProps, Metadata } from 'farm'

export const metadata: Metadata = {
  title: 'Farm.js App',
  description: 'A modern React meta-framework built on Vite'
}

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <body>
        <div id="root">
          {children}
        </div>
      </body>
    </html>
  )
}


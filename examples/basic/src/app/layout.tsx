import React from 'react'
import type { LayoutProps, Metadata } from '@farmjs/core'
import './globals.css'

export const metadata: Metadata = {
  title: 'Farm.js Basic Example',
  description: 'A basic example showcasing Farm.js features'
}

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8 h-16">
            <div className="text-xl font-bold text-gray-900">🚜 Farm.js</div>
            <a href="/" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              Home
            </a>
            <a href="/about" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              About
            </a>
            <a href="/contact" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              Contact
            </a>
            <a href="/users/123" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              User Demo
            </a>
            <a href="/query-demo" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              Query Demo
            </a>
            <a href="/farm-query-demo" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              Farm Query
            </a>
            <a href="/api-demo" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              API Demo
            </a>
            <a href="/api-demo-client" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              API Client
            </a>
            <a href="/docs/reference" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-100 transition-colors">
              API Docs
            </a>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}


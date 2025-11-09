import React from 'react'
import type { PageProps } from 'farm'

export default function AboutPage({ params, searchParams }: PageProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">About .js</h1>
        
        <p className="text-lg text-gray-600 leading-relaxed">
          This basic example showcases the fundamental features of Farm.js without 
          any complex dependencies or configurations.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-md p-8 border border-gray-200">
        <h2 className="text-2xl font-semibold mb-4 text-gray-900">What's Included</h2>
        <div className="space-y-4">
          <Feature
            title="File-based Routing"
            description="Pages are created by adding files to the app directory"
          />
          <Feature
            title="Layouts"
            description="Shared UI components across pages with nested support"
          />
          <Feature
            title="TypeScript"
            description="Full type safety out of the box with PageProps and more"
          />
          <Feature
            title="React Server Components"
            description="Server-side rendering capabilities for optimal performance"
          />
          <Feature
            title="Tailwind CSS"
            description="Beautiful, responsive UIs with utility-first CSS"
          />
        </div>
      </div>

      <div className="bg-gray-900 text-white rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Project Structure</h2>
        <pre className="bg-gray-800 p-4 rounded-md text-sm overflow-auto">
{`src/
  app/
    layout.tsx      # Root layout with Tailwind
    globals.css     # Tailwind imports
    page.tsx        # Home page (/)
    about/
      page.tsx      # About page (/about)
    contact/
      page.tsx      # Contact page (/contact)
    users/
      [id]/
        page.tsx    # Dynamic route (/users/:id)`}
        </pre>
      </div>

      <div className="flex gap-4">
        <a href="/" className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
          ← Back to Home
        </a>
        <a href="/users/123?tab=profile" className="inline-flex items-center px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium">
          Try Dynamic Route →
        </a>
      </div>
    </div>
  )
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 flex items-center justify-center mt-0.5">
        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-gray-600 text-sm">{description}</p>
      </div>
    </div>
  )
}


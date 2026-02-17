"use client";

import React, { useState, useEffect } from 'react'
import type { PageProps } from '@farmjs/core/client'
import { Link } from '@farmjs/core/client'

export default function UserPage({ params = {} }: PageProps) {
  const { id = '' } = params
  
  // For client components, read searchParams from URL on client side
  const [search, setSearch] = useState<Record<string, string>>({})
  
  useEffect(() => {
    // Parse current URL search params
    const parseSearchParams = () => {
      const urlParams = new URLSearchParams(window.location.search)
      const paramsObj: Record<string, string> = {}
      urlParams.forEach((value, key) => {
        paramsObj[key] = value
      })
      setSearch(paramsObj)
    }
    
    // Parse on mount
    parseSearchParams()
    
    // Re-parse on popstate (back/forward navigation)
    const handlePopState = () => parseSearchParams()
    window.addEventListener('popstate', handlePopState)
    
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [id]) // Re-run when id changes (SPA navigation to different user)
  
  const tab = search?.tab as string | undefined
  
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 mb-2">User Profile: {id}</h1>
        
        <p className="text-gray-600">
          This is a dynamic route example showing how params and searchParams work.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <InfoCard 
          title="Dynamic Route Params" 
          description="These come from the URL path segments like [id]"
          data={params}
          example="/users/123 → { id: '123' }"
        />
        
        <InfoCard 
          title="Search/Query Params" 
          description="These come from the query string (?key=value)"
          data={search || {}}
          example="/users/123?tab=profile&sort=asc → { tab: 'profile', sort: 'asc' }"
        />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-4 text-gray-900">💡 How to Use PageProps</h3>
        <div className="space-y-4">
          <div>
            <p className="font-semibold mb-2">1. Import the type:</p>
            <pre className="bg-white p-3 rounded-md text-sm overflow-auto border border-blue-200">
        {`import type { PageProps } from '@farmjs/core'`}
            </pre>
          </div>

          <div>
            <p className="font-semibold mb-2">2. Use in your component:</p>
            <pre className="bg-white p-3 rounded-md text-sm overflow-auto border border-blue-200">
{`export default async function MyPage({ params, searchParams }: PageProps) {
  const { id } = params
  const search = await searchParams  // searchParams is a Promise!
  const tab = search?.tab
  
  return <div>User {id}, Tab: {tab}</div>
}`}
            </pre>
          </div>

          <div>
            <p className="font-semibold mb-2">3. Current values:</p>
            <ul className="space-y-1 text-sm">
              <li><code className="bg-blue-100 px-2 py-1 rounded">params.id</code> = "{id}"</li>
              <li><code className="bg-blue-100 px-2 py-1 rounded">searchParams.tab</code> = "{tab || 'not set'}"</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">🧪 Try These URLs:</h3>
        <div className="space-y-2">
          <UrlDemo href="/users/123" description="Basic dynamic route" />
          <UrlDemo href="/users/456?tab=settings" description="With search params" />
          <UrlDemo href="/users/john-doe?tab=profile&sort=desc" description="String ID with multiple params" />
        </div>
      </div>

      <div>
        <Link href="/" className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
          ← Back to Home
        </Link>
      </div>
    </div>
  )
}

function InfoCard({ title, description, data, example }: {
  title: string
  description: string
  data: Record<string, any>
  example: string
}) {
  return (
    <div className="bg-white rounded-lg p-6 shadow-md border border-gray-200">
      <h2 className="text-xl font-semibold mb-2 text-gray-900">{title}</h2>
      <p className="text-gray-600 text-sm mb-4">{description}</p>
      
      <div className="bg-gray-50 p-4 rounded-md mb-4 border border-gray-200">
        <strong className="text-sm text-gray-700">Current values:</strong>
        <pre className="mt-2 text-sm text-gray-900 overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
      
      <div className="bg-yellow-50 p-3 rounded-md border border-yellow-200">
        <strong className="text-sm text-gray-700">Example:</strong> 
        <code className="text-sm ml-2 text-gray-900">{example}</code>
      </div>
    </div>
  )
}

function UrlDemo({ href, description }: { href: string; description: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors">
      <div>
        <code className="text-sm font-mono text-blue-600">{href}</code>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
      </div>
      <Link 
        href={href}
        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
      >
        Visit
      </Link>
    </div>
  )
}

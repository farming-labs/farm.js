import { getMiddlewareData, getMiddlewareValue } from '@farmjs/core/middleware'
import React from 'react'
import type { PageProps } from '@farmjs/core'
import { GET as helloGet } from "../api/hello/route"
export default async function ContactPage(props: PageProps) {
  const middlewareData = props.middleware?.data;
  const demoInfoFromProps = middlewareData?.get('demoInfo');

  const data = getMiddlewareData<{ demoInfo: { message: string } }>();
  const demoInfoFromHelper = data.get('demoInfo');

  const demoInfoDirect = getMiddlewareValue('demoInfo');
  console.log('📊 Contact page middleware data:', {
    fromProps: demoInfoFromProps,
    fromHelper: demoInfoFromHelper,
    fromDirect: demoInfoDirect,
  });
  const allDataMatches = JSON.stringify(demoInfoFromProps) === JSON.stringify(demoInfoFromHelper) &&
    JSON.stringify(demoInfoFromHelper) === JSON.stringify(demoInfoDirect);
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <p className="text-lg text-gray-600">
          Get in touch h the Farm.js team or community.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <ContactCard
          title="GitHub"
          description="Report issues, contribute code, or browse the source"
          link="https://github.com/farm-js/farm.js"
          icon="📦"
        />

        <ContactCard
          title="Documentation"
          description="Learn more about Farm.js features and API"
          link="https://farm.js.dev"
          icon="📚"
        />

        <ContactCard
          title="Community"
          description="Join discussions and get help from the community"
          link="#"
          icon="💬"
        />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-2 text-gray-900">💡 Pro Tip</h3>
        <p className="text-gray-700">
          This page demonstrates how easy it is to create new routes in Farm.js.
          Just add a <code className="bg-blue-100 px-2 py-1 rounded">page.tsx</code> file in a new directory!
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <h3 className="text-lg font-semibold mb-3 text-gray-900">📊 PageProps for /contact</h3>
        <p className="text-sm text-gray-600 mb-4">
          This is a <strong>static route</strong> (no dynamic segments like [id]), so:
        </p>
        {/* <pre className="bg-gray-50 p-4 rounded-md text-sm overflow-auto border border-gray-200">
          {JSON.stringify({ params, searchParams }, null, 2)}
        </pre> */}
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm">
          <strong>💡 Note:</strong> <code className="bg-yellow-100 px-1.5 py-0.5 rounded">params</code> is empty because this route has no
          dynamic segments like [id]. Try adding query params:
          <a href="/contact?subject=bug&priority=high" className="text-blue-600 hover:underline ml-1">
            /contact?subject=bug&priority=high
          </a>
        </div>
      </div>

      <div>
        <a href="/" className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
          ← Back to Home
        </a>
      </div>
    </div>
  )
}

function ContactCard({ title, description, link, icon }: {
  title: string
  description: string
  link: string
  icon: string
}) {
  return (
    <div className="bg-white rounded-lg p-6 shadow-md border border-gray-200 hover:shadow-lg transition-all hover:scale-105">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold mb-2 text-gray-900">{title}</h3>
      <p className="text-gray-600 text-sm mb-4">{description}</p>
      <a
        href={link}
        className="text-blue-600 hover:text-blue-700 font-medium text-sm inline-flex items-center gap-1"
      >
        Learn more
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </a>
    </div>
  )
}


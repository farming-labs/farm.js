/**
 * About Page - SSG (Static Site Generation)
 * 
 * This page is pre-rendered at BUILD TIME.
 * The HTML is generated once and served to all users.
 * 
 * Use SSG when:
 * - Content rarely changes
 * - Content is the same for all users
 * - You want the fastest possible page load
 */

// ✅ This is all you need for SSG!
export const ssg = true;

export const metadata = {
  title: "About - SSG Demo",
  description: "This page is pre-rendered at build time",
};

export default function AboutPage() {
  // Note: This runs at BUILD TIME, not on each request
  const buildTime = new Date().toISOString();

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            SSG
          </span>
          <span className="text-gray-500">Static Site Generation</span>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          About Us
        </h1>

        <p className="text-gray-600 mb-6">
          This page was <strong>pre-rendered at build time</strong>.
          The time below was captured during the build, not when you loaded the page.
        </p>

        <div className="bg-gray-100 rounded-lg p-4">
          <p className="text-sm text-gray-500 mb-1">Build Time (Static):</p>
          <p className="text-2xl font-mono text-gray-900">{buildTime}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">How it works</h2>
        
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-green-100 text-green-800 flex items-center justify-center font-bold">
              1
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Build Time</h3>
              <p className="text-gray-600">
                Farm.js detects <code className="bg-gray-100 px-1 rounded">export const ssg = true</code> 
                and renders this page during the build.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-green-100 text-green-800 flex items-center justify-center font-bold">
              2
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">HTML Generated</h3>
              <p className="text-gray-600">
                The rendered HTML is saved as a static file in the build output.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-green-100 text-green-800 flex items-center justify-center font-bold">
              3
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Instant Delivery</h3>
              <p className="text-gray-600">
                When users request this page, the pre-built HTML is served instantly - no server rendering needed!
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Code Example</h2>
        <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
{`// src/app/about/page.tsx

// ✅ This is all you need for SSG!
export const ssg = true;

export const metadata = {
  title: "About Us",
};

export default function AboutPage() {
  return (
    <div>
      <h1>About Us</h1>
      <p>This content is static.</p>
    </div>
  );
}`}
        </pre>
      </div>
    </div>
  );
}

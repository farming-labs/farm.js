/**
 * Products Page - SSG with ISR (Incremental Static Regeneration)
 * 
 * This page is pre-rendered at BUILD TIME but will be regenerated
 * periodically based on the `revalidate` interval.
 * 
 * Use ISR when:
 * - Content updates periodically but not on every request
 * - You want the speed of static with fresh data
 * - Perfect for e-commerce product listings, news articles, etc.
 */

export const ssg = true;
export const revalidate = 60; // Regenerate every 60 seconds

export const metadata = {
  title: "Products - ISR Demo",
  description: "Static page that regenerates every 60 seconds",
};

// Simulated product data - in real app, fetch from API
async function getProducts() {
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return [
    { id: 1, name: "Farm.js Pro", price: "$99", description: "Full framework license", emoji: "🚀" },
    { id: 2, name: "Cloud Hosting", price: "$29/mo", description: "Managed deployment", emoji: "☁️" },
    { id: 3, name: "Support Package", price: "$199/mo", description: "Priority support", emoji: "💬" },
    { id: 4, name: "Enterprise", price: "Contact", description: "Custom solutions", emoji: "🏢" },
  ];
}

export default async function ProductsPage() {
  const products = await getProducts();
  const generatedAt = new Date().toISOString();

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            SSG
          </span>
          <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-medium">
            ISR: 60s
          </span>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Products
        </h1>

        <p className="text-gray-600 mb-4">
          This page uses <strong>Incremental Static Regeneration (ISR)</strong>.
          It's pre-rendered at build time but regenerates every 60 seconds.
        </p>

        <div className="bg-gray-100 rounded-lg p-4">
          <p className="text-sm text-gray-500">
            Page generated: {generatedAt}
            <br />
            <span className="text-orange-600">Will regenerate after 60 seconds of staleness</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {products.map((product) => (
          <div key={product.id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="text-3xl">{product.emoji}</div>
              <span className="text-xl font-bold text-green-600">{product.price}</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">{product.name}</h2>
            <p className="text-gray-600">{product.description}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">How ISR Works</h2>
        
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-800 flex items-center justify-center font-bold">
              1
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Initial Build</h3>
              <p className="text-gray-600">
                Page is pre-rendered at build time like regular SSG.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-800 flex items-center justify-center font-bold">
              2
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Serve Static</h3>
              <p className="text-gray-600">
                Users receive the static HTML instantly.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-800 flex items-center justify-center font-bold">
              3
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Background Regeneration</h3>
              <p className="text-gray-600">
                After 60 seconds, the next request triggers a background regeneration.
                Users still get the cached version while the new one builds.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Code Example</h2>
        <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
{`// SSG with ISR - regenerate every 60 seconds
export const ssg = true;
export const revalidate = 60;

async function getProducts() {
  const res = await fetch('https://api.example.com/products');
  return res.json();
}

export default async function ProductsPage() {
  const products = await getProducts();
  
  return (
    <div>
      {products.map(p => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}`}
        </pre>
      </div>
    </div>
  );
}

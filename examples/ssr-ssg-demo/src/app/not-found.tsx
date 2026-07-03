interface NotFoundProps {
  pathname?: string;
}

export default function NotFound({ pathname }: NotFoundProps) {
  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
            404
          </span>
          <span className="text-gray-500">Page Not Found</span>
        </div>

        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Oops! Page Not Found
        </h1>
        
        <p className="text-gray-600 mb-6 max-w-md mx-auto">
          {pathname ? (
            <>
              The page <code className="bg-gray-100 px-2 py-1 rounded text-sm">{pathname}</code> doesn't exist.
            </>
          ) : (
            "The page you're looking for doesn't exist or has been moved."
          )}
        </p>

        <a
          href="/"
          className="inline-block bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
        >
          Go to Home
        </a>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Available Pages</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <a href="/" className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="font-medium text-gray-900">Home</div>
            <div className="text-sm text-gray-500">SSR Page</div>
          </a>
          <a href="/about" className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="font-medium text-gray-900">About</div>
            <div className="text-sm text-gray-500">SSG Page</div>
          </a>
          <a href="/team" className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="font-medium text-gray-900">Team</div>
            <div className="text-sm text-gray-500">SSG Page</div>
          </a>
          <a href="/products" className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="font-medium text-gray-900">Products</div>
            <div className="text-sm text-gray-500">ISR Page</div>
          </a>
          <a href="/dashboard" className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="font-medium text-gray-900">Dashboard</div>
            <div className="text-sm text-gray-500">Client Page</div>
          </a>
          <a href="/api-demo" className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="font-medium text-gray-900">API Demo</div>
            <div className="text-sm text-gray-500">Client Page</div>
          </a>
        </div>
      </div>
    </div>
  );
}

import React from "react";

interface NotFoundProps {
  pathname?: string;
}

export default function NotFound({ pathname }: NotFoundProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <span className="text-8xl">🚜</span>
        </div>
        <h1 className="text-6xl font-bold text-green-600 mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">
          Lost in the Fields
        </h2>
        <p className="text-gray-600 mb-8">
          {pathname ? (
            <>
              The page <code className="bg-gray-100 px-2 py-1 rounded text-sm">{pathname}</code> doesn't exist on this farm.
            </>
          ) : (
            "Looks like you've wandered off the beaten path. This page doesn't exist."
          )}
        </p>
        <div className="space-y-4">
          <a
            href="/"
            className="inline-block bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
          >
            Return to Home
          </a>
          <p className="text-sm text-gray-500">
            Or try one of these pages:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <a href="/about" className="text-green-600 hover:underline">About</a>
            <span className="text-gray-300">•</span>
            <a href="/contact" className="text-green-600 hover:underline">Contact</a>
            <span className="text-gray-300">•</span>
            <a href="/api-demo" className="text-green-600 hover:underline">API Demo</a>
          </div>
        </div>
      </div>
    </div>
  );
}

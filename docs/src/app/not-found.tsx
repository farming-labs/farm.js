import { Link } from "@farmjs/core/client";

interface NotFoundProps {
  pathname?: string;
}

export default function NotFound({ pathname }: NotFoundProps) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
        404
      </span>
      <h1 className="mt-4 text-3xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-2 text-slate-600">
        {pathname ? (
          <>
            The page{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">{pathname}</code>{" "}
            doesn't exist.
          </>
        ) : (
          "The page you're looking for doesn't exist or has been moved."
        )}
      </p>
      <div className="mt-8">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Go to home
        </Link>
        <Link
          href="/docs"
          className="ml-4 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Docs
        </Link>
      </div>
    </div>
  );
}

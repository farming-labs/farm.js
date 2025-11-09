import { jsxs, jsx, Fragment } from "react/jsx-runtime";
function HomePage({ params, searchParams }) {
  return /* @__PURE__ */ jsxs("div", { className: "space-y-8", children: [
    /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
      /* @__PURE__ */ jsx("h1", { className: "text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4", children: "Welcome to Farm.js 0.0.1" }),
      /* @__PURE__ */ jsx("p", { className: "text-xl text-gray-600 max-w-2xl mx-auto", children: "A modern React meta-framework built on Vite with Next.js-like semantics" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "grid md:grid-cols-2 lg:grid-cols-3 gap-6", children: [
      /* @__PURE__ */ jsx(
        FeatureCard,
        {
          icon: "⚡",
          title: "Blazing Fast",
          description: "Built on Vite for instant HMR and lightning-fast builds"
        }
      ),
      /* @__PURE__ */ jsx(
        FeatureCard,
        {
          icon: "⚛️",
          title: "React Server Components",
          description: "Full RSC support with streaming SSR"
        }
      ),
      /* @__PURE__ */ jsx(
        FeatureCard,
        {
          icon: "🎯",
          title: "Next.js-like API",
          description: "Familiar file-based routing and app directory"
        }
      ),
      /* @__PURE__ */ jsx(
        FeatureCard,
        {
          icon: "📦",
          title: "Zero Config",
          description: "Works out of the box with sensible defaults"
        }
      ),
      /* @__PURE__ */ jsx(
        FeatureCard,
        {
          icon: "🎨",
          title: "Tailwind CSS",
          description: "Built-in Tailwind support for beautiful UIs"
        }
      ),
      /* @__PURE__ */ jsx(
        FeatureCard,
        {
          icon: "🧪",
          title: "Type Safe",
          description: "Full TypeScript support throughout"
        }
      ),
      /* @__PURE__ */ jsx(
        FeatureCard,
        {
          icon: "🚀",
          title: "API Routes",
          description: "Type-safe API endpoints with better-call",
          href: "/api-demo"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "bg-white rounded-lg shadow-md p-6 border border-gray-200", children: [
      /* @__PURE__ */ jsx("h3", { className: "text-lg font-semibold mb-4 text-gray-900", children: "📊 Request Information" }),
      /* @__PURE__ */ jsx("p", { className: "text-sm text-gray-600 mb-3", children: "PageProps received by this component:" }),
      /* @__PURE__ */ jsx("pre", { className: "bg-gray-50 p-4 rounded-md text-sm overflow-auto border border-gray-200", children: JSON.stringify({ params, searchParams }, null, 2) }),
      /* @__PURE__ */ jsxs("p", { className: "text-xs text-gray-500 mt-3", children: [
        "Try adding query params: ",
        /* @__PURE__ */ jsx("a", { href: "/?name=John&framework=Farm.js", className: "text-blue-600 hover:underline", children: "/?name=John&framework=Farm.js" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6 border border-blue-200", children: [
      /* @__PURE__ */ jsx("h3", { className: "text-lg font-semibold mb-2 text-gray-900", children: "🚀 Quick Links" }),
      /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap gap-3", children: [
        /* @__PURE__ */ jsx("a", { href: "/about", className: "inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors", children: "About Page" }),
        /* @__PURE__ */ jsx("a", { href: "/contact", className: "inline-flex items-center px-4 py-2 bg-white text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors", children: "Contact" }),
        /* @__PURE__ */ jsx("a", { href: "/users/123?tab=profile", className: "inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors", children: "Dynamic Route Demo" }),
        /* @__PURE__ */ jsx("a", { href: "/api-demo", className: "inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors", children: "API Demo (Server)" }),
        /* @__PURE__ */ jsx("a", { href: "/api-demo-client", className: "inline-flex items-center px-4 py-2 bg-pink-600 text-white rounded-md hover:bg-pink-700 transition-colors", children: "API Demo (Client)" }),
        /* @__PURE__ */ jsx("a", { href: "/docs/reference", className: "inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors", children: "📚 API Documentation" })
      ] })
    ] })
  ] });
}
function FeatureCard({ icon, title, description, href }) {
  const content = /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { className: "text-4xl mb-3", children: icon }),
    /* @__PURE__ */ jsx("h3", { className: "text-lg font-semibold mb-2 text-gray-900", children: title }),
    /* @__PURE__ */ jsx("p", { className: "text-sm text-gray-600", children: description })
  ] });
  if (href) {
    return /* @__PURE__ */ jsx("a", { href, className: "bg-white rounded-lg p-6 shadow-md border border-gray-200 hover:shadow-lg hover:border-blue-400 transition-all block", children: content });
  }
  return /* @__PURE__ */ jsx("div", { className: "bg-white rounded-lg p-6 shadow-md border border-gray-200 hover:shadow-lg transition-shadow", children: content });
}
export {
  HomePage as default
};

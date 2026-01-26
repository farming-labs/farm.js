import React from "react";

export default function RootLayout({ children }) {
  return React.createElement(
    "html",
    { lang: "en" },
    React.createElement(
      "head",
      null,
      React.createElement("meta", { charSet: "utf-8" }),
      React.createElement("meta", {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      }),
      React.createElement("title", null, "Farm.js Demo"),
      React.createElement("style", {
        dangerouslySetInnerHTML: {
          __html: `
          body { 
            margin: 0; 
            font-family: system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 1rem;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 600px;
            text-align: center;
          }
          h1 { 
            color: #667eea;
            font-size: 3rem;
            margin: 0 0 1rem 0;
          }
          p { 
            color: #666;
            font-size: 1.2rem;
            line-height: 1.6;
          }
          .emoji { font-size: 4rem; margin-bottom: 1rem; }
          .features {
            margin-top: 2rem;
            text-align: left;
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 0.5rem;
          }
          .features li {
            margin: 0.5rem 0;
            color: #333;
          }
        `,
        },
      }),
    ),
    React.createElement("body", null, children),
  );
}

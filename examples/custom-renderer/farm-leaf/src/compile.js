// Compiles a `.leaf` file into an ordinary module Farm can load:
//
//   <script module> ... </script>   module scope: imports and exports such as `hydrate`
//   <script> ... </script>          runs on every render, before the markup
//   markup                          JSX, returned by the default-exported component

const SCRIPT = /<script(\s+module)?\s*>([\s\S]*?)<\/script>/g;
const IMPORT = /^[ \t]*import\s(?:[^;'"]*?\sfrom\s*)?(["'])[^"'\n]+\1;?[ \t]*$/gm;

export function compileLeaf(source, name = "LeafComponent") {
  let moduleScript = "";
  let renderScript = "";
  const markup = source
    .replace(SCRIPT, (_, isModule, body) => {
      if (isModule) moduleScript += body;
      else renderScript += body;
      return "";
    })
    .trim();
  // Imports are module-level, wherever the file writes them.
  const imports = [];
  const body = renderScript.replace(IMPORT, (statement) => {
    imports.push(statement.trim());
    return "";
  });
  return [
    ...imports,
    moduleScript.trim(),
    `export default function ${name}(props) {`,
    body.trim(),
    `  return (<>${markup}</>);`,
    "}",
    "",
  ].join("\n");
}

/** `badge.leaf` → `Badge`, `[name].leaf` → `Name`. */
export function componentName(file) {
  const base = file
    .split(/[\\/]/)
    .pop()
    .replace(/\.leaf$/, "");
  const words = base.match(/[A-Za-z0-9]+/g) ?? ["Leaf"];
  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^[A-Za-z]/.test(name) ? name : `Leaf${name}`;
}

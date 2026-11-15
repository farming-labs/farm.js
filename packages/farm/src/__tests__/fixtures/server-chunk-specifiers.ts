/**
 * Minified server chunks and their restored output, recorded from the
 * implementation that decoded the full AST for any `require(\`` text,
 * including Rolldown's `__require(` helper.
 */
export const SERVER_CHUNK_SPECIFIER_CASES: ReadonlyArray<{
  name: string;
  fileName: string;
  input: string;
  expected: string;
}> = [
  {
    name: "Rolldown entry chunk with CommonJS interop and page loaders",
    fileName: "_virtual_farm-ssr-entry.js",
    input:
      'import{n as __require,r as __toESM,t as __commonJSMin}from"./rolldown-runtime-kJ_i4yPo.js";var require_legacy_client=__commonJSMin((e=>{let{EventEmitter:t}=__require(`events`),n=__require(`net`);e.connect=function connect(){let e=process.env.SSL?__require(`fs`):null;return Object.assign(new t,{socket:new n.Socket,fs:e})}})),import_legacy_client=__toESM(require_legacy_client(),1);const pages={"/":()=>import(`./home-DLgwQDLE.js`),"/docs/[slug]":()=>import(`./docs-slug-BjWii4SC.js`)};async function render(e){return(await pages[e]()).default({client:import_legacy_client.connect()})}const sample="await import(`./not-a-module.mjs`)",evaluate=source=>eval(source);export{evaluate,render,sample};',
    expected:
      'import{n as __require,r as __toESM,t as __commonJSMin}from"./rolldown-runtime-kJ_i4yPo.js";var require_legacy_client=__commonJSMin((e=>{let{EventEmitter:t}=__require(`events`),n=__require(`net`);e.connect=function connect(){let e=process.env.SSL?__require(`fs`):null;return Object.assign(new t,{socket:new n.Socket,fs:e})}})),import_legacy_client=__toESM(require_legacy_client(),1);const pages={"/":()=>import("./home-DLgwQDLE.js"),"/docs/[slug]":()=>import("./docs-slug-BjWii4SC.js")};async function render(e){return(await pages[e]()).default({client:import_legacy_client.connect()})}const sample="await import(`./not-a-module.mjs`)",evaluate=source=>eval(source);export{evaluate,render,sample};',
  },
  {
    name: "Rolldown page chunk with a mangled require helper",
    fileName: "assets/page.js",
    input:
      'import{n as e,r as t,t as n}from"./rolldown-runtime-kJ_i4yPo.js";var r=t(n(((t,n)=>{let{Transform:r}=e(`stream`);n.exports=function split(){return new r}}))(),1);function Home(){return(0,r.default)()}export{Home as default};',
    expected:
      'import{n as e,r as t,t as n}from"./rolldown-runtime-kJ_i4yPo.js";var r=t(n(((t,n)=>{let{Transform:r}=e(`stream`);n.exports=function split(){return new r}}))(),1);function Home(){return(0,r.default)()}export{Home as default};',
  },
  {
    name: "require() calls that are not static specifiers",
    fileName: "chunk.mjs",
    input:
      "export const a=e=>require(`./locales/${e}.cjs`);export const b=()=>require(`./x.cjs`,1);export const c=()=>import.meta.require(`./y.cjs`);export const d=e=>e.require(`./z.cjs`);export class E{#e(e){return e}f(){return this.#e(`./w.cjs`)}}export const g=()=>__require(`fs`);",
    expected:
      "export const a=e=>require(`./locales/${e}.cjs`);export const b=()=>require(`./x.cjs`,1);export const c=()=>import.meta.require(`./y.cjs`);export const d=e=>e.require(`./z.cjs`);export class E{#e(e){return e}f(){return this.#e(`./w.cjs`)}}export const g=()=>__require(`fs`);",
  },
  {
    name: "specifier text inside strings, templates and regular expressions",
    fileName: "chunk.mjs",
    input:
      'export const a="require(`./s.cjs`)";export const b="import(`./s.mjs`)";export const c=/require\\(`x`\\)|import\\(`y`\\)/;export const d="__require(`fs`)";export const e=()=>__require(`fs`);export const f=()=>import(`./real.mjs`);',
    expected:
      'export const a="require(`./s.cjs`)";export const b="import(`./s.mjs`)";export const c=/require\\(`x`\\)|import\\(`y`\\)/;export const d="__require(`fs`)";export const e=()=>__require(`fs`);export const f=()=>import("./real.mjs");',
  },
  {
    name: "import() template with a substitution next to __require()",
    fileName: "chunk.mjs",
    input:
      "export const a=e=>import(`./locales/${e}.mjs`);export const b=()=>import(`./page.mjs`);export const c=()=>__require(`fs`);",
    expected:
      'export const a=e=>import(`./locales/${e}.mjs`);export const b=()=>import("./page.mjs");export const c=()=>__require(`fs`);',
  },
  {
    name: "phase imports next to __require()",
    fileName: "chunk.mjs",
    input:
      "export const a=()=>import.source(`./x.wasm`);export const b=()=>import.defer(`./y.mjs`);export const c=()=>__require(`fs`);",
    expected:
      'export const a=()=>import.source("./x.wasm");export const b=()=>import.defer("./y.mjs");export const c=()=>__require(`fs`);',
  },
  {
    name: "phase imports without require()",
    fileName: "chunk.mjs",
    input: "export const a=()=>import.source(`./x.wasm`);export const b=()=>import(`./y.mjs`);",
    expected: 'export const a=()=>import.source("./x.wasm");export const b=()=>import("./y.mjs");',
  },
  {
    name: "escaped, non-ASCII and multi-line import() specifiers next to __require()",
    fileName: "chunk.mjs",
    input:
      "export const a=()=>import(`./ab.mjs`);export const b=()=>import(`./caf\\u00E9.mjs`);export const c=()=>import(`./line\nbreak.mjs`);export const d=()=>__require(`fs`);",
    expected:
      'export const a=()=>import("./ab.mjs");export const b=()=>import("./caf\\u00e9.mjs");export const c=()=>import("./line\\nbreak.mjs");export const d=()=>__require(`fs`);',
  },
  {
    name: "import() the module record lists twice, next to __require()",
    fileName: "chunk.mjs",
    input:
      "export async function load(){let e;try{({onFarmEvent:e}=await import(`./_chunks/observability.mjs`))}catch{}return e}export const b=()=>__require(`fs`);",
    expected:
      'export async function load(){let e;try{({onFarmEvent:e}=await import("./_chunks/observability.mjs"))}catch{}return e}export const b=()=>__require(`fs`);',
  },
  {
    name: "import() with options and nested import()",
    fileName: "chunk.mjs",
    input:
      "export const a=()=>import(`./data.json`,{with:{type:`json`}});export const b=()=>import(`./outer.mjs`).then(()=>import(`./inner.mjs`));export const c=()=>__require(`fs`);",
    expected:
      'export const a=()=>import("./data.json",{with:{type:`json`}});export const b=()=>import("./outer.mjs").then(()=>import("./inner.mjs"));export const c=()=>__require(`fs`);',
  },
  {
    name: "import() template without __require()",
    fileName: "chunk.mjs",
    input:
      'export const a=`plain`;export const b=()=>require("./x.cjs");export const c=()=>import(`./y.mjs`);',
    expected:
      'export const a=`plain`;export const b=()=>require("./x.cjs");export const c=()=>import("./y.mjs");',
  },
  {
    name: "require() template call next to __require()",
    fileName: "chunk.mjs",
    input:
      "export const a=()=>require(`./legacy.cjs`),b=()=>__require(`fs`),c=()=>import(`./page.mjs`);",
    expected:
      'export const a=()=>require("./legacy.cjs"),b=()=>__require(`fs`),c=()=>import("./page.mjs");',
  },
  {
    name: "spread require() template call",
    fileName: "chunk.mjs",
    input: "export const a=()=>[...require(`./list.cjs`)],b=()=>__require(`fs`);",
    expected: 'export const a=()=>[...require("./list.cjs")],b=()=>__require(`fs`);',
  },
  {
    name: "require() template call at the start of the chunk",
    fileName: "chunk.mjs",
    input: "require(`./polyfill.cjs`);export const b=()=>__require(`fs`);",
    expected: 'require("./polyfill.cjs");export const b=()=>__require(`fs`);',
  },
  {
    name: "only identifier-prefixed require() templates",
    fileName: "chunk.mjs",
    input:
      "export const b=()=>__require(`fs`),c=()=>createRequire(`./x.cjs`),d=()=>_require(`./y.cjs`),f=()=>$require(`./z.cjs`),g=()=>import(`./page.mjs`);",
    expected:
      'export const b=()=>__require(`fs`),c=()=>createRequire(`./x.cjs`),d=()=>_require(`./y.cjs`),f=()=>$require(`./z.cjs`),g=()=>import("./page.mjs");',
  },
];

import { resolveFarmThemeConfig } from "./config";
import type {
  FarmThemeConfig,
  FarmThemePreference,
  FarmThemeRuntime,
  ResolvedFarmThemeConfig,
} from "./types";

const THEME_SCRIPT_ID = "farm-theme-script";
const THEME_STYLE_ID = "farm-theme-style";

declare global {
  interface Window {
    __FARM_THEME__?: FarmThemeRuntime;
  }
}

export interface FarmThemeDocumentParts {
  attributes: string;
  head: string;
}

export function createFarmThemeDocumentParts(
  input: FarmThemeConfig | ResolvedFarmThemeConfig | false | undefined,
  basePath = "/",
  serverTheme?: FarmThemePreference,
): FarmThemeDocumentParts {
  const config = resolveFarmThemeConfig(input, basePath);
  if (!config.enabled) return { attributes: "", head: "" };

  const hydrationTheme = serverTheme ?? config.default;
  const initialTheme = hydrationTheme === "system" ? "light" : hydrationTheme;
  const script = createFarmThemeBootstrapScript(config, hydrationTheme);

  return {
    attributes: ` data-theme="${initialTheme}"`,
    head: `<style id="${THEME_STYLE_ID}">:root[data-theme="light"]{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}</style><script id="${THEME_SCRIPT_ID}">${script}</script>`,
  };
}

export function createFarmThemeBootstrapScript(
  config: ResolvedFarmThemeConfig,
  serverTheme: FarmThemePreference = config.default,
): string {
  return `(function(config,serverTheme){
var isTheme=function(value){return value==="light"||value==="dark"||value==="system";};
var decode=function(value){try{return decodeURIComponent(value);}catch(_error){return value;}};
var readCookie=function(){var entries=document.cookie.split(";");for(var index=0;index<entries.length;index++){var entry=entries[index];var separator=entry.indexOf("=");if(separator<0)continue;if(decode(entry.slice(0,separator).trim())===config.storageKey)return decode(entry.slice(separator+1).trim());}};
var media=window.matchMedia("(prefers-color-scheme: dark)");
var resolveTheme=function(theme){return theme==="system"?(media.matches?"dark":"light"):theme;};
var storedTheme=readCookie();
var preference=isTheme(storedTheme)?storedTheme:config.default;
var serverSnapshot={theme:serverTheme,resolvedTheme:serverTheme==="system"?undefined:serverTheme,mounted:false};
var apply=function(){var resolvedTheme=resolveTheme(preference);document.documentElement.dataset.theme=resolvedTheme;var snapshot={theme:preference,resolvedTheme:resolvedTheme,mounted:true};if(window.__FARM_THEME__)window.__FARM_THEME__.snapshot=snapshot;return snapshot;};
var emit=function(){var snapshot=apply();window.dispatchEvent(new CustomEvent("farm:themechange",{detail:snapshot}));};
var persist=function(theme){var secure=window.location.protocol==="https:"?"; Secure":"";document.cookie=encodeURIComponent(config.storageKey)+"="+encodeURIComponent(theme)+"; Path="+config.cookiePath+"; Max-Age=31536000; SameSite=Lax"+secure;try{localStorage.setItem(config.storageKey,theme);}catch(_error){}};
var setTheme=function(theme){if(!isTheme(theme))throw new TypeError("Unknown FARMJS theme: "+String(theme));preference=theme;persist(theme);emit();};
var initialSnapshot={theme:preference,resolvedTheme:resolveTheme(preference),mounted:true};
window.__FARM_THEME__={config:config,serverSnapshot:serverSnapshot,snapshot:initialSnapshot,setTheme:setTheme};
document.documentElement.dataset.theme=initialSnapshot.resolvedTheme;
var handleSystemChange=function(){if(preference==="system")emit();};
if(typeof media.addEventListener==="function")media.addEventListener("change",handleSystemChange);else if(typeof media.addListener==="function")media.addListener(handleSystemChange);
window.addEventListener("storage",function(event){if(event.key!==config.storageKey||!isTheme(event.newValue))return;preference=event.newValue;persist(preference);emit();});
})(${serializeInlineValue(config)},${serializeInlineValue(serverTheme)});`;
}

export function applyFarmThemeDocument(
  html: string,
  input: FarmThemeConfig | ResolvedFarmThemeConfig | false | undefined,
  basePath = "/",
  serverTheme?: FarmThemePreference,
): string {
  const parts = createFarmThemeDocumentParts(input, basePath, serverTheme);
  if (!parts.head) return html;

  let output = html.replace(/<html([^>]*)>/i, (_match, attributes: string) => {
    const nextAttributes = attributes.replace(/\sdata-theme=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    return `<html${nextAttributes}${parts.attributes}>`;
  });

  if (!output.includes(`id="${THEME_SCRIPT_ID}"`)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1>${parts.head}`);
  }

  return output;
}

function serializeInlineValue(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

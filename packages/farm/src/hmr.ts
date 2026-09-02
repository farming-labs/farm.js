import type { ViteDevServer, ModuleNode } from "vite";
import { toPosixPath } from "./utils";

export class HMRManager {
  private server: ViteDevServer;

  constructor(server: ViteDevServer) {
    this.server = server;
  }

  /**
   * Send HMR update to client
   */
  async send(payload: any) {
    this.server.ws.send(payload);
  }

  /**
   * Trigger full page reload
   */
  async reloadPage() {
    this.server.ws.send({
      type: "full-reload",
      path: "*",
    });
  }

  /**
   * Handle file change and trigger HMR
   */
  async handleFileChange(file: string) {
    const module = await this.server.moduleGraph.getModuleByUrl(file);
    const normalizedFile = toPosixPath(file);

    if (!module) {
      return;
    }

    // Invalidate module
    this.server.moduleGraph.invalidateModule(module);

    // Get affected modules
    const affectedModules = this.getAffectedModules(module);

    if (affectedModules.size === 0) {
      return;
    }

    if (
      normalizedFile.includes("/app/") &&
      /\/page\.(?:tsx?|jsx?|vue|svelte)$/.test(normalizedFile)
    ) {
      await this.reloadPage();
      return;
    }

    if (
      normalizedFile.includes("/app/") &&
      /\/layout\.(?:tsx?|jsx?|vue|svelte)$/.test(normalizedFile)
    ) {
      await this.reloadPage();
      return;
    }
    // Send update for other files
    this.send({
      type: "update",
      updates: Array.from(affectedModules).map((m) => ({
        type: m.type === "css" ? "css-update" : "js-update",
        path: m.url,
        acceptedPath: m.url,
        timestamp: Date.now(),
      })),
    });
  }

  /**
   * Get all affected modules in the dependency graph
   */
  private getAffectedModules(module: ModuleNode): Set<ModuleNode> {
    const affected = new Set<ModuleNode>();
    const seen = new Set<ModuleNode>();

    const traverse = (mod: ModuleNode) => {
      if (seen.has(mod)) return;
      seen.add(mod);
      affected.add(mod);

      // A self-accepting module is the HMR boundary: it re-runs with the
      // update, so nothing above it is affected.
      if (mod.isSelfAccepting) return;

      for (const importer of mod.importers) {
        // An importer that accepts this dependency is likewise a boundary:
        // it receives the update, but its own importers do not. Accepting is
        // per-edge, so the importer stays traversable via other dependencies.
        if (importer.acceptedHmrDeps?.has(mod)) {
          affected.add(importer);
          continue;
        }
        traverse(importer);
      }
    };

    traverse(module);
    return affected;
  }

  /**
   * Handle custom HMR events from client
   */
  onClientMessage(event: string, callback: (data: any) => void) {
    // Vite handles this via ws.on
  }
}

/**
 * Create HMR client code for injection
 */
export function createHMRClientCode(): string {
  return `
// Farm.js HMR Client
if (import.meta.hot) {
  // Accept HMR updates for this module
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      // Module updated, trigger re-render
      window.location.reload();
    }
  });

  // Listen for custom Farm.js events
  import.meta.hot.on('farm:route-update', (data) => {
    console.log('Route updated:', data.path);
    window.location.reload();
  });

  // Handle CSS updates
  import.meta.hot.on('vite:beforeUpdate', () => {
    console.log('[Farm.js] HMR update incoming...');
  });

  import.meta.hot.on('vite:afterUpdate', () => {
    console.log('[Farm.js] HMR update applied ✓');
  });

  // Handle errors
  import.meta.hot.on('vite:error', (err) => {
    console.error('[Farm.js] HMR error:', err);
  });
}
`;
}

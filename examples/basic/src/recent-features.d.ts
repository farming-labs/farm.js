import type {} from '@farmjs/core';

declare module '@farmjs/core' {
  interface FarmAppContext {
    tenant: {
      id: string;
    };
    requestId: string;
  }
}

export {};

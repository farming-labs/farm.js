import type {} from '@farm.js/core';

declare module '@farm.js/core' {
  interface FarmAppContext {
    tenant: {
      id: string;
    };
    requestId: string;
  }
}

export {};

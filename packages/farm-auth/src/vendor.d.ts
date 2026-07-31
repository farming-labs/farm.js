declare module "pg" {
  export class Pool {
    constructor(options?: { connectionString?: string });
  }
}

declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
  }
}

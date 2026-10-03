/** Application binding contract; Wrangler owns provisioning, not this file. */
export {};

declare global {
  interface CloudflareEnv {
    DB: import('./src/db/d1/binding').D1Binding;
  }
}

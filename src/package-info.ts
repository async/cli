export const packageInfo = Object.freeze({
  name: "@async/cli",
  version: "0.3.0",
  node: ">=24",
  deno: ">=2.7",
  runtimes: ["node", "deno"] as const,
  binaries: ["cli", "async-cli"] as const,
  specVersion: 4,
  routerStatus: "implemented",
  contextPointerStatus: "implemented"
});

export type AsyncCliPackageInfo = typeof packageInfo;

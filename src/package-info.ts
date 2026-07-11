export const packageInfo = Object.freeze({
  name: "@async/cli",
  version: "0.3.0",
  node: ">=24",
  binaries: ["cli", "async-cli"] as const,
  specVersion: 3,
  routerStatus: "implemented",
  contextPointerStatus: "implemented"
});

export type AsyncCliPackageInfo = typeof packageInfo;

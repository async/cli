export const packageInfo = Object.freeze({
  name: "@async/cli",
  version: "0.2.3",
  node: ">=24",
  binaries: ["cli", "async-cli"] as const,
  specVersion: 2,
  routerStatus: "implemented",
  contextPointerStatus: "implemented"
});

export type AsyncCliPackageInfo = typeof packageInfo;

import type { DiscoverRootsOptions } from "./router.js";
export type OverlayTrustState = "trusted" | "changed" | "untrusted";
export interface OverlayTrust {
    path: string;
    state: OverlayTrustState;
}
export declare function isTrustEnforced(env?: NodeJS.ProcessEnv): boolean;
export declare function trustStorePath(options?: DiscoverRootsOptions): string;
export declare function hashOverlayTree(overlayPath: string): Promise<string>;
export declare function overlayTrustState(options: DiscoverRootsOptions, overlayPath: string): Promise<OverlayTrustState>;
export declare function ensureOverlayTrusted(options: DiscoverRootsOptions, overlayPath: string): Promise<void>;
export declare function recordOverlayTrust(options: DiscoverRootsOptions, overlayPath: string): Promise<void>;
export declare function removeOverlayTrust(options: DiscoverRootsOptions, overlayPath: string): Promise<boolean>;
export declare function refreshOverlayTrustIfKnown(options: DiscoverRootsOptions, overlayPath: string): Promise<void>;
export declare function trustLocalOverlays(options?: DiscoverRootsOptions): Promise<OverlayTrust[]>;
export declare function untrustLocalOverlays(options?: DiscoverRootsOptions): Promise<OverlayTrust[]>;
export declare function localOverlayTrust(options?: DiscoverRootsOptions): Promise<OverlayTrust[]>;
//# sourceMappingURL=trust.d.ts.map
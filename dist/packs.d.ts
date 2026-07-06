import type { CommandRoot, DiscoverRootsOptions } from "./router.js";
export interface AddPackOptions extends DiscoverRootsOptions {
    to?: "root" | "local";
    prefix?: string;
    force?: boolean;
}
export interface AddPackResult {
    source: string;
    root: CommandRoot;
    installed: string[];
}
export declare function addPack(options: AddPackOptions | undefined, source: string): Promise<AddPackResult>;
//# sourceMappingURL=packs.d.ts.map
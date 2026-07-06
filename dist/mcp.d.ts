import type { DiscoverRootsOptions } from "./router.js";
export interface McpIo {
    input: NodeJS.ReadableStream;
    output: Pick<NodeJS.WriteStream, "write">;
}
export declare function runMcpServer(options?: DiscoverRootsOptions, io?: McpIo): Promise<number>;
//# sourceMappingURL=mcp.d.ts.map
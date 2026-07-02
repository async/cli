import type { CliIo } from "./cli.js";
export declare const managedAgentsBlock: string;
interface AgentsOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}
export declare function handleAgentsCommand(args: string[], io: CliIo, options?: AgentsOptions): Promise<number>;
export {};
//# sourceMappingURL=agents.d.ts.map
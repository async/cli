#!/usr/bin/env node
export interface CliIo {
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
}
export declare function main(argv?: string[], io?: CliIo): Promise<number>;
//# sourceMappingURL=cli.d.ts.map
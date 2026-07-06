import type { ListCommandsOptions } from "./router.js";
export type CompletionShell = "bash" | "zsh" | "fish";
export declare const builtinFlags: readonly string[];
export declare function complete(options: ListCommandsOptions | undefined, words: string[]): Promise<string[]>;
export declare function completionScript(shell: string): string;
//# sourceMappingURL=completions.d.ts.map
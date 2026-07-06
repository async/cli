export type CliErrorCode = "AMBIGUOUS_SCRIPT" | "MISSING_GIT_ROOT" | "PARTIAL_NAMESPACE" | "UNKNOWN_COMMAND" | "UNSAFE_SEGMENT" | "TARGET_EXISTS" | "SOURCE_NOT_FOUND" | "UNTRUSTED_OVERLAY" | "TEMPLATE_NOT_FOUND" | "TEMPLATE_INVALID" | "PACK_INVALID" | "GIT_FAILED" | "EDITOR_FAILED" | "INVALID_ARGS";
export declare class CliError extends Error {
    readonly code: CliErrorCode;
    readonly exitCode: number;
    readonly suggestions: string[];
    readonly subcommands: string[];
    readonly files: string[];
    constructor(code: CliErrorCode, message: string, details?: {
        exitCode?: number;
        suggestions?: string[];
        subcommands?: string[];
        files?: string[];
    });
}
//# sourceMappingURL=errors.d.ts.map
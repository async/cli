export class CliError extends Error {
    code;
    exitCode;
    suggestions;
    subcommands;
    files;
    constructor(code, message, details = {}) {
        super(message);
        this.name = "CliError";
        this.code = code;
        this.exitCode = details.exitCode ?? 2;
        this.suggestions = details.suggestions ?? [];
        this.subcommands = details.subcommands ?? [];
        this.files = details.files ?? [];
    }
}
//# sourceMappingURL=errors.js.map
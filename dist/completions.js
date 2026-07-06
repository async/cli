import { CliError } from "./errors.js";
import { listCommands } from "./router.js";
export const builtinFlags = [
    "help",
    "--add",
    "--agents",
    "--complete",
    "--completions",
    "--cp",
    "--doctor",
    "--edit",
    "--help",
    "--list",
    "--mcp",
    "--mv",
    "--new",
    "--rm",
    "--trust",
    "--untrust",
    "--version",
    "--which"
];
export async function complete(options = {}, words) {
    const partial = words[words.length - 1] ?? "";
    const prior = words.slice(0, -1);
    if (prior.length === 0 && partial.startsWith("-")) {
        return builtinFlags.filter((flag) => flag.startsWith(partial)).sort();
    }
    const listing = await listCommands(options);
    const candidates = new Set();
    for (const entry of listing.commands) {
        if (entry.shadowed) {
            continue;
        }
        const segments = entry.command.split(" ");
        if (segments.length <= prior.length) {
            continue;
        }
        if (!prior.every((word, index) => segments[index] === word)) {
            continue;
        }
        const next = segments[prior.length];
        if (next && next.startsWith(partial)) {
            candidates.add(next);
        }
    }
    return [...candidates].sort();
}
export function completionScript(shell) {
    if (shell === "bash") {
        return bashScript;
    }
    if (shell === "zsh") {
        return zshScript;
    }
    if (shell === "fish") {
        return fishScript;
    }
    throw new CliError("INVALID_ARGS", `Unsupported completion shell: ${shell}. Use bash, zsh, or fish.`);
}
const bashScript = `# async/cli bash completions
# Load with: eval "$(cli --completions bash)"
_async_cli_complete() {
  local IFS=$'\\n'
  local words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  COMPREPLY=($(compgen -W "$(cli --complete -- "\${words[@]}" 2>/dev/null)" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -F _async_cli_complete cli async-cli
`;
const zshScript = `# async/cli zsh completions
# Load with: eval "$(cli --completions zsh)"
_async_cli_complete() {
  local -a completions
  completions=(\${(f)"$(cli --complete -- \${words[2,CURRENT]} 2>/dev/null)"})
  compadd -- \${completions[@]}
}
compdef _async_cli_complete cli async-cli
`;
const fishScript = `# async/cli fish completions
# Load with: cli --completions fish | source
function __async_cli_complete
  set -l words (commandline -opc)
  set -l current (commandline -ct)
  cli --complete -- $words[2..] $current 2>/dev/null
end
complete -c cli -f -a '(__async_cli_complete)'
complete -c async-cli -f -a '(__async_cli_complete)'
`;
//# sourceMappingURL=completions.js.map
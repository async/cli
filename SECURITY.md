# Security boundaries

`@async/cli` runs JavaScript and TypeScript command files with the current
user's privileges. Command authors and users should treat a command the same
way they treat a package script or Makefile target.

## Command trust

The user-global command root is trusted operator-owned configuration. Local
`.cli` overlays are untrusted until the user approves their complete content
with `cli --trust`. The recorded digest includes regular files, symlink paths,
and the contents of symlinked files and directories. Cyclic directory links
are rejected. Any covered content change blocks local execution until the
overlay is reviewed and trusted again.

`ASYNC_CLI_TRUST=off` deliberately disables this boundary and is intended only
for controlled environments.

## Inspection boundary

`cli --list --json`, `cli --which`, help, completions, and doctor inspect the
live command trees without executing scripts or requiring overlay trust.
Machine consumers should use `cli --list --json` for command discovery and
invoke commands explicitly through `cli <words...> [args...]`, where the same
trust gate applies as for interactive use.

## Reporting

Please report suspected vulnerabilities through the repository's private
security advisory flow rather than a public issue.

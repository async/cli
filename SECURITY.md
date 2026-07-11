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

## MCP boundary

`cli --mcp` is an explicit local stdio execution surface. Starting it grants
the connected MCP client permission to invoke every listed trusted command and
to pass arguments to those commands. The trust gate verifies command content;
it is not per-call authorization for the connected client.

Do not proxy or bridge the MCP stdio stream to an untrusted party. Apply tool
approval and argument policy in the MCP host when commands require narrower
authorization.

## Reporting

Please report suspected vulnerabilities through the repository's private
security advisory flow rather than a public issue.

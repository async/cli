import { executeResolution, resolveCommand } from "./router.js";
import type { RunCommandOptions } from "./router.js";
import { ensureOverlayTrusted } from "./trust.js";

export async function runCommand(options: RunCommandOptions = {}, args: string[]): Promise<number> {
  const resolution = await resolveCommand(options, args);
  if (resolution.root.scope === "local") {
    await ensureOverlayTrusted(options, resolution.root.path);
  }
  return await executeResolution(resolution, options);
}

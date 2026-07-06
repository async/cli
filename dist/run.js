import { executeResolution, resolveCommand } from "./router.js";
import { ensureOverlayTrusted } from "./trust.js";
export async function runCommand(options = {}, args) {
    const resolution = await resolveCommand(options, args);
    if (resolution.root.scope === "local") {
        await ensureOverlayTrusted(options, resolution.root.path);
    }
    return await executeResolution(resolution, options);
}
//# sourceMappingURL=run.js.map
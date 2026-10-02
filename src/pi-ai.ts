import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { resolve } from "import-meta-resolve";

/**
 * Pi 1.0's Jiti loader aliases the pi-ai root to compat.js and incorrectly appends
 * public subpaths to that file in peerless Git installs. Resolve those PUBLIC exports
 * from the host coding-agent entry instead. No node_modules layout or private file path
 * is assumed. Native ESM import preserves the host module cache and socket lifecycle.
 */
// import.meta.resolve in Jiti resolves from the extension, not its host alias.
// The public host asset root also works for peerless, non-TSX CLI installations.
const hostEntry = resolve(
  "@earendil-works/pi-coding-agent",
  pathToFileURL(join(getPackageDir(), "package.json")).href,
);
const codexExport = "@earendil-works/pi-ai/api/openai-codex-responses";
const sharedExport = "@earendil-works/pi-ai/api/openai-responses-shared";
const codex = (await import(
  resolve(codexExport, hostEntry)
)) as typeof import("@earendil-works/pi-ai/api/openai-codex-responses");
const shared = (await import(
  resolve(sharedExport, hostEntry)
)) as typeof import("@earendil-works/pi-ai/api/openai-responses-shared");
export const codexStream = codex.streamSimple;
export const convertResponsesMessages = shared.convertResponsesMessages;
export function resolvePiEntry(name: string): string {
  return name === "@earendil-works/pi-ai"
    ? fileURLToPath(resolve(codexExport, hostEntry))
    : fileURLToPath(hostEntry);
}

import { linkedProjectIdFor } from "./project-link.js";

export const DPAI_CLI_VERSION = "0.3.1";

/**
 * `project` names the target project explicitly (`null` sends none);
 * otherwise, with `apiUrl`, the folder's `.dpai/project.json` decides.
 */
export function createCliRequestHeaders(
  apiKey: string,
  additional: Record<string, string> = {},
  target: { apiUrl?: string; project?: string | null } = {},
): Record<string, string> {
  const harness = detectAgentHarness();
  const harnessVersion = cleanHeader(process.env.DPAI_AGENT_VERSION, 40);
  const project = target.project === undefined && target.apiUrl
    ? linkedProjectIdFor(target.apiUrl)
    : target.project ?? undefined;
  return {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": `desainpakeai-cli/${DPAI_CLI_VERSION}`,
    "X-DPAI-CLI-Version": DPAI_CLI_VERSION,
    ...(harness ? { "X-DPAI-Agent": harness } : {}),
    ...(harnessVersion ? { "X-DPAI-Agent-Version": harnessVersion } : {}),
    ...(project ? { "X-DPAI-Project": project } : {}),
    ...additional,
  };
}

export function detectAgentHarness(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const explicit = cleanHeader(environment.DPAI_AGENT_HARNESS, 80);
  if (explicit) return explicit;
  if (environment.CODEX_HOME || environment.CODEX_SANDBOX_NETWORK_DISABLED) return "codex";
  if (environment.CLAUDECODE) return "claude-code";
  if (environment.CURSOR_AGENT || environment.CURSOR_TRACE_ID) return "cursor-agent";
  if (environment.GEMINI_CLI || environment.GEMINI_CLI_HOME) return "gemini-cli";
  if (environment.OPENCODE || environment.OPENCODE_CLIENT) return "opencode";
  if (environment.WINDSURF || environment.CODEIUM_AGENT) return "windsurf";
  if (environment.TERM_PROGRAM?.toLocaleLowerCase("en-US") === "vscode") return "vscode";
  return undefined;
}

function cleanHeader(value: string | undefined, maxLength: number) {
  const normalized = value?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export const AGENT_PAGE_STATE_SCHEMA_VERSION = 1 as const;
export const AGENT_PAGE_STATE_TTL_MS = 30 * 60 * 1000;

export type AgentPageActivity = "creating" | "updating";

export type AgentPageWork = {
  activity: AgentPageActivity;
  startedAt: string;
  status: "working";
  updatedAt: string;
};

export type AgentPageStateFile = {
  schemaVersion: typeof AGENT_PAGE_STATE_SCHEMA_VERSION;
  pages: Record<string, AgentPageWork>;
};

export function createEmptyAgentPageState(): AgentPageStateFile {
  return { schemaVersion: AGENT_PAGE_STATE_SCHEMA_VERSION, pages: {} };
}

export function parseAgentPageState(
  value: unknown,
  pageIds: string[],
  now = Date.now(),
): AgentPageStateFile {
  if (!isRecord(value) || value.schemaVersion !== AGENT_PAGE_STATE_SCHEMA_VERSION || !isRecord(value.pages)) {
    throw new Error("Agent page state must contain schemaVersion 1 and a pages object.");
  }

  const knownPages = new Set(pageIds);
  const pages: Record<string, AgentPageWork> = {};
  for (const [pageId, candidate] of Object.entries(value.pages)) {
    if (!knownPages.has(pageId) || !isAgentPageWork(candidate)) continue;
    const updatedAt = Date.parse(candidate.updatedAt);
    if (!Number.isFinite(updatedAt) || now - updatedAt > AGENT_PAGE_STATE_TTL_MS) continue;
    pages[pageId] = candidate;
  }

  return { schemaVersion: AGENT_PAGE_STATE_SCHEMA_VERSION, pages };
}

function isAgentPageWork(value: unknown): value is AgentPageWork {
  return isRecord(value)
    && value.status === "working"
    && (value.activity === "creating" || value.activity === "updating")
    && typeof value.startedAt === "string"
    && Number.isFinite(Date.parse(value.startedAt))
    && typeof value.updatedAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

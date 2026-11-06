import { dirname } from "node:path";
import { z } from "zod";
import {
  deleteStoredCredential,
  getCredentialPath,
  maskApiKey,
  normalizeApiUrl,
  resolveCredential,
  writeStoredCredential,
  type CredentialOverrides,
} from "./credentials.js";
import { CliConfigurationError } from "./errors.js";
import { createCliRequestHeaders } from "./client-metadata.js";
import { findProjectLink, linkedProjectIdFor, writeProjectLink } from "./project-link.js";

const sessionSchema = z.object({
  authenticated: z.literal(true),
  apiKey: z.object({ id: z.string().uuid() }).strict(),
  project: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    role: z.string().min(1),
  }).strict(),
}).strict();

export type CliSession = z.infer<typeof sessionSchema>;

export async function login(options: CredentialOverrides) {
  const credential = await resolveCredential(options);
  const session = await fetchCliSession(credential.apiUrl, credential.apiKey);
  const credentialPath = await writeStoredCredential({
    apiKey: credential.apiKey,
    apiKeyId: session.apiKey.id,
    apiUrl: credential.apiUrl,
    project: session.project,
    validatedAt: new Date().toISOString(),
    version: 1,
  });
  return publicSession(session, credential.apiUrl, credential.apiKey, credentialPath);
}

export async function authStatus(options: CredentialOverrides = {}) {
  try {
    const credential = await resolveCredential(options);
    const session = await fetchCliSession(credential.apiUrl, credential.apiKey);
    if (credential.stored) {
      await writeStoredCredential({
        ...credential.stored,
        apiKey: credential.apiKey,
        apiKeyId: session.apiKey.id,
        apiUrl: credential.apiUrl,
        project: session.project,
        validatedAt: new Date().toISOString(),
      });
    }
    return publicSession(
      session,
      credential.apiUrl,
      credential.apiKey,
      credential.stored ? getCredentialPath() : null,
    );
  } catch (error) {
    if (error instanceof CliConfigurationError && error.code === "AUTH_REQUIRED") {
      return { authenticated: false, credentialPath: getCredentialPath() };
    }
    throw error;
  }
}

export async function currentProject(options: CredentialOverrides = {}) {
  const credential = await resolveCredential(options);
  const session = await fetchCliSession(credential.apiUrl, credential.apiKey);
  const found = findProjectLink();
  const linked = found && linkedProjectIdFor(credential.apiUrl) === session.project.id;
  return {
    apiUrl: credential.apiUrl,
    project: session.project,
    // Where the choice came from: this folder's link, or the account default.
    projectLink: linked ? found.path : null,
  };
}

const projectListSchema = z.object({
  projects: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    role: z.string().min(1),
    updatedAt: z.string(),
  }).passthrough()),
  total: z.number().int().nonnegative(),
}).passthrough();

/** The user's projects, most recently changed first, for choosing a folder's design. */
export async function listProjects(options: CredentialOverrides & { query?: string } = {}) {
  const credential = await resolveCredential(options);
  const apiUrl = credential.apiUrl.replace(/\/$/, "");
  const search = options.query ? `?query=${encodeURIComponent(options.query)}` : "";
  const response = await fetch(`${apiUrl}/api/cli/projects${search}`, {
    // Listing must work even when this folder's link points at a project that is gone.
    headers: createCliRequestHeaders(credential.apiKey, {}, { project: null }),
  });
  const parsed = projectListSchema.safeParse(await readJsonResponse(response));
  if (!parsed.success) {
    throw new CliConfigurationError("INVALID_PROJECT_LIST_RESPONSE", "The DesainPakeAI project list response is invalid.");
  }
  return {
    projects: parsed.data.projects.map(({ id, name, role, updatedAt }) => ({ id, name, role, updatedAt })),
    total: parsed.data.total,
  };
}

/** Links the current folder to a project after the server confirms access to it. */
export async function useProject(projectId: string, options: CredentialOverrides = {}) {
  const credential = await resolveCredential(options);
  const session = await fetchCliSession(credential.apiUrl, credential.apiKey, { project: projectId });
  const projectLink = await writeProjectLink({ apiUrl: credential.apiUrl, project: session.project }, linkDirectoryFor(credential.apiUrl));
  return { apiUrl: credential.apiUrl, project: session.project, projectLink };
}

/** Rewrites the nearest link for this server in place; otherwise the current folder gets one. */
export function linkDirectoryFor(apiUrl: string) {
  const found = findProjectLink();
  if (found && normalizeApiUrl(found.link.apiUrl) === normalizeApiUrl(apiUrl)) {
    return dirname(dirname(found.path));
  }
  return process.cwd();
}

export async function logout() {
  const result = await deleteStoredCredential();
  return {
    authenticated: false,
    credentialPath: result.path,
    removed: result.removed,
  };
}

const openLinkSchema = z.object({
  expiresAt: z.string().datetime(),
  path: z.string().startsWith("/cli/open#t="),
}).passthrough();

/**
 * Mints a one-time link that signs a browser in and opens the active project's
 * canvas, so an agent can open it in its own browser. It expires in minutes
 * and dies on first use.
 */
export async function createOpenLink(options: CredentialOverrides = {}) {
  const credential = await resolveCredential(options);
  const apiUrl = credential.apiUrl.replace(/\/$/, "");
  const response = await fetch(`${apiUrl}/api/cli/open-link`, {
    headers: createCliRequestHeaders(credential.apiKey, {}, { apiUrl }),
    method: "POST",
  });
  const parsed = openLinkSchema.safeParse(await readJsonResponse(response));
  if (!parsed.success) {
    throw new CliConfigurationError(
      "INVALID_OPEN_LINK_RESPONSE",
      "The DesainPakeAI open-link response is invalid.",
      "Update the CLI or check that --api-url points at DesainPakeAI.",
    );
  }
  return { expiresAt: parsed.data.expiresAt, openUrl: `${apiUrl}${parsed.data.path}` };
}

/**
 * The project defaults to this folder's link; `project` overrides it (`null`
 * asks for the account's active project, as a fresh browser approval does).
 */
export async function fetchCliSession(
  apiUrl: string,
  apiKey: string,
  target: { project?: string | null } = {},
): Promise<CliSession> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/cli/session`, {
    headers: createCliRequestHeaders(apiKey, {}, { apiUrl, ...target }),
  });
  const payload = await readJsonResponse(response);
  const parsed = sessionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CliConfigurationError(
      "INVALID_SESSION_RESPONSE",
      "The DesainPakeAI CLI session response is invalid.",
    );
  }
  return parsed.data;
}

export async function readJsonResponse(response: Response) {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    const error = isRecord(record.error) ? record.error : record;
    const details = isRecord(error.details) ? error.details : {};
    throw new CliConfigurationError(
      typeof error.code === "string" ? error.code : `HTTP_${response.status}`,
      typeof error.message === "string" ? error.message : `HTTP request failed with ${response.status}.`,
      typeof error.suggestion === "string"
        ? error.suggestion
        : typeof details.suggestion === "string"
          ? details.suggestion
          : undefined,
      { httpStatus: response.status, ...details },
    );
  }
  return payload;
}

function publicSession(
  session: CliSession,
  apiUrl: string,
  apiKey: string,
  credentialPath: string | null,
) {
  return {
    apiKey: {
      id: session.apiKey.id,
      masked: maskApiKey(apiKey),
    },
    apiUrl,
    authenticated: true,
    credentialPath,
    project: session.project,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

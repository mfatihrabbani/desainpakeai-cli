import { z } from "zod";
import {
  deleteStoredCredential,
  getCredentialPath,
  maskApiKey,
  resolveCredential,
  writeStoredCredential,
  type CredentialOverrides,
} from "./credentials.js";
import { CliConfigurationError } from "./errors.js";
import { createCliRequestHeaders } from "./client-metadata.js";

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
  return {
    apiUrl: credential.apiUrl,
    project: session.project,
  };
}

export async function logout() {
  const result = await deleteStoredCredential();
  return {
    authenticated: false,
    credentialPath: result.path,
    removed: result.removed,
  };
}

export async function fetchCliSession(apiUrl: string, apiKey: string): Promise<CliSession> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/cli/session`, {
    headers: createCliRequestHeaders(apiKey),
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

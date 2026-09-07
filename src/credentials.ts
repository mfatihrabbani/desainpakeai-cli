import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CliConfigurationError } from "./errors.js";

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: z.string().min(1),
}).strict();

const credentialSchema = z.object({
  apiKey: z.string().startsWith("dpai_"),
  apiKeyId: z.string().uuid(),
  apiUrl: z.string().url(),
  project: projectSchema,
  validatedAt: z.string().datetime(),
  version: z.literal(1),
}).strict();

export type CliProject = z.infer<typeof projectSchema>;
export type StoredCredential = z.infer<typeof credentialSchema>;

export type CredentialOverrides = {
  apiKey?: string;
  apiUrl?: string;
};

export async function readStoredCredential(): Promise<StoredCredential | null> {
  try {
    const value = JSON.parse(await readFile(getCredentialPath(), "utf8"));
    return credentialSchema.parse(value);
  } catch (error) {
    if (isMissingFile(error)) return null;
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new CliConfigurationError(
        "INVALID_CREDENTIAL_FILE",
        `The credential file at ${getCredentialPath()} is invalid.`,
        "Run 'dpai auth logout', then log in again.",
      );
    }
    throw error;
  }
}

export async function resolveCredential(
  overrides: CredentialOverrides = {},
): Promise<{ apiKey: string; apiUrl: string; stored: StoredCredential | null }> {
  const stored = await readStoredCredential();
  const apiKey = overrides.apiKey ?? process.env.DPAI_API_KEY ?? stored?.apiKey;
  const apiUrl = overrides.apiUrl ?? process.env.DPAI_API_URL ?? stored?.apiUrl;
  if (!apiKey || !apiUrl) {
    throw new CliConfigurationError(
      "AUTH_REQUIRED",
      "DesainPakeAI CLI authentication is required.",
      "Run 'dpai auth login --api-url <url> --api-key <dpai_key>' or set DPAI_API_URL and DPAI_API_KEY.",
    );
  }
  return { apiKey, apiUrl: normalizeApiUrl(apiUrl), stored };
}

export async function writeStoredCredential(value: StoredCredential) {
  const credential = credentialSchema.parse(value);
  const path = getCredentialPath();
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(credential, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  return path;
}

export async function deleteStoredCredential() {
  const path = getCredentialPath();
  const removed = await unlink(path).then(() => true).catch((error) => {
    if (isMissingFile(error)) return false;
    throw error;
  });
  return { path, removed };
}

export function getCredentialPath() {
  const configured = process.env.DPAI_CONFIG_HOME;
  if (configured) return resolve(configured, "credentials.json");
  if (process.platform === "win32" && process.env.APPDATA) {
    return resolve(process.env.APPDATA, "DesainPakeAI", "credentials.json");
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config");
  return resolve(configHome, "desainpakeai", "credentials.json");
}

export function maskApiKey(value: string) {
  return value.length <= 12
    ? `${value.slice(0, 5)}…`
    : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function normalizeApiUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliConfigurationError("INVALID_API_URL", "The DesainPakeAI API URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliConfigurationError("INVALID_API_URL", "The API URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

function isMissingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

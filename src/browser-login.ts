import { spawn } from "node:child_process";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { fetchCliSession, readJsonResponse } from "./auth-client.js";
import { detectAgentHarness, DPAI_CLI_VERSION } from "./client-metadata.js";
import {
  getCredentialPath,
  maskApiKey,
  normalizeApiUrl,
  readStoredCredential,
  writeStoredCredential,
} from "./credentials.js";
import { CliConfigurationError } from "./errors.js";

export const DEFAULT_API_URL = "https://desainpakeai.com";
/** Below the two-minute shell timeout most agent harnesses use; a rerun resumes the same code. */
export const DEFAULT_LOGIN_WAIT_SECONDS = 110;

const pendingSchema = z.object({
  apiUrl: z.string().url(),
  deviceCode: z.string().startsWith("dpai_login_"),
  expiresAt: z.string().datetime(),
  interval: z.number().int().min(1).max(30),
  userCode: z.string().min(1),
  verificationUrl: z.string().url(),
}).strict();

type PendingLogin = z.infer<typeof pendingSchema>;

const startSchema = z.object({
  deviceCode: z.string(),
  expiresAt: z.string(),
  interval: z.number(),
  userCode: z.string(),
  verificationPath: z.string().startsWith("/"),
}).passthrough();

const redeemSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }).passthrough(),
  z.object({
    apiKey: z.string().startsWith("dpai_"),
    apiKeyId: z.string().uuid(),
    canvasPath: z.string().startsWith("/"),
    status: z.literal("approved"),
  }).passthrough(),
]);

export type BrowserLoginOptions = {
  apiUrl?: string;
  noBrowser?: boolean;
  waitSeconds?: number;
};

export type BrowserLoginDependencies = {
  fetch: typeof fetch;
  log: (line: string) => void;
  now: () => number;
  openUrl: (url: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
};

const defaultDependencies: BrowserLoginDependencies = {
  fetch: (input, init) => fetch(input, init),
  log: (line) => process.stderr.write(`${line}\n`),
  now: () => Date.now(),
  openUrl: openInBrowser,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

/**
 * Signs the CLI in through a browser: the person approves a short code on
 * DesainPakeAI, picks a project, and lands on its canvas while this process
 * receives a fresh access key. The key never passes through the agent's chat.
 */
export async function browserLogin(
  options: BrowserLoginOptions = {},
  dependencies: BrowserLoginDependencies = defaultDependencies,
) {
  const apiUrl = await resolveLoginApiUrl(options.apiUrl);
  let pending = await readPendingLogin(apiUrl, dependencies.now());
  let opened = false;
  if (pending) {
    dependencies.log(`Masih menunggu persetujuan di browser: ${pending.verificationUrl} (kode ${pending.userCode}).`);
  } else {
    pending = await startPendingLogin(apiUrl, dependencies);
    opened = options.noBrowser ? false : await dependencies.openUrl(pending.verificationUrl);
    dependencies.log(opened
      ? `Browser dibuka. Pastikan kode di halaman sama dengan ${pending.userCode}, lalu klik "Izinkan & buka canvas".`
      : `Buka ${pending.verificationUrl} di browser dan pastikan kodenya ${pending.userCode}.`);
  }

  const waitMs = Math.max(1, options.waitSeconds ?? DEFAULT_LOGIN_WAIT_SECONDS) * 1000;
  const deadline = Math.min(dependencies.now() + waitMs, Date.parse(pending.expiresAt));
  while (dependencies.now() < deadline) {
    const outcome = await pollPendingLogin(pending, dependencies);
    if (outcome.status === "approved") {
      await deletePendingLogin();
      const session = await fetchCliSession(apiUrl, outcome.apiKey);
      const credentialPath = await writeStoredCredential({
        apiKey: outcome.apiKey,
        apiKeyId: session.apiKey.id,
        apiUrl,
        project: session.project,
        validatedAt: new Date(dependencies.now()).toISOString(),
        version: 1,
      });
      return {
        apiKey: { id: session.apiKey.id, masked: maskApiKey(outcome.apiKey) },
        apiUrl,
        authenticated: true,
        canvasUrl: `${apiUrl}${outcome.canvasPath}`,
        credentialPath,
        project: session.project,
      };
    }
    if (outcome.status === "failed") {
      await deletePendingLogin();
      throw outcome.error;
    }
    await dependencies.sleep(pending.interval * 1000);
  }

  if (dependencies.now() >= Date.parse(pending.expiresAt)) {
    await deletePendingLogin();
    throw new CliConfigurationError("CLI_LOGIN_EXPIRED", "Kode login kedaluwarsa sebelum disetujui.", "Jalankan 'dpai auth login' lagi.");
  }
  throw new CliConfigurationError(
    "LOGIN_PENDING",
    `Masih menunggu persetujuan untuk kode ${pending.userCode}.`,
    `Setujui di ${pending.verificationUrl}, lalu jalankan 'dpai auth login' lagi untuk melanjutkan kode yang sama.`,
    { userCode: pending.userCode, verificationUrl: pending.verificationUrl },
  );
}

export function canvasUrlFor(apiUrl: string, projectId: string) {
  return `${apiUrl}/project/${projectId}/prototype`;
}

/** Explicit flag, then environment, then the last server this machine signed in to, then production. */
export async function resolveLoginApiUrl(explicit?: string) {
  const stored = await readStoredCredential().catch(() => null);
  return normalizeApiUrl(explicit ?? process.env.DPAI_API_URL ?? stored?.apiUrl ?? DEFAULT_API_URL);
}

async function startPendingLogin(apiUrl: string, dependencies: BrowserLoginDependencies): Promise<PendingLogin> {
  const response = await dependencies.fetch(`${apiUrl}/api/cli/login`, {
    body: JSON.stringify({ client: detectAgentHarness() ?? "dpai CLI" }),
    headers: loginHeaders(),
    method: "POST",
  });
  const started = startSchema.parse(await readJsonResponse(response));
  const pending: PendingLogin = {
    apiUrl,
    deviceCode: started.deviceCode,
    expiresAt: new Date(started.expiresAt).toISOString(),
    interval: Math.min(30, Math.max(1, Math.round(started.interval))),
    userCode: started.userCode,
    verificationUrl: `${apiUrl}${started.verificationPath}`,
  };
  await writePendingLogin(pending);
  return pending;
}

type PollOutcome =
  | { status: "pending" }
  | { status: "failed"; error: CliConfigurationError }
  | { status: "approved"; apiKey: string; canvasPath: string };

async function pollPendingLogin(pending: PendingLogin, dependencies: BrowserLoginDependencies): Promise<PollOutcome> {
  let payload: unknown;
  try {
    const response = await dependencies.fetch(`${pending.apiUrl}/api/cli/login/token`, {
      body: JSON.stringify({ deviceCode: pending.deviceCode }),
      headers: loginHeaders(),
      method: "POST",
    });
    payload = await readJsonResponse(response);
  } catch (error) {
    // A client error (denied, expired, used, unknown) ends the wait; network trouble and 5xx retry.
    const status = error instanceof CliConfigurationError ? error.details.httpStatus : undefined;
    if (typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return { status: "failed", error: error as CliConfigurationError };
    }
    return { status: "pending" };
  }
  const parsed = redeemSchema.safeParse(payload);
  if (!parsed.success) return { status: "pending" };
  return parsed.data.status === "approved"
    ? { status: "approved", apiKey: parsed.data.apiKey, canvasPath: parsed.data.canvasPath }
    : { status: "pending" };
}

function loginHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": `desainpakeai-cli/${DPAI_CLI_VERSION}`,
    "X-DPAI-CLI-Version": DPAI_CLI_VERSION,
  };
}

function pendingLoginPath() {
  return resolve(dirname(getCredentialPath()), "login-pending.json");
}

async function readPendingLogin(apiUrl: string, now: number) {
  try {
    const pending = pendingSchema.parse(JSON.parse(await readFile(pendingLoginPath(), "utf8")));
    // Keep a small margin so a resumed wait never starts on a code about to die.
    if (pending.apiUrl === apiUrl && Date.parse(pending.expiresAt) - now > 15_000) return pending;
  } catch {
    // Missing or unreadable state only means there is nothing to resume.
  }
  return null;
}

async function writePendingLogin(value: PendingLogin) {
  const path = pendingLoginPath();
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function deletePendingLogin() {
  await unlink(pendingLoginPath()).catch(() => undefined);
}

/** SSH sessions and headless Linux have no browser to open; print the link instead. */
function shouldSkipBrowser(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.DPAI_NO_BROWSER === "1") return true;
  if (environment.SSH_CONNECTION || environment.SSH_TTY) return true;
  return process.platform === "linux" && !environment.DISPLAY && !environment.WAYLAND_DISPLAY;
}

/** Opens a URL in the default browser without a shell, so no character in it is interpreted. */
export async function openInBrowser(url: string): Promise<boolean> {
  if (shouldSkipBrowser()) return false;
  const [command, args] = process.platform === "win32"
    ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  return new Promise((done) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", () => done(false));
      child.once("spawn", () => {
        child.unref();
        done(true);
      });
    } catch {
      done(false);
    }
  });
}

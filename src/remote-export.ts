import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { linkDirectoryFor, readJsonResponse } from "./auth-client.js";
import { createCliRequestHeaders } from "./client-metadata.js";
import { resolveCredential, type CredentialOverrides } from "./credentials.js";
import { CliConfigurationError } from "./errors.js";

/** Written into every JSX export folder so a later export may replace it. */
export const EXPORT_MARKER = ".dpai-export.json";

export type RemoteExportOptions = CredentialOverrides & {
  /** A file for HTML projects, a folder for JSX projects. Relative to the current directory. */
  outputPath?: string;
  /** Allow writing into a non-empty folder that is not an earlier export. */
  overwrite?: boolean;
};

type ExportContext = {
  pages?: Array<{ route?: unknown }>;
  project?: { id?: unknown };
  prototype?: { runtime?: unknown };
};

const reactExportSchema = z.object({
  files: z.record(z.string(), z.string()),
  revision: z.string(),
  rootName: z.string().min(1),
}).passthrough();

/**
 * Exports the remote project onto this machine in its own runtime: a
 * react-jsx@1 project becomes a Vite + React folder, any other project one
 * HTML file. Without --export-output it lands in `.output/` next to the
 * folder's `.dpai/project.json`, so running it from a subfolder changes nothing.
 */
export async function downloadRemoteExport(
  input: { expectedRevision: string },
  context: ExportContext,
  options: RemoteExportOptions,
) {
  const credential = await resolveCredential(options);
  const apiUrl = credential.apiUrl.replace(/\/$/, "");
  const baseDirectory = linkDirectoryFor(credential.apiUrl);
  const jsx = context.prototype?.runtime === "react-jsx@1";
  const firstRoute = context.pages?.find((page) => typeof page.route === "string")?.route as string | undefined;
  const query = new URLSearchParams({
    format: jsx ? "jsx" : "html",
    revision: input.expectedRevision,
    ...(firstRoute ? { route: firstRoute } : {}),
  });
  const response = await fetch(`${apiUrl}/api/cli/export?${query}`, {
    headers: createCliRequestHeaders(credential.apiKey, {}, { apiUrl: credential.apiUrl }),
  });
  if (!response.ok) await readJsonResponse(response);

  if (!jsx) {
    const html = await response.text();
    const outputPath = options.outputPath ? resolve(options.outputPath) : resolve(baseDirectory, ".output", "prototype.html");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, "utf8");
    return {
      bytes: Buffer.byteLength(html, "utf8"),
      format: "html" as const,
      initialRoute: firstRoute ?? "/",
      outputPath,
      pageCount: context.pages?.length ?? 0,
      revision: response.headers.get("x-dpai-revision") ?? input.expectedRevision,
    };
  }

  const parsed = reactExportSchema.safeParse(await readJsonResponse(response));
  if (!parsed.success) {
    throw new CliConfigurationError("INVALID_EXPORT_RESPONSE", "The DesainPakeAI React export response is invalid.");
  }
  const { files, revision, rootName } = parsed.data;
  const folder = options.outputPath
    ? resolve(options.outputPath)
    : resolve(baseDirectory, ".output", safeFolderName(rootName));
  await assertExportFolder(folder, baseDirectory, options.overwrite === true);
  const entries = Object.entries(files).map(([path, content]) => [exportFilePath(folder, path), content] as const);
  for (const [path, content] of entries) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  await writeAtomically(join(folder, EXPORT_MARKER), `${JSON.stringify({
    exportedAt: new Date().toISOString(),
    projectId: typeof context.project?.id === "string" ? context.project.id : undefined,
    revision,
    version: 1,
  }, null, 2)}\n`);
  return {
    fileCount: entries.length,
    format: "jsx" as const,
    next: [`cd "${folder}"`, "npm install", "npm run dev"],
    outputPath: folder,
    pageCount: context.pages?.length ?? 0,
    revision,
  };
}

/**
 * Refuses a folder that would overwrite the user's own work: the code folder
 * itself, or any non-empty folder that is not an earlier export, unless
 * --overwrite says so.
 */
export async function assertExportFolder(folder: string, baseDirectory: string, overwrite: boolean) {
  if (resolve(folder) === resolve(baseDirectory) && !overwrite) {
    throw new CliConfigurationError(
      "EXPORT_TARGET_IS_PROJECT_FOLDER",
      `Refusing to export the React app into ${folder}, the folder linked to this design.`,
      "Omit --export-output to use .output/<project>, choose an empty folder, or pass --overwrite.",
    );
  }
  const existing = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  if (!existing.length || overwrite) return;
  const marker = await readFile(join(folder, EXPORT_MARKER), "utf8").catch(() => null);
  if (marker === null) {
    throw new CliConfigurationError(
      "EXPORT_TARGET_NOT_EMPTY",
      `${folder} already has files that did not come from a DesainPakeAI export.`,
      "Choose an empty folder, omit --export-output to use .output/<project>, or pass --overwrite.",
    );
  }
}

/** Server paths are relative and stay inside the folder; anything else is refused. */
export function exportFilePath(folder: string, path: string) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new CliConfigurationError("INVALID_EXPORT_PATH", `The export contains an unsafe path: ${path}`);
  }
  const target = resolve(folder, normalized);
  const inside = relative(resolve(folder), target);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new CliConfigurationError("INVALID_EXPORT_PATH", `The export contains an unsafe path: ${path}`);
  }
  return target;
}

export function safeFolderName(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return cleaned || "prototype-app";
}

async function writeAtomically(path: string, content: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

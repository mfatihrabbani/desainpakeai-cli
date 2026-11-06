import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { normalizeApiUrl } from "./credentials.js";
import { CliConfigurationError } from "./errors.js";

/**
 * `.dpai/project.json` remembers which DesainPakeAI design a code folder
 * belongs to. It holds no secret, so a team can commit it; the key stays in the
 * user's own credentials file.
 */
export const PROJECT_LINK_PATH = join(".dpai", "project.json");

const linkSchema = z.object({
  apiUrl: z.string().url(),
  project: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
  }).strict(),
  version: z.literal(1),
}).strict();

export type ProjectLink = z.infer<typeof linkSchema>;

/** Walks up from `start` like git looks for `.git`; the nearest link wins. */
export function findProjectLink(start = process.cwd()): { link: ProjectLink; path: string } | null {
  let directory = resolve(start);
  for (;;) {
    const path = join(directory, PROJECT_LINK_PATH);
    if (existsSync(path)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        parsed = undefined;
      }
      const result = linkSchema.safeParse(parsed);
      if (!result.success) {
        throw new CliConfigurationError(
          "INVALID_PROJECT_LINK",
          `The project link at ${path} is invalid.`,
          "Run 'dpai project use <project-id>' in this folder to write it again.",
        );
      }
      return { link: result.data, path };
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * The project this folder targets on `apiUrl`. `DPAI_PROJECT` overrides the
 * file; a link written for another server is ignored, so a production link
 * never leaks into a local test server.
 */
export function linkedProjectIdFor(apiUrl: string, start = process.cwd()) {
  const explicit = process.env.DPAI_PROJECT?.trim();
  if (explicit) return explicit;
  const found = findProjectLink(start);
  if (!found) return undefined;
  return normalizeApiUrl(found.link.apiUrl) === normalizeApiUrl(apiUrl) ? found.link.project.id : undefined;
}

export async function writeProjectLink(
  value: { apiUrl: string; project: { id: string; name: string } },
  directory = process.cwd(),
) {
  const link = linkSchema.parse({
    apiUrl: normalizeApiUrl(value.apiUrl),
    project: { id: value.project.id, name: value.project.name },
    version: 1,
  });
  const path = resolve(directory, PROJECT_LINK_PATH);
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(link, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return path;
}

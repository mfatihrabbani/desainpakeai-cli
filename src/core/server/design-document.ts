import { lint, type Finding } from "@google/design.md/linter";
import { parseDocument, type Document } from "yaml";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const TOKEN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const SECTION_PATTERN = /^##[ \t]+(.+?)[ \t]*$/gm;

export const DESIGN_SECTION_ORDER = [
  "Overview",
  "Colors",
  "Typography",
  "Layout",
  "Elevation & Depth",
  "Shapes",
  "Components",
  "Do's and Don'ts",
] as const;

export type DesignSectionName = typeof DESIGN_SECTION_ORDER[number];

export type DesignTypographyPatch = {
  fontFamily?: string;
  fontFeature?: string;
  fontSize?: string;
  fontVariation?: string;
  fontWeight?: number;
  letterSpacing?: string;
  lineHeight?: number | string;
};

export type DesignSystemUpdate = {
  colors?: Record<string, string | null>;
  components?: Record<string, Record<string, string | number> | null>;
  metadata?: {
    description?: string | null;
    name?: string | null;
    version?: string | null;
  };
  omitted?: Array<{ reason: string; section: string }> | null;
  rounded?: Record<string, string | null>;
  sections?: Array<{ content: string | null; heading: DesignSectionName }>;
  spacing?: Record<string, number | string | null>;
  typography?: Record<string, DesignTypographyPatch | null>;
};

type DesignDocument = {
  body: string;
  frontmatter: Record<string, unknown>;
  yaml: Document;
};

export function getDesignContext(source: string) {
  const parsed = parseDesignDocument(source);
  const report = lint(source);
  return {
    colors: readRecord(parsed.frontmatter.colors),
    components: readRecord(parsed.frontmatter.components),
    description: readOptionalString(parsed.frontmatter.description),
    findings: report.findings,
    name: readOptionalString(parsed.frontmatter.name),
    omitted: Array.isArray(parsed.frontmatter.omitted) ? parsed.frontmatter.omitted : [],
    rounded: readRecord(parsed.frontmatter.rounded),
    sections: readMarkdownSections(parsed.body),
    spacing: readRecord(parsed.frontmatter.spacing),
    summary: report.summary,
    typography: readRecord(parsed.frontmatter.typography),
    valid: report.summary.errors === 0,
    version: readOptionalString(parsed.frontmatter.version),
  };
}

export function lintDesignDocument(source: string) {
  const report = lint(source);
  return {
    findings: report.findings,
    sections: report.sections,
    summary: report.summary,
    valid: report.summary.errors === 0,
  };
}

export function setDesignSection(
  source: string,
  heading: DesignSectionName,
  content: string,
) {
  if (/^##[ \t]+/m.test(content)) {
    throw new Error("Section content must not contain another level-two heading.");
  }
  const parsed = parseDesignDocument(source);
  const previousSection = readMarkdownSections(parsed.body)
    .find((section) => section.heading === heading)?.content;
  parsed.body = upsertMarkdownSection(parsed.body, heading, content);
  return {
    nextSource: serializeDesignDocument(parsed),
    previousValue: previousSection,
  };
}

export function updateDesignSystem(source: string, update: DesignSystemUpdate) {
  if (!Object.values(update).some((value) => value !== undefined)) {
    throw new Error("Design system update requires at least one change group.");
  }

  const parsed = parseDesignDocument(source);
  const changed = {
    colors: 0,
    components: 0,
    metadata: 0,
    omitted: update.omitted === undefined ? 0 : 1,
    rounded: 0,
    sections: 0,
    spacing: 0,
    typography: 0,
  };

  for (const [name, value] of Object.entries(update.metadata ?? {})) {
    if (value === undefined) continue;
    if (value === null) parsed.yaml.delete(name);
    else parsed.yaml.set(name, value);
    changed.metadata += 1;
  }

  changed.colors = applyScalarMapPatch(parsed, "colors", update.colors, true);
  changed.spacing = applyScalarMapPatch(parsed, "spacing", update.spacing, true);
  changed.rounded = applyScalarMapPatch(parsed, "rounded", update.rounded, true);

  if (update.typography) {
    ensureYamlMap(parsed, "typography");
    for (const [name, patch] of Object.entries(update.typography)) {
      assertTokenName(name);
      if (patch === null) {
        parsed.yaml.deleteIn(["typography", name]);
      } else {
        const definedPatch = Object.fromEntries(
          Object.entries(patch).filter((entry) => entry[1] !== undefined),
        );
        if (Object.keys(definedPatch).length === 0) {
          throw new Error(`Typography '${name}' requires at least one property.`);
        }
        const current = readRecord(readRecord(parsed.frontmatter.typography)[name]);
        parsed.yaml.setIn(
          ["typography", name],
          orderTypographyProperties({ ...current, ...definedPatch }),
        );
      }
      changed.typography += 1;
    }
  }

  if (update.components) {
    ensureYamlMap(parsed, "components");
    for (const [name, value] of Object.entries(update.components)) {
      assertTokenName(name);
      if (value === null) parsed.yaml.deleteIn(["components", name]);
      else parsed.yaml.setIn(["components", name], value);
      changed.components += 1;
    }
  }

  if (update.omitted !== undefined) {
    if (update.omitted === null || update.omitted.length === 0) parsed.yaml.delete("omitted");
    else parsed.yaml.set("omitted", update.omitted);
  }

  for (const section of update.sections ?? []) {
    parsed.body = section.content === null
      ? removeMarkdownSection(parsed.body, section.heading)
      : upsertMarkdownSection(parsed.body, section.heading, section.content);
    changed.sections += 1;
  }

  return {
    changed,
    nextSource: serializeDesignDocument(parsed),
  };
}

export function assertValidDesignDocument(source: string) {
  const report = lintDesignDocument(source);
  if (!report.valid) {
    const errors = report.findings.filter((finding) => finding.severity === "error");
    throw new DesignValidationError(errors);
  }
  return report;
}

export class DesignValidationError extends Error {
  readonly findings: Finding[];

  constructor(findings: Finding[]) {
    super(findings.map((finding) => finding.message).join(" ") || "Invalid DESIGN.md document.");
    this.name = "DesignValidationError";
    this.findings = findings;
  }
}

function parseDesignDocument(source: string): DesignDocument {
  const match = source.match(FRONTMATTER_PATTERN);
  if (!match || match.index !== 0) {
    throw new Error("DESIGN.md must start with YAML frontmatter fenced by exact --- lines.");
  }

  const yaml = parseDocument(match[1] ?? "", { prettyErrors: true, strict: true });
  if (yaml.errors.length) {
    throw new Error(yaml.errors.map((error) => error.message).join(" "));
  }
  const frontmatter = yaml.toJS() as unknown;
  if (!isRecord(frontmatter)) {
    throw new Error("DESIGN.md frontmatter must be a YAML mapping.");
  }

  return {
    body: source.slice(match[0].length).replace(/^\r?\n/, ""),
    frontmatter,
    yaml,
  };
}

function serializeDesignDocument(document: DesignDocument) {
  const yaml = document.yaml.toString({ lineWidth: 0 }).trimEnd();
  const body = document.body.trim();
  return `---\n${yaml}\n---\n\n${body}\n`;
}

function ensureYamlMap(document: DesignDocument, key: string) {
  if (document.frontmatter[key] === undefined) {
    document.yaml.set(key, document.yaml.createNode({}));
    document.frontmatter[key] = {};
    return;
  }
  if (!isRecord(document.frontmatter[key])) {
    throw new Error(`DESIGN.md '${key}' must be a mapping.`);
  }
}

function applyScalarMapPatch(
  document: DesignDocument,
  key: string,
  patch: Record<string, number | string | null> | undefined,
  validateNames: boolean,
) {
  if (!patch) return 0;
  ensureYamlMap(document, key);
  for (const [name, value] of Object.entries(patch)) {
    if (validateNames) assertTokenName(name);
    if (value === null) document.yaml.deleteIn([key, name]);
    else document.yaml.setIn([key, name], value);
  }
  return Object.keys(patch).length;
}

function readMarkdownSections(body: string) {
  const matches = [...body.matchAll(SECTION_PATTERN)];
  return matches.map((match, index) => {
    const heading = match[1]?.trim() ?? "";
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    return {
      content: body.slice(start, end).trim(),
      heading,
    };
  });
}

function upsertMarkdownSection(body: string, heading: DesignSectionName, content: string) {
  const matches = [...body.matchAll(SECTION_PATTERN)];
  const prefix = matches.length ? body.slice(0, matches[0]?.index ?? 0).trim() : body.trim();
  const sections = readMarkdownSections(body);
  const existingIndex = sections.findIndex((section) => section.heading === heading);
  const normalized = { content: content.trim(), heading };

  if (existingIndex >= 0) {
    sections[existingIndex] = normalized;
  } else {
    const targetOrder = DESIGN_SECTION_ORDER.indexOf(heading);
    const insertionIndex = sections.findIndex((section) => {
      const order = DESIGN_SECTION_ORDER.indexOf(section.heading as DesignSectionName);
      return order >= 0 && order > targetOrder;
    });
    sections.splice(insertionIndex < 0 ? sections.length : insertionIndex, 0, normalized);
  }

  const chunks = [
    ...(prefix ? [prefix] : []),
    ...sections.map((section) => (
      `## ${section.heading}${section.content ? `\n\n${section.content}` : ""}`
    )),
  ];
  return `${chunks.join("\n\n")}\n`;
}

function removeMarkdownSection(body: string, heading: DesignSectionName) {
  const matches = [...body.matchAll(SECTION_PATTERN)];
  const prefix = matches.length ? body.slice(0, matches[0]?.index ?? 0).trim() : body.trim();
  const sections = readMarkdownSections(body).filter((section) => section.heading !== heading);
  const chunks = [
    ...(prefix ? [prefix] : []),
    ...sections.map((section) => (
      `## ${section.heading}${section.content ? `\n\n${section.content}` : ""}`
    )),
  ];
  return `${chunks.join("\n\n")}\n`;
}

function orderTypographyProperties(value: Record<string, unknown>) {
  const orderedKeys = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "fontFeature",
    "fontVariation",
  ];
  return Object.fromEntries([
    ...orderedKeys.flatMap((key) => key in value ? [[key, value[key]]] : []),
    ...Object.entries(value).filter(([key]) => !orderedKeys.includes(key)),
  ]);
}

function assertTokenName(name: string) {
  if (!TOKEN_NAME_PATTERN.test(name)) {
    throw new Error("Design token names must use kebab-case and start with a letter.");
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

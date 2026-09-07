import {
  getDesignContext,
  type DesignSystemUpdate,
  type DesignTypographyPatch,
  updateDesignSystem,
} from "./design-document.js";

export const FLAT_DESIGN_TOKEN_TYPES = [
  "breakpoint",
  "color",
  "container",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "radius",
  "spacing",
] as const;

export type FlatDesignTokenType = typeof FLAT_DESIGN_TOKEN_TYPES[number];
export type ReadFlatDesignTokenType = FlatDesignTokenType | "other";

export type FlatDesignToken = {
  name: string;
  type: ReadFlatDesignTokenType;
  value: number | string;
};

export type CreateFlatDesignToken = {
  name: string;
  type: FlatDesignTokenType;
  value: number | string;
};

export type SetFlatDesignToken = {
  delete?: boolean;
  name: string;
  newName?: string;
  typographyRoles?: string[];
  value?: number | string;
};

export type TypographyTokenBinding = {
  roles: string[];
  tokenName: string;
};

type TokenDeclaration = FlatDesignToken & {
  end: number;
  indent: string;
  lineEnding: string;
  start: number;
};

const TOKEN_NAME_PATTERN = /^--[a-z][a-z0-9-]*$/;
const TYPOGRAPHY_ROLE_PATTERN = /^[a-z][a-z0-9-]*$/;
const TOKEN_DECLARATION_PATTERN = /^([ \t]*)(--[a-z][a-z0-9-]*)\s*:\s*([^;\r\n]+);[ \t]*(\r?\n|$)/gim;
const TYPE_PREFIX: Record<FlatDesignTokenType, string> = {
  breakpoint: "--breakpoint-",
  color: "--color-",
  container: "--container-",
  fontFamily: "--font-",
  fontSize: "--text-",
  fontWeight: "--weight-",
  letterSpacing: "--tracking-",
  lineHeight: "--leading-",
  radius: "--radius-",
  spacing: "--space-",
};

export function readFlatDesignTokens(source: string): FlatDesignToken[] {
  return readTokenDeclarations(source).map(({ end: _end, indent: _indent, lineEnding: _lineEnding, start: _start, ...token }) => token);
}

export function createFlatDesignTokens(
  source: string,
  tokens: CreateFlatDesignToken[],
) {
  if (!tokens.length) throw new Error("Create at least one token.");
  const current = readFlatDesignTokens(source);
  const names = new Set(current.map((token) => token.name));
  const additions = tokens.map((token) => normalizeCreatedToken(token));

  for (const token of additions) {
    if (names.has(token.name)) throw new Error(`Token '${token.name}' already exists.`);
    names.add(token.name);
  }

  const root = findRootBlock(source);
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const indent = readTokenDeclarations(source)[0]?.indent ?? "  ";
  const prefix = root.body.trimEnd() ? "" : lineEnding;
  const insertion = `${prefix}${additions.map((token) => (
    `${indent}${token.name}: ${token.value};${lineEnding}`
  )).join("")}`;
  const nextSource = `${source.slice(0, root.close)}${insertion}${source.slice(root.close)}`;
  return { nextSource, tokens: additions };
}

export function setFlatDesignTokens(
  source: string,
  changes: SetFlatDesignToken[],
) {
  if (!changes.length) throw new Error("Set at least one token.");
  const declarations = readTokenDeclarations(source);
  const byName = new Map(declarations.map((token) => [token.name, token]));
  const targetNames = new Set<string>();

  for (const change of changes) {
    assertTokenName(change.name);
    if (targetNames.has(change.name)) {
      throw new Error(`Token '${change.name}' is targeted more than once.`);
    }
    targetNames.add(change.name);
    const current = byName.get(change.name);
    if (!current) throw new Error(`Unknown token '${change.name}'.`);
    const typographyRoles = change.typographyRoles ?? [];
    if (new Set(typographyRoles).size !== typographyRoles.length) {
      throw new Error(`Token '${change.name}' targets a typography role more than once.`);
    }
    for (const role of typographyRoles) {
      if (!TYPOGRAPHY_ROLE_PATTERN.test(role)) {
        throw new Error(`Typography role '${role}' must use kebab-case.`);
      }
    }
    if (typographyRoles.length && current.type !== "fontFamily") {
      throw new Error(`Token '${change.name}' must be a fontFamily token to target typography roles.`);
    }
    if (change.delete) {
      if (
        change.newName !== undefined
        || change.value !== undefined
        || typographyRoles.length
      ) {
        throw new Error(`Deleted token '${change.name}' cannot also be renamed, assigned, or bound to typography roles.`);
      }
      continue;
    }
    if (
      change.newName === undefined
      && change.value === undefined
      && !typographyRoles.length
    ) {
      throw new Error(`Token '${change.name}' requires newName, value, typographyRoles, or delete.`);
    }
    if (change.newName !== undefined) {
      assertTokenName(change.newName);
      const nextType = inferTokenType(change.newName);
      if (nextType !== current.type) {
        throw new Error(`Renamed token '${change.name}' must keep type '${current.type}'.`);
      }
    }
    if (change.value !== undefined) normalizeValue(change.value, current.type);
  }

  const finalNames = new Set(declarations.map((token) => token.name));
  for (const change of changes) finalNames.delete(change.name);
  for (const change of changes) {
    if (change.delete) continue;
    const nextName = change.newName ?? change.name;
    if (finalNames.has(nextName)) throw new Error(`Token '${nextName}' already exists.`);
    finalNames.add(nextName);
  }

  const changeByName = new Map(changes.map((change) => [change.name, change]));
  const replacements = declarations.flatMap((token) => {
    const change = changeByName.get(token.name);
    if (!change) return [];
    if (change.delete) return [{ end: token.end, start: token.start, value: "" }];
    const name = change.newName ?? token.name;
    const value = change.value === undefined
      ? token.value
      : normalizeValue(change.value, token.type);
    return [{
      end: token.end,
      start: token.start,
      value: `${token.indent}${name}: ${value};${token.lineEnding}`,
    }];
  }).sort((left, right) => right.start - left.start);

  let nextSource = source;
  for (const replacement of replacements) {
    nextSource = `${nextSource.slice(0, replacement.start)}${replacement.value}${nextSource.slice(replacement.end)}`;
  }
  if (
    nextSource === source
    && !changes.some((change) => change.typographyRoles?.length)
  ) {
    throw new Error("Token update produced no change.");
  }

  const nextByName = new Map(readFlatDesignTokens(nextSource).map((token) => [token.name, token]));
  return {
    nextSource,
    tokens: changes.flatMap((change) => {
      if (change.delete) return [];
      const token = nextByName.get(change.newName ?? change.name);
      return token ? [token] : [];
    }),
  };
}

export function syncFlatTokensToDesignDocument(
  source: string,
  beforeTokens: FlatDesignToken[],
  afterTokens: FlatDesignToken[],
  options: {
    implicitFontFamilyRoles?: boolean;
    typographyBindings?: TypographyTokenBinding[];
  } = {},
) {
  const before = new Map(beforeTokens.map((token) => [token.name, token]));
  const after = new Map(afterTokens.map((token) => [token.name, token]));
  const changedNames = new Set([
    ...[...before].flatMap(([name, token]) => {
      const next = after.get(name);
      return !next || next.value !== token.value || next.type !== token.type ? [name] : [];
    }),
    ...[...after].flatMap(([name, token]) => {
      const previous = before.get(name);
      return !previous || previous.value !== token.value || previous.type !== token.type ? [name] : [];
    }),
  ]);
  const typographyBindings = options.typographyBindings ?? [];
  if (!changedNames.size && !typographyBindings.length) return source;

  const context = getDesignContext(source);
  const scalarUpdate: DesignSystemUpdate = {};
  const typographyByRole = new Map<string, Record<string, unknown>>();
  const touchedTypographyRoles = new Set<string>();

  const ensureTypographyRole = (role: string, requireExisting = false) => {
    if (
      requireExisting
      && !Object.prototype.hasOwnProperty.call(context.typography, role)
    ) {
      throw new Error(`Unknown typography role '${role}'.`);
    }
    if (!typographyByRole.has(role)) {
      typographyByRole.set(
        role,
        { ...readRecord(context.typography[role]) },
      );
    }
    touchedTypographyRoles.add(role);
    return typographyByRole.get(role)!;
  };

  for (const name of changedNames) {
    const previous = before.get(name);
    const next = after.get(name);
    if (previous) applyTokenToDesignPatch(scalarUpdate, previous, null);
    if (next) applyTokenToDesignPatch(scalarUpdate, next, next.value);

    for (const token of [previous, next]) {
      const target = token && typographyTarget(token);
      if (
        !target
        || (token.type === "fontFamily" && options.implicitFontFamilyRoles === false)
      ) continue;
      ensureTypographyRole(target.role);
    }
    const previousTarget = previous && typographyTarget(previous);
    if (
      previousTarget
      && !(previous?.type === "fontFamily" && options.implicitFontFamilyRoles === false)
    ) {
      delete ensureTypographyRole(previousTarget.role)[previousTarget.property];
    }
    const nextTarget = next && typographyTarget(next);
    if (
      nextTarget
      && !(next?.type === "fontFamily" && options.implicitFontFamilyRoles === false)
    ) {
      const role = ensureTypographyRole(nextTarget.role);
      role[nextTarget.property] = designTypographyValue(next);
    }
  }

  const explicitlyTargetedRoles = new Set<string>();
  for (const binding of typographyBindings) {
    const token = after.get(binding.tokenName);
    if (!token) throw new Error(`Unknown token '${binding.tokenName}' for typography binding.`);
    if (token.type !== "fontFamily") {
      throw new Error(`Token '${binding.tokenName}' must be a fontFamily token to target typography roles.`);
    }
    for (const roleName of binding.roles) {
      if (explicitlyTargetedRoles.has(roleName)) {
        throw new Error(`Typography role '${roleName}' is targeted more than once.`);
      }
      explicitlyTargetedRoles.add(roleName);
      ensureTypographyRole(roleName, true).fontFamily = designTypographyValue(token);
    }
  }

  const addedCategories = new Set([...changedNames].flatMap((name) => {
    const token = after.get(name);
    if (!token) return [];
    if (["breakpoint", "container", "spacing"].includes(token.type)) return ["spacing"];
    if (token.type === "radius") return ["rounded"];
    return [];
  }));
  const omissions = context.omitted.filter((entry) => {
    const section = readRecord(entry).section;
    return typeof section !== "string" || !addedCategories.has(section.toLowerCase());
  });
  if (omissions.length !== context.omitted.length) scalarUpdate.omitted = omissions;

  if (touchedTypographyRoles.size) {
    scalarUpdate.typography = Object.fromEntries(
      [...touchedTypographyRoles].map((role) => [role, null]),
    );
  }
  let nextSource = hasDesignUpdate(scalarUpdate)
    ? updateDesignSystem(source, scalarUpdate).nextSource
    : source;
  const typography = Object.fromEntries(
    [...touchedTypographyRoles].flatMap((role) => {
      const value = typographyByRole.get(role) ?? {};
      return Object.keys(value).length
        ? [[role, value as DesignTypographyPatch]]
        : [];
    }),
  );
  if (Object.keys(typography).length) {
    nextSource = updateDesignSystem(nextSource, { typography }).nextSource;
  }
  return nextSource;
}

function readTokenDeclarations(source: string): TokenDeclaration[] {
  const root = findRootBlock(source);
  const declarations: TokenDeclaration[] = [];
  TOKEN_DECLARATION_PATTERN.lastIndex = 0;
  for (const match of root.body.matchAll(TOKEN_DECLARATION_PATTERN)) {
    const name = match[2];
    const rawValue = match[3]?.trim();
    if (!name || !rawValue || match.index === undefined) continue;
    const value = inferTokenType(name) === "fontWeight" && /^\d+$/.test(rawValue)
      ? Number(rawValue)
      : rawValue;
    const start = root.open + match.index;
    declarations.push({
      end: start + match[0].length,
      indent: match[1] ?? "  ",
      lineEnding: match[4] ?? "",
      name,
      start,
      type: inferTokenType(name),
      value,
    });
  }
  return declarations;
}

function findRootBlock(source: string) {
  const match = /:root\s*\{/.exec(source);
  if (!match || match.index === undefined) throw new Error("Runtime token CSS requires a :root block.");
  const open = match.index + match[0].length;
  const close = source.indexOf("}", open);
  if (close < 0) throw new Error("Runtime token CSS has an unclosed :root block.");
  return { body: source.slice(open, close), close, open };
}

function normalizeCreatedToken(token: CreateFlatDesignToken): FlatDesignToken {
  assertTokenName(token.name);
  if (!token.name.startsWith(TYPE_PREFIX[token.type])) {
    throw new Error(`Token type '${token.type}' requires the '${TYPE_PREFIX[token.type]}' prefix.`);
  }
  return { ...token, value: normalizeValue(token.value, token.type) };
}

function normalizeValue(value: number | string, type: ReadFlatDesignTokenType) {
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!normalized || /[;{}]/.test(normalized)) throw new Error("Token values must be one safe CSS value.");
  if (type === "fontWeight") {
    const weight = Number(normalized);
    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
      throw new Error("fontWeight tokens require an integer from 1 to 1000.");
    }
    return weight;
  }
  return normalized;
}

function inferTokenType(name: string): ReadFlatDesignTokenType {
  const match = FLAT_DESIGN_TOKEN_TYPES.find((type) => name.startsWith(TYPE_PREFIX[type]));
  return match ?? "other";
}

function assertTokenName(name: string) {
  if (!TOKEN_NAME_PATTERN.test(name)) {
    throw new Error("Token names must be lowercase CSS variables, for example --color-primary.");
  }
}

function applyTokenToDesignPatch(
  update: DesignSystemUpdate,
  token: FlatDesignToken,
  value: number | string | null,
) {
  if (token.type === "color") {
    update.colors = { ...update.colors, [token.name.slice("--color-".length)]: value === null ? null : String(value) };
  } else if (["breakpoint", "container", "spacing"].includes(token.type)) {
    update.spacing = { ...update.spacing, [token.name.slice(2)]: value };
  } else if (token.type === "radius") {
    update.rounded = { ...update.rounded, [token.name.slice(2)]: value === null ? null : String(value) };
  }
}

function typographyTarget(token: FlatDesignToken) {
  const mappings: Partial<Record<ReadFlatDesignTokenType, keyof DesignTypographyPatch>> = {
    fontFamily: "fontFamily",
    fontSize: "fontSize",
    fontWeight: "fontWeight",
    letterSpacing: "letterSpacing",
    lineHeight: "lineHeight",
  };
  const property = mappings[token.type];
  if (!property) return undefined;
  return { property, role: token.name.slice(TYPE_PREFIX[token.type as FlatDesignTokenType].length) };
}

function designTypographyValue(token: FlatDesignToken) {
  if (token.type === "fontWeight") return Number(token.value);
  if (token.type === "lineHeight" && /^\d+(?:\.\d+)?$/.test(String(token.value))) {
    return Number(token.value);
  }
  return String(token.value);
}

function hasDesignUpdate(update: DesignSystemUpdate) {
  return Object.values(update).some((value) => value !== undefined);
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

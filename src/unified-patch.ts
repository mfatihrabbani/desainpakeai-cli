import type { SourceEdit } from "./core/server/local-workspace.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

export function parseUnifiedPatch(source: string): SourceEdit[] {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines.filter((line) => line.startsWith("+++ ")).length > 1) {
    throw new Error("file patch accepts a unified diff for exactly one source file.");
  }
  const edits: SourceEdit[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.startsWith("@@ ")) {
      index += 1;
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (!header) throw new Error(`Invalid unified-diff hunk header: ${line}`);
    const expectedOldLines = Number(header[2] ?? 1);
    const expectedNewLines = Number(header[4] ?? 1);
    const oldLines: string[] = [];
    const newLines: string[] = [];
    let removedLines = 0;
    let addedLines = 0;
    index += 1;

    while (index < lines.length && !lines[index]!.startsWith("@@ ")) {
      const hunkLine = lines[index]!;
      if (hunkLine.startsWith("diff --git ") || hunkLine.startsWith("--- ") || hunkLine.startsWith("+++ ")) {
        break;
      }
      if (hunkLine === "\\ No newline at end of file") {
        index += 1;
        continue;
      }
      if (hunkLine.startsWith(" ")) {
        oldLines.push(hunkLine.slice(1));
        newLines.push(hunkLine.slice(1));
      } else if (hunkLine.startsWith("-")) {
        oldLines.push(hunkLine.slice(1));
        removedLines += 1;
      } else if (hunkLine.startsWith("+")) {
        newLines.push(hunkLine.slice(1));
        addedLines += 1;
      } else if (hunkLine === "" && index === lines.length - 1) {
        index += 1;
        break;
      } else {
        throw new Error(`Invalid unified-diff line in hunk: ${hunkLine}`);
      }
      index += 1;
    }

    if (oldLines.length !== expectedOldLines || newLines.length !== expectedNewLines) {
      throw new Error(
        `Unified-diff hunk line counts do not match its header (expected ${expectedOldLines}/${expectedNewLines}, received ${oldLines.length}/${newLines.length}).`,
      );
    }
    if (removedLines === 0 && addedLines === 0) {
      throw new Error("Unified-diff hunks must add, remove, or replace at least one line.");
    }
    if (oldLines.length === 0) {
      throw new Error("Pure insertion hunks need at least one context line so the edit has a unique anchor.");
    }

    edits.push({
      newText: newLines.join("\n"),
      oldText: oldLines.join("\n"),
      operation: "replace",
    });
  }

  if (edits.length === 0) {
    throw new Error("No unified-diff hunks were found. Expected a line beginning with '@@ -old +new @@'.");
  }
  if (edits.length > 50) {
    throw new Error("A patch may contain at most 50 hunks.");
  }
  return edits;
}

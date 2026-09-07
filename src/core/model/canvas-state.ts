export type CanvasFramePlacement = {
  x: number;
  y: number;
};

export type LocalCanvasFile = {
  schemaVersion: 1;
  frames: Record<string, CanvasFramePlacement>;
};

export const CANVAS_GRID_COLUMNS = 5;
export const CANVAS_FRAME_HEIGHT = 800;

const DEFAULT_FRAME_ORIGIN = { x: 80, y: 96 };
const FRAME_COLUMN_STEP = 1520;
const FRAME_ROW_STEP = 960;

export function createDefaultCanvas(pageIds: string[]): LocalCanvasFile {
  return {
    schemaVersion: 1,
    frames: Object.fromEntries(pageIds.map((pageId, index) => [
      pageId,
      { x: DEFAULT_FRAME_ORIGIN.x + (index * FRAME_COLUMN_STEP), y: DEFAULT_FRAME_ORIGIN.y },
    ])),
  };
}

export function arrangeCanvasFrames(
  pageIds: string[],
  columns = CANVAS_GRID_COLUMNS,
): LocalCanvasFile {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error("Canvas grid columns must be a positive integer.");
  }

  return {
    schemaVersion: 1,
    frames: Object.fromEntries(pageIds.map((pageId, index) => [
      pageId,
      {
        x: DEFAULT_FRAME_ORIGIN.x + ((index % columns) * FRAME_COLUMN_STEP),
        y: DEFAULT_FRAME_ORIGIN.y + (Math.floor(index / columns) * FRAME_ROW_STEP),
      },
    ])),
  };
}

export function parseCanvasFile(value: unknown, pageIds: string[]): LocalCanvasFile {
  const defaults = createDefaultCanvas(pageIds);
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.frames)) {
    throw new Error("Canvas payload must contain schemaVersion 1 and a frames object.");
  }

  for (const pageId of pageIds) {
    const frame = value.frames[pageId];
    if (frame === undefined) continue;
    if (!isRecord(frame) || !isCoordinate(frame.x) || !isCoordinate(frame.y)) {
      throw new Error(`Invalid frame position for '${pageId}'.`);
    }
    defaults.frames[pageId] = {
      x: Math.round(frame.x),
      y: Math.round(frame.y),
    };
  }

  return defaults;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { z } from "zod";

/**
 * Cursor pagination helpers (PRJ-02: no unbounded list endpoints).
 * Cursor = base64url of "<sort_value>|<id>".
 */

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(`${sortValue}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { sortValue: string; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = decoded.indexOf("|");
  if (sep < 0) throw new Error("malformed cursor");
  return { sortValue: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}

export function buildPage<T extends Record<string, unknown>>(
  rows: T[],
  limit: number,
  sortKey: keyof T & string,
  idKey: keyof T & string,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor(String(last[sortKey]), String(last[idKey])) : null,
  };
}

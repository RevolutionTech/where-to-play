import { parse } from "csv-parse/sync";
import type { SourceConfigByKind } from "../../db/schema";
import { ensureOk, type Fetch } from "../../http";
import type { SourceGame } from "./index";

/** Reads a CSV file with one header row. See docs/decisions/0010-csv-source.md. */
export async function fetchCsv(
  { url, nameColumn, bggIdColumn, where = [] }: SourceConfigByKind["csv"],
  { fetch }: { fetch: Fetch },
): Promise<SourceGame[]> {
  const text = await (await ensureOk(await fetch(url))).text();
  const [header = [], ...rows] = parse(text, { bom: true, relax_column_count: true }) as string[][];

  const columnIndex = (column: string) => {
    const index = header.indexOf(column);
    if (index === -1) throw new Error(`The CSV has no "${column}" column.`);
    return index;
  };
  const nameIndex = columnIndex(nameColumn);
  const bggIdIndex = bggIdColumn === undefined ? undefined : columnIndex(bggIdColumn);
  const conditions = where.map(({ column, equals }) => ({ index: columnIndex(column), equals }));

  return rows
    .filter((row) => conditions.every(({ index, equals }) => row[index] === equals))
    .map((row) => ({
      name: row[nameIndex] ?? "",
      bggId: bggIdIndex === undefined ? null : toBggId(row[bggIdIndex] ?? ""),
    }));
}

// Sheets often hold a link to the game's BGG page instead of its ID.
function toBggId(value: string) {
  const text = value.trim();
  const id = /^\d+$/.test(text)
    ? text
    : text.match(/boardgamegeek\.com\/boardgame(?:expansion)?\/(\d+)/)?.[1];
  const bggId = Number(id);
  return Number.isInteger(bggId) && bggId > 0 ? bggId : null;
}

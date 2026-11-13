import type { JsonApiCondition, SourceConfigByKind } from "../../db/schema";
import { ensureOk, type Fetch } from "../../http";
import type { SourceGame } from "./index";

/** Reads one JSON response, with no pagination. See docs/decisions/0008-json-api-source.md. */
export async function fetchJsonApi(
  { url, itemsPath, namePath, bggIdPath, where = [] }: SourceConfigByKind["json_api"],
  { fetch }: { fetch: Fetch },
): Promise<SourceGame[]> {
  const body: unknown = await (await ensureOk(await fetch(url))).json();
  const items = itemsPath ? valueAt(body, itemsPath) : body;
  if (!Array.isArray(items)) {
    throw new Error(`The JSON response has no array at "${itemsPath ?? "(root)"}".`);
  }
  return items
    .filter((item) => where.every((condition) => matches(item, condition)))
    .map((item) => {
      const name = valueAt(item, namePath);
      return {
        name: typeof name === "string" ? name : "",
        bggId: bggIdPath ? toBggId(valueAt(item, bggIdPath)) : null,
      };
    });
}

function valueAt(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function matches(item: unknown, { path, greaterThan }: JsonApiCondition) {
  const value = valueAt(item, path);
  return typeof value === "number" && value > greaterThan;
}

// Sources use 0, null, or a blank string when a game has no BGG ID.
function toBggId(value: unknown) {
  const bggId = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof bggId === "number" && Number.isInteger(bggId) && bggId > 0 ? bggId : null;
}

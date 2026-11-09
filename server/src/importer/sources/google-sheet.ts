import { ensureOk, type Fetch } from "../../http";
import type { SourceGame } from "./index";

/** Reads game names from the first column, under one header row. */
export async function fetchGoogleSheet(
  { url, sheetName }: { url: string; sheetName?: string },
  { fetch, apiKey }: { fetch: Fetch; apiKey: string | undefined },
): Promise<SourceGame[]> {
  if (!apiKey) throw new Error("Google Sheets sources need GOOGLE_SHEETS_API_KEY.");
  const spreadsheetId = url.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
  if (!spreadsheetId) throw new Error(`Not a Google Sheets URL: ${url}`);

  // With no sheet name, the range refers to the first visible sheet.
  const range = sheetName ? `'${sheetName.replaceAll("'", "''")}'!A:A` : "A:A";
  const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}`;
  const { values = [] } = (await (await ensureOk(await fetch(apiUrl))).json()) as {
    values?: string[][];
  };
  return values.slice(1).map(([name = ""]) => ({ name, bggId: null }));
}

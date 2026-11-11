import { ensureOk, type Fetch } from "../../http";
import type { SourceGame } from "./index";

// Airtable has no public API for shared pages. This uses the request that the shared page makes
// in a browser, so Airtable can change it without notice.

type SharedPageData = {
  data: {
    tableSchemas: { id: string; primaryColumnId: string }[];
    preloadPageQueryResults: {
      querySlices: { tableId: string; rowIds: string[] }[];
      tableDataById: Record<
        string,
        { partialRowById: Record<string, { cellValuesByColumnId: Record<string, unknown> }> }
      >;
    };
  };
};

/** Reads the primary column of each table that the shared page shows. */
export async function fetchAirtableSharedPage(
  { url }: { url: string },
  { fetch }: { fetch: Fetch },
): Promise<SourceGame[]> {
  const [, applicationId, shareId] = url.match(/\/(app\w+)\/(shr\w+)/) ?? [];
  if (!applicationId || !shareId) throw new Error(`Not an Airtable shared page URL: ${url}`);

  // The share link serves a different page to clients that are not browsers. The embed link
  // does not.
  const pageResponse = await ensureOk(
    await fetch(`https://airtable.com/embed/${applicationId}/${shareId}`),
  );
  const { accessPolicy, pageId } = readSharedPageHtml(await pageResponse.text());

  const dataUrl = new URL(
    `https://airtable.com/v0.3/application/${applicationId}/readForSharedPages`,
  );
  dataUrl.searchParams.set(
    "stringifiedObjectParams",
    JSON.stringify({
      includeDataForPageId: pageId,
      shouldPreloadQueries: true,
      shouldPreloadAllPossibleContainerElementQueries: true,
      navigationMode: "view",
      urlSearch: "",
      // Airtable refuses the request without a layout version, but accepts any version.
      expectedPageLayoutSchemaVersion: 26,
      allowMsgpackOfResultIfEnabled: false,
    }),
  );
  dataUrl.searchParams.set("requestId", `req${shareId.slice(3)}`);
  dataUrl.searchParams.set("accessPolicy", accessPolicy);
  const dataResponse = await ensureOk(
    await fetch(dataUrl, {
      headers: {
        "x-airtable-application-id": applicationId,
        "x-requested-with": "XMLHttpRequest",
        "x-time-zone": "UTC",
      },
    }),
  );
  const { data } = (await dataResponse.json()) as SharedPageData;

  const { querySlices, tableDataById } = data.preloadPageQueryResults;
  if (querySlices.length === 0) throw new Error("The Airtable shared page shows no tables.");
  return querySlices.flatMap(({ tableId, rowIds }) => {
    const primaryColumnId = data.tableSchemas.find(
      (table) => table.id === tableId,
    )?.primaryColumnId;
    const rowById = tableDataById[tableId]?.partialRowById ?? {};
    return rowIds.map((rowId) => {
      const name = primaryColumnId && rowById[rowId]?.cellValuesByColumnId[primaryColumnId];
      return { name: typeof name === "string" ? name : "", bggId: null };
    });
  });
}

/** The page HTML holds a signed access policy that the data request must send back. */
function readSharedPageHtml(html: string) {
  const escapedAccessPolicy = html.match(/"accessPolicy":"((?:[^"\\]|\\.)*)"/)?.[1];
  const pageId = html.match(/"sharedPageId":"(pag\w+)"/)?.[1];
  if (escapedAccessPolicy === undefined || !pageId) {
    throw new Error("The Airtable page has no shared page data. Is it a shared Interface page?");
  }
  return { accessPolicy: JSON.parse(`"${escapedAccessPolicy}"`) as string, pageId };
}

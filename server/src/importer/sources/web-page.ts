import * as cheerio from "cheerio";
import type { ScraperRule, SourceConfigByKind } from "../../db/schema";
import { ensureOk, type Fetch, type Sleep } from "../../http";
import type { SourceGame } from "./index";

// Some sites refuse requests that do not look like they come from a browser, and some refuse
// browser versions that they consider too old.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

// Stops a list whose "next" links never end, for example a calendar or a broken pager.
const MAX_PAGES = 200;
const PAGE_GAP_MS = 1000;

/**
 * Each scraper rule selects elements inside the elements that the rule before it selected. The
 * text of each element that the last rule selects is one game name. With a next page rule, the
 * games of each following page are read too.
 */
export async function fetchWebPage(
  { url, scraperRules, nextPageRule }: SourceConfigByKind["web_page"],
  { fetch, sleep }: { fetch: Fetch; sleep: Sleep },
): Promise<SourceGame[]> {
  const sourceGames: SourceGame[] = [];
  const readUrls = new Set<string>();
  let pageUrl: string | undefined = url;
  while (pageUrl && !readUrls.has(pageUrl)) {
    if (readUrls.size === MAX_PAGES) throw new Error(`The list has more than ${MAX_PAGES} pages.`);
    if (readUrls.size > 0) await sleep(PAGE_GAP_MS);
    readUrls.add(pageUrl);

    const response = await ensureOk(
      await fetch(pageUrl, { headers: { "User-Agent": BROWSER_USER_AGENT } }),
    );
    const $ = cheerio.load(await response.text());

    let selected = $.root().children();
    for (const rule of scraperRules) selected = selected.find(toCssSelector(rule));
    for (const element of selected.toArray()) {
      sourceGames.push({ name: $(element).text().replace(/\s+/g, " "), bggId: null });
    }

    const nextHref = nextPageRule && $(toCssSelector(nextPageRule)).first().attr("href");
    pageUrl = nextHref ? new URL(nextHref, pageUrl).href : undefined;
  }
  return sourceGames;
}

/** An attribute with a list of values matches an element that has any one of the values. */
export function toCssSelector({ element, attributes = {} }: ScraperRule) {
  let selectors = [element];
  for (const [attribute, valueOrValues] of Object.entries(attributes)) {
    const values = Array.isArray(valueOrValues) ? valueOrValues : [valueOrValues];
    // "~=" matches one class among the space-separated classes of an element.
    const operator = attribute === "class" ? "~=" : "=";
    selectors = selectors.flatMap((selector) =>
      values.map((value) => `${selector}[${attribute}${operator}${JSON.stringify(value)}]`),
    );
  }
  return selectors.join(", ");
}

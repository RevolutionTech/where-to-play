import * as cheerio from "cheerio";
import type { ScraperRule } from "../../db/schema";
import { ensureOk, type Fetch } from "../../http";
import type { SourceGame } from "./index";

// Some sites refuse requests that do not look like they come from a browser.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

/**
 * Each scraper rule selects elements inside the elements that the rule before it selected. The
 * text of each element that the last rule selects is one game name.
 */
export async function fetchWebPage(
  { url, scraperRules }: { url: string; scraperRules: ScraperRule[] },
  { fetch }: { fetch: Fetch },
): Promise<SourceGame[]> {
  const response = await ensureOk(
    await fetch(url, { headers: { "User-Agent": BROWSER_USER_AGENT } }),
  );
  const $ = cheerio.load(await response.text());

  let selected = $.root().children();
  for (const rule of scraperRules) selected = selected.find(toCssSelector(rule));

  return selected
    .toArray()
    .map((element) => ({ name: $(element).text().replace(/\s+/g, " "), bggId: null }));
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

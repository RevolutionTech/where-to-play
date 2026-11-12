import { decodeHTML } from "entities";
import { XMLParser } from "fast-xml-parser";
import { ensureOk, type Fetch, redactUrl, type Sleep, sleep } from "../http";

const BGG_URL = "https://boardgamegeek.com";

/** The BGG thing API returns at most this many items for each request. */
export const THINGS_PER_REQUEST = 20;

export function bggGameUrl(bggId: number) {
  return `${BGG_URL}/boardgame/${bggId}`;
}

/** Game details that both the collection API and the thing API give. */
export type BggStats = {
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlaytimeMinutes: number | null;
  maxPlaytimeMinutes: number | null;
  bggRating: number | null;
  bggRank: number | null;
};

export type BggCollectionItem = { bggId: number; name: string; stats: BggStats };

export type BggThing = BggStats & {
  bggId: number;
  /** Playmats, terrain, card sleeves and such. Sources list them next to games. */
  isAccessory: boolean;
  name: string;
  alternateNames: string[];
  description: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  /** Platform names, such as "Board Game Arena", from the game's BGG families. */
  digitalImplementations: string[];
};

export type BggSearchResult = {
  bggId: number;
  /** The name that matched the query. It can be an alternate name of the game. */
  name: string;
  yearPublished: number | null;
  isExpansion: boolean;
};

export type BggClientOptions = {
  apiToken: string;
  /** Defaults to the real BGG. E2E tests point it at a fake BGG. */
  baseUrl?: string;
  /** Only tag changes need a logged-in session. */
  credentials?: { username: string; password: string };
  fetch?: Fetch;
  sleep?: Sleep;
  /** BGG rate-limits clients that send requests too fast. */
  minRequestGapMs?: number;
  /** BGG answers 202 while it prepares a collection, and 429 when a client is too fast. */
  maxRetries?: number;
  maxBackoffMs?: number;
};

type XmlAttributes = Record<string, string>;
type XmlItem = Record<string, unknown>;

const DIGITAL_IMPLEMENTATION_PREFIX = "Digital Implementations: ";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
  isArray: (tagName) => ["item", "name", "rank", "error", "link"].includes(tagName),
});

/** BGG refused the login, so no tag change can succeed until a new client logs in. */
export class BggLoginError extends Error {}

export class BggClient {
  private readonly options: Required<Omit<BggClientOptions, "credentials">> &
    Pick<BggClientOptions, "credentials">;
  private sessionCookie: string | undefined;
  private loginError: BggLoginError | undefined;
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(options: BggClientOptions) {
    this.options = {
      fetch,
      sleep,
      minRequestGapMs: 2000,
      maxRetries: 8,
      maxBackoffMs: 60_000,
      ...options,
      baseUrl: options.baseUrl ?? BGG_URL,
    };
  }

  async fetchCollection(username: string): Promise<BggCollectionItem[]> {
    const url = withParams(`${this.options.baseUrl}/xmlapi2/collection`, {
      username,
      own: "1",
      excludesubtype: "boardgameexpansion",
      // Stats cost no extra request, and they refresh games that are already in the database.
      stats: "1",
    });
    const items = parseItems(await (await this.request(url)).text());
    return items.map(toCollectionItem);
  }

  /** Returns the BGG ID of the first exact match, or null when nothing matches. */
  async search(name: string): Promise<number | null> {
    for (const query of searchQueries(name)) {
      const url = withParams(`${this.options.baseUrl}/xmlapi2/search`, { ...query, exact: "1" });
      const [firstItem] = parseItems(await (await this.request(url)).text());
      if (firstItem) return Number(firstItem.id);
    }
    return null;
  }

  /** Returns each board game and expansion whose name contains the query, in BGG's order. */
  async searchGames(query: string): Promise<BggSearchResult[]> {
    const url = withParams(`${this.options.baseUrl}/xmlapi2/search`, {
      query,
      type: "boardgame,boardgameexpansion",
    });
    const items = parseItems(await (await this.request(url)).text());
    // BGG lists each expansion twice: once as a board game, and once as an expansion.
    const expansionIds = new Set(
      items.filter((item) => item.type === "boardgameexpansion").map((item) => Number(item.id)),
    );
    const results = new Map<number, BggSearchResult>();
    for (const item of items) {
      const bggId = Number(item.id);
      if (results.has(bggId)) continue;
      results.set(bggId, {
        bggId,
        name: asArray(item.name as XmlAttributes[] | undefined)[0]?.value ?? "",
        yearPublished: numberAttribute(item.yearpublished),
        isExpansion: expansionIds.has(bggId),
      });
    }
    return [...results.values()];
  }

  async fetchThings(bggIds: number[]): Promise<BggThing[]> {
    const things: BggThing[] = [];
    for (let start = 0; start < bggIds.length; start += THINGS_PER_REQUEST) {
      const url = withParams(`${this.options.baseUrl}/xmlapi2/thing`, {
        id: bggIds.slice(start, start + THINGS_PER_REQUEST).join(","),
        type: "boardgame,boardgameexpansion,boardgameaccessory",
        stats: "1",
      });
      const items = parseItems(await (await this.request(url)).text());
      things.push(...items.map(toThing));
    }
    return things;
  }

  async addTag(bggId: number, tag: string) {
    await this.login();
    await this.request(`${this.options.baseUrl}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newtags: tag, objecttype: "thing", objectid: bggId }),
    });
  }

  async removeTag(bggId: number, tag: string) {
    await this.login();
    const url = withParams(`${this.options.baseUrl}/api/tags`, {
      objecttype: "thing",
      objectid: String(bggId),
    });
    const { mytags } = (await (await this.request(url)).json()) as {
      mytags: { rawtag: string; pinid: number }[];
    };
    const pin = mytags.find((myTag) => myTag.rawtag === tag);
    if (pin)
      await this.request(`${this.options.baseUrl}/api/pins/${pin.pinid}`, { method: "DELETE" });
  }

  private async login() {
    if (this.sessionCookie) return;
    // Each try would fail the same way, and more refused logins make BGG's firewall stricter.
    if (this.loginError) throw this.loginError;
    try {
      const { credentials } = this.options;
      if (!credentials) throw new Error("BGG tag changes need BGG_USERNAME and BGG_PASSWORD.");
      await this.waitForRequestGap();
      const response = await ensureOk(
        await this.options.fetch(`${this.options.baseUrl}/login/api/v1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentials }),
        }),
      );
      const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
      if (cookies.length === 0) throw new Error("BGG login gave no session cookie.");
      this.sessionCookie = cookies.join("; ");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.loginError = new BggLoginError(`BGG login failed: ${message}`);
      throw this.loginError;
    }
  }

  private async waitForRequestGap() {
    const gapLeftMs = this.lastRequestAt + this.options.minRequestGapMs - Date.now();
    if (gapLeftMs > 0) await this.options.sleep(gapLeftMs);
    this.lastRequestAt = Date.now();
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let backoffMs = Math.min(2000, this.options.maxBackoffMs);
    for (let retry = 0; ; retry++) {
      await this.waitForRequestGap();

      const response = await this.options.fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.options.apiToken}`,
          ...(this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
          ...init.headers,
        },
      });
      if (response.status !== 202 && response.status !== 429) return ensureOk(response);

      await response.body?.cancel();
      if (retry >= this.options.maxRetries) {
        throw new Error(
          `BGG still answered ${response.status} after ${retry} retries: ${redactUrl(url)}`,
        );
      }
      console.log(`  BGG answered ${response.status}. Waiting ${backoffMs / 1000} s.`);
      await this.options.sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, this.options.maxBackoffMs);
    }
  }
}

/** The legacy importer's search order, which finds more games than one exact search. */
function searchQueries(name: string) {
  const cleanName = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const queries = [
    { query: name, type: "boardgame" },
    { query: cleanName, type: "boardgame" },
  ];
  if (cleanName.includes("expansion")) {
    const baseName = cleanName.replace("expansion", "").replace(/\s+/g, " ").trim();
    queries.unshift({ query: baseName, type: "boardgameexpansion" });
  }
  return queries.filter(
    (query, index) =>
      queries.findIndex((other) => other.query === query.query && other.type === query.type) ===
      index,
  );
}

function withParams(url: string, params: Record<string, string>) {
  return `${url}?${new URLSearchParams(params)}`;
}

function parseItems(xml: string): XmlItem[] {
  const parsed = xmlParser.parse(xml) as {
    items?: { item?: XmlItem[] };
    errors?: { error?: { message?: string }[] };
  };
  if (parsed.errors) {
    const messages = asArray(parsed.errors.error).map((error) => error.message);
    throw new Error(`BGG returned an error: ${messages.join("; ")}`);
  }
  return parsed.items?.item ?? [];
}

function toCollectionItem(item: XmlItem): BggCollectionItem {
  const stats = (item.stats ?? {}) as XmlAttributes & { rating?: Record<string, unknown> };
  return {
    bggId: Number(item.objectid),
    name: textOf(asArray(item.name)[0]) ?? "",
    stats: {
      yearPublished: numberOrNull(textOf(item.yearpublished)),
      minPlayers: numberOrNull(stats.minplayers),
      maxPlayers: numberOrNull(stats.maxplayers),
      minPlaytimeMinutes: numberOrNull(stats.minplaytime),
      maxPlaytimeMinutes: numberOrNull(stats.maxplaytime),
      bggRating: numberAttribute(stats.rating?.average),
      bggRank: overallRank(stats.rating),
    },
  };
}

function toThing(item: XmlItem): BggThing {
  const names = asArray(item.name as XmlAttributes[] | undefined);
  const ratings = (item.statistics as { ratings?: Record<string, unknown> } | undefined)?.ratings;
  const description = textOf(item.description);
  const links = asArray(item.link as XmlAttributes[] | undefined);

  return {
    bggId: Number(item.id),
    isAccessory: item.type === "boardgameaccessory",
    name: names.find((name) => name.type === "primary")?.value ?? "",
    alternateNames: names.flatMap((name) =>
      name.type === "alternate" && name.value ? [name.value] : [],
    ),
    // BGG escapes HTML in descriptions twice, so one pass of the XML parser leaves entities.
    description: description ? decodeHTML(description) : null,
    thumbnailUrl: textOf(item.thumbnail)?.trim() || null,
    imageUrl: textOf(item.image)?.trim() || null,
    digitalImplementations: links.flatMap((link) =>
      link.type === "boardgamefamily" && link.value?.startsWith(DIGITAL_IMPLEMENTATION_PREFIX)
        ? [link.value.slice(DIGITAL_IMPLEMENTATION_PREFIX.length)]
        : [],
    ),
    yearPublished: numberAttribute(item.yearpublished),
    minPlayers: numberAttribute(item.minplayers),
    maxPlayers: numberAttribute(item.maxplayers),
    minPlaytimeMinutes: numberAttribute(item.minplaytime),
    maxPlaytimeMinutes: numberAttribute(item.maxplaytime),
    bggRating: numberAttribute(ratings?.average),
    bggRank: overallRank(ratings),
  };
}

function overallRank(ratings: Record<string, unknown> | undefined) {
  const ranks = asArray((ratings?.ranks as { rank?: XmlAttributes[] } | undefined)?.rank);
  return numberAttribute(ranks.find((rank) => rank.id === "1"));
}

function numberAttribute(element: unknown): number | null {
  return numberOrNull((element as XmlAttributes | undefined)?.value);
}

/** BGG uses 0, "N/A", and "Not Ranked" for unknown values. */
function numberOrNull(text: string | null | undefined): number | null {
  const value = Number(text);
  return text && Number.isFinite(value) && value !== 0 ? value : null;
}

function textOf(element: unknown): string | null {
  if (typeof element === "string") return element;
  const text = (element as { "#text"?: string } | undefined)?.["#text"];
  return text ?? null;
}

function asArray<T>(value: T[] | T | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

import type { PageCacheEntry } from "../types/pageCache";
import type { SavedProduct } from "../types/product";

export const MAX_PAGE_CACHE_ENTRIES = 15;

export function normalizePageCacheEntries(
  entries: PageCacheEntry[],
): PageCacheEntry[] {
  const deduped = new Map<string, PageCacheEntry>();

  for (const entry of [...entries].sort(
    (a, b) => Number(new Date(b.capturedAt)) - Number(new Date(a.capturedAt)),
  )) {
    const key = entry.canonicalUrl || entry.url;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()].slice(0, MAX_PAGE_CACHE_ENTRIES);
}

export function mergePageCacheEntry(
  current: PageCacheEntry[],
  entry: PageCacheEntry,
): PageCacheEntry[] {
  return normalizePageCacheEntries([entry, ...current]);
}

function getEntryUrls(entry: PageCacheEntry): Set<string> {
  const urls = [entry.url, entry.canonicalUrl, entry.product?.url].filter(
    (value): value is string => Boolean(value),
  );

  return new Set(urls);
}

function getProductUrls(product: Pick<SavedProduct, "url">): Set<string> {
  return new Set([product.url].filter(Boolean));
}

export function removeAssociatedPageCacheEntries(
  entries: PageCacheEntry[],
  products: Array<Pick<SavedProduct, "url">>,
): PageCacheEntry[] {
  if (!products.length) {
    return normalizePageCacheEntries(entries);
  }

  const productUrls = new Set(
    products.flatMap((product) => [...getProductUrls(product)]),
  );

  return normalizePageCacheEntries(
    entries.filter((entry) => {
      const entryUrls = getEntryUrls(entry);

      for (const url of entryUrls) {
        if (productUrls.has(url)) {
          return false;
        }
      }

      return true;
    }),
  );
}

export function prunePageCacheEntriesForBasket(
  entries: PageCacheEntry[],
  products: SavedProduct[],
): PageCacheEntry[] {
  if (!products.length) {
    return [];
  }

  const productUrls = new Set(
    products.flatMap((product) => [...getProductUrls(product)]),
  );

  return normalizePageCacheEntries(
    entries.filter((entry) => {
      const entryUrls = getEntryUrls(entry);
      for (const url of entryUrls) {
        if (productUrls.has(url)) {
          return true;
        }
      }

      return false;
    }),
  );
}

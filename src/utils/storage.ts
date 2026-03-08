import type { DetectedProduct, SavedProduct } from "../types/product";
import type { PageCacheEntry } from "../types/pageCache";
import type { BridgeStatus } from "./bridge";
import {
  MAX_PRODUCTS,
  mergeProductIntoBasket,
  normalizeBasket,
  removeProductFromBasketItems,
} from "./basket";
import {
  mergePageCacheEntry,
  normalizePageCacheEntries,
  removeAssociatedPageCacheEntries,
} from "./pageCache";
import { syncBasketToBridge, syncPageCacheToBridge } from "./bridge";

const STORAGE_KEY = "smartbuy:comparison-basket";
const PAGE_CACHE_STORAGE_KEY = "smartbuy:page-cache";

function readStorage<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) =>
      resolve(result[key] as T | undefined),
    );
  });
}

function writeStorage<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

export async function getSavedProducts(): Promise<SavedProduct[]> {
  const items = await readStorage<SavedProduct[]>(STORAGE_KEY);
  return Array.isArray(items) ? items : [];
}

export async function getSavedPageCache(): Promise<PageCacheEntry[]> {
  const items = await readStorage<PageCacheEntry[]>(PAGE_CACHE_STORAGE_KEY);
  return Array.isArray(items) ? normalizePageCacheEntries(items) : [];
}

export async function saveComparisonBasket(
  products: SavedProduct[],
): Promise<SavedProduct[]> {
  const normalizedProducts = normalizeBasket(products);

  await writeStorage(STORAGE_KEY, normalizedProducts);
  await syncBasketToBridge(normalizedProducts);
  return normalizedProducts;
}

export async function addProductToBasket(
  product: DetectedProduct,
): Promise<SavedProduct[]> {
  const current = await getSavedProducts();
  return saveComparisonBasket(mergeProductIntoBasket(current, product));
}

export async function removeProductFromBasket(
  productId: string,
): Promise<SavedProduct[]> {
  const current = await getSavedProducts();
  const nextProducts = removeProductFromBasketItems(current, productId);
  const removedProduct = current.find((product) => product.id === productId);

  if (removedProduct) {
    const currentPageCache = await getSavedPageCache();
    const nextPageCache = removeAssociatedPageCacheEntries(currentPageCache, [
      removedProduct,
    ]);
    await writeStorage(PAGE_CACHE_STORAGE_KEY, nextPageCache);
  }

  return saveComparisonBasket(nextProducts);
}

export async function clearBasket(): Promise<void> {
  const [currentProducts, currentPageCache] = await Promise.all([
    getSavedProducts(),
    getSavedPageCache(),
  ]);

  await writeStorage(STORAGE_KEY, []);

  const nextPageCache = removeAssociatedPageCacheEntries(
    currentPageCache,
    currentProducts,
  );
  await writeStorage(PAGE_CACHE_STORAGE_KEY, nextPageCache);
  await syncBasketToBridge([]);
}

export async function syncSavedProductsWithBridge(): Promise<BridgeStatus> {
  const current = await getSavedProducts();
  return syncBasketToBridge(current);
}

export async function savePageCacheEntry(
  entry: PageCacheEntry,
): Promise<PageCacheEntry[]> {
  const current = await getSavedPageCache();
  const nextEntries = mergePageCacheEntry(current, entry);

  await writeStorage(PAGE_CACHE_STORAGE_KEY, nextEntries);
  await syncPageCacheToBridge(entry);
  return nextEntries;
}

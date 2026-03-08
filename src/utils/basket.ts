import type { DetectedProduct, SavedProduct } from "../types/product";

export const MAX_PRODUCTS = 5;

function isSavedProduct(
  product: DetectedProduct | SavedProduct,
): product is SavedProduct {
  return "id" in product && "savedAt" in product;
}

function toSavedProduct(
  product: DetectedProduct | SavedProduct,
  existing?: SavedProduct,
): SavedProduct {
  if (isSavedProduct(product)) {
    return product;
  }

  return {
    ...(existing ?? {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
    }),
    ...product,
  };
}

export function normalizeBasket(products: SavedProduct[]): SavedProduct[] {
  return products
    .slice(0, MAX_PRODUCTS)
    .sort((a, b) => Number(new Date(b.savedAt)) - Number(new Date(a.savedAt)));
}

export function mergeProductIntoBasket(
  current: SavedProduct[],
  product: DetectedProduct | SavedProduct,
): SavedProduct[] {
  const existing = current.find((item) => {
    if (isSavedProduct(product) && item.id === product.id) {
      return true;
    }

    return item.url === product.url;
  });

  const nextProduct = toSavedProduct(product, existing);

  return normalizeBasket([
    nextProduct,
    ...current.filter((item) => item.id !== nextProduct.id),
  ]);
}

export function removeProductFromBasketItems(
  current: SavedProduct[],
  productId: string,
): SavedProduct[] {
  return normalizeBasket(current.filter((product) => product.id !== productId));
}

export function replaceBasketProducts(
  products: Array<DetectedProduct | SavedProduct>,
): SavedProduct[] {
  const nextProducts = products.map((product) => toSavedProduct(product));
  return normalizeBasket(nextProducts);
}

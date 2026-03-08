import type { SavedProduct } from "../types/product";

export function formatCurrency(
  value: number | null,
  currency?: string | null,
): string {
  if (value == null || Number.isNaN(value)) {
    return "No disponible";
  }

  const normalizedCurrency = currency || "USD";

  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${normalizedCurrency}`;
  }
}

export function formatNumber(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("es-ES").format(value);
}

export function truncateText(value: string, maxLength = 72): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

export function domainToStoreName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const [name] = hostname.split(".");
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "Tienda";
  }
}

export function getComparableSpecKeys(
  products: SavedProduct[],
  limit = 8,
): string[] {
  const frequencies = new Map<string, number>();

  for (const product of products) {
    for (const key of Object.keys(product.specs)) {
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    }
  }

  return [...frequencies.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }

      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([key]) => key);
}

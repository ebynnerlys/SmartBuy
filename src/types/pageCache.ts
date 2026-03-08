import type { DetectedProduct } from "./product";

export interface PageCacheEntry {
  id: string;
  url: string;
  canonicalUrl: string | null;
  title: string;
  store: string | null;
  capturedAt: string;
  html: string;
  textExcerpt: string;
  summary: string;
  meta: Record<string, string>;
  product: DetectedProduct | null;
}

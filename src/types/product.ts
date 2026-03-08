export type ProductSource = "schema" | "meta" | "dom";

export type ProductSpecs = Record<string, string>;

export interface DetectedProduct {
  title: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  store: string;
  image: string | null;
  url: string;
  rating: number | null;
  reviewsCount: number | null;
  specs: ProductSpecs;
  source: ProductSource;
}

export interface SavedProduct extends DetectedProduct {
  id: string;
  savedAt: string;
}

export type RecommendationMode =
  | "bestValue"
  | "cheapest"
  | "topRated"
  | "budget";

export interface RecommendationResult {
  mode: RecommendationMode;
  winner: SavedProduct;
  title: string;
  explanation: string;
  rationale: string[];
}

import type {
  RecommendationMode,
  RecommendationResult,
  SavedProduct,
} from "../types/product";

interface ProductScores {
  priceScore: number;
  ratingScore: number;
  reviewScore: number;
  completenessScore: number;
  bestValueScore: number;
}

function safeValue(value: number | null, fallback: number): number {
  return value == null || Number.isNaN(value) ? fallback : value;
}

function normalizeDescending(value: number, min: number, max: number): number {
  if (max === min) {
    return 1;
  }

  return 1 - (value - min) / (max - min);
}

function normalizeAscending(value: number, max: number): number {
  if (max <= 0) {
    return 1;
  }

  return value / max;
}

function buildScores(products: SavedProduct[]): Map<string, ProductScores> {
  const priced = products
    .filter((product) => product.price != null)
    .map((product) => product.price as number);
  const ratings = products.map((product) => safeValue(product.rating, 0));
  const reviews = products.map((product) => safeValue(product.reviewsCount, 0));
  const specCounts = products.map(
    (product) => Object.keys(product.specs).length,
  );

  const minPrice = priced.length ? Math.min(...priced) : 0;
  const maxPrice = priced.length ? Math.max(...priced) : 0;
  const maxRating = ratings.length ? Math.max(...ratings) : 0;
  const maxReviews = reviews.length ? Math.max(...reviews) : 0;
  const maxSpecs = specCounts.length ? Math.max(...specCounts) : 0;

  return new Map(
    products.map((product) => {
      const priceScore =
        product.price == null
          ? 0.35
          : normalizeDescending(product.price, minPrice, maxPrice);
      const ratingScore = normalizeAscending(
        safeValue(product.rating, 0),
        maxRating,
      );
      const reviewScore = normalizeAscending(
        Math.log1p(safeValue(product.reviewsCount, 0)),
        Math.log1p(maxReviews),
      );
      const completenessScore = normalizeAscending(
        Object.keys(product.specs).length,
        maxSpecs,
      );
      const bestValueScore =
        priceScore * 0.45 +
        ratingScore * 0.3 +
        reviewScore * 0.15 +
        completenessScore * 0.1;

      return [
        product.id,
        {
          priceScore,
          ratingScore,
          reviewScore,
          completenessScore,
          bestValueScore,
        },
      ];
    }),
  );
}

function getRationale(product: SavedProduct, scores: ProductScores): string[] {
  const reasons: string[] = [];

  if (product.price != null) {
    reasons.push(
      `Precio detectado con una puntuación de valor de ${scores.priceScore.toFixed(2)}.`,
    );
  }

  if (product.rating != null) {
    reasons.push(
      `Rating de ${product.rating.toFixed(1)} con confianza relativa de ${scores.reviewScore.toFixed(2)}.`,
    );
  }

  const specCount = Object.keys(product.specs).length;
  if (specCount > 0) {
    reasons.push(`Ficha enriquecida con ${specCount} atributos comparables.`);
  }

  return reasons;
}

export function getRecommendation(
  products: SavedProduct[],
  mode: RecommendationMode,
  budget?: number | null,
): RecommendationResult | null {
  if (!products.length) {
    return null;
  }

  const scores = buildScores(products);
  const withScores = products.map((product) => ({
    product,
    scores: scores.get(product.id)!,
  }));

  const cheapest = [...products]
    .filter((product) => product.price != null)
    .sort((a, b) => (a.price as number) - (b.price as number))[0];

  const topRated = [...products].sort((a, b) => {
    const ratingDiff = safeValue(b.rating, 0) - safeValue(a.rating, 0);
    if (ratingDiff !== 0) {
      return ratingDiff;
    }

    return safeValue(b.reviewsCount, 0) - safeValue(a.reviewsCount, 0);
  })[0];

  let winner = withScores.sort(
    (a, b) => b.scores.bestValueScore - a.scores.bestValueScore,
  )[0].product;
  let title = "Mejor calidad/precio";
  let explanation = `${winner.title} destaca por equilibrar mejor precio, rating y nivel de información.`;

  if (mode === "cheapest" && cheapest) {
    winner = cheapest;
    title = "Más barato";
    explanation = `${winner.title} es la opción con menor precio detectado dentro de la cesta actual.`;
  }

  if (mode === "topRated") {
    winner = topRated;
    title = "Mejor valorado";
    explanation = `${winner.title} lidera por rating y respaldo de opiniones visibles.`;
  }

  if (mode === "budget") {
    const normalizedBudget = budget ?? null;
    const candidates = products.filter(
      (product) =>
        normalizedBudget != null &&
        product.price != null &&
        product.price <= normalizedBudget,
    );

    if (candidates.length) {
      winner = candidates
        .map((product) => ({
          product,
          score: scores.get(product.id)!.bestValueScore,
        }))
        .sort((a, b) => b.score - a.score)[0].product;
      title = "Mejor para tu presupuesto";
      explanation = `${winner.title} entra en el presupuesto y ofrece el mejor equilibrio entre coste y calidad.`;
    } else {
      winner = cheapest ?? winner;
      title = "Sin opciones dentro del presupuesto";
      explanation =
        "Ningún producto entra en el presupuesto actual. Se sugiere la opción más barata como alternativa.";
    }
  }

  return {
    mode,
    winner,
    title,
    explanation,
    rationale: getRationale(winner, scores.get(winner.id)!),
  };
}

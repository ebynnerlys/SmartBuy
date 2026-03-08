import { useEffect, useMemo, useState } from "react";
import type { RecommendationMode, SavedProduct } from "../../src/types/product";
import {
  formatCurrency,
  formatNumber,
  getComparableSpecKeys,
  truncateText,
} from "../../src/utils/format";
import { getRecommendation } from "../../src/utils/recommendation";
import {
  clearBasket,
  getSavedProducts,
  removeProductFromBasket,
} from "../../src/utils/storage";

const recommendationModes: Array<{ key: RecommendationMode; label: string }> = [
  { key: "bestValue", label: "Calidad / precio" },
  { key: "cheapest", label: "Más barato" },
  { key: "topRated", label: "Mejor valorado" },
  { key: "budget", label: "Por presupuesto" },
];

const preferredSpecKeys = [
  "Marca",
  "ASIN",
  "Tamaño",
  "Tamaño de pantalla",
  "Modelo",
  "Color",
];

function getProductSpecsPreview(product: SavedProduct, limit = 3) {
  const selected: Array<[string, string]> = [];
  const usedKeys = new Set<string>();

  for (const key of preferredSpecKeys) {
    const value = product.specs[key];
    if (!value) {
      continue;
    }

    selected.push([key, value]);
    usedKeys.add(key);

    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const [key, value] of Object.entries(product.specs)) {
    if (usedKeys.has(key)) {
      continue;
    }

    selected.push([key, value]);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

export default function App() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<RecommendationMode>("bestValue");
  const [budgetInput, setBudgetInput] = useState("");

  useEffect(() => {
    void loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    const items = await getSavedProducts();
    setProducts(items);
    setLoading(false);
  }

  async function handleRemove(productId: string) {
    const items = await removeProductFromBasket(productId);
    setProducts(items);
  }

  async function handleClear() {
    await clearBasket();
    setProducts([]);
  }

  const comparableKeys = useMemo(
    () => getComparableSpecKeys(products),
    [products],
  );
  const parsedBudget = budgetInput
    ? Number.parseFloat(budgetInput.replace(",", "."))
    : null;
  const recommendation = useMemo(
    () => getRecommendation(products, mode, parsedBudget),
    [mode, parsedBudget, products],
  );

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">SmartBuy · MVP</p>
          <h1>Comparador inteligente para decidir mejor</h1>
          <p className="subtitle">
            Guarda productos mientras navegas y deja que SmartBuy te diga cuál
            conviene más.
          </p>
        </div>
        <div className="hero-actions">
          <button
            className="secondary-button"
            onClick={() => void loadProducts()}
          >
            Recargar cesta
          </button>
          <button
            className="ghost-button"
            disabled={!products.length}
            onClick={() => void handleClear()}
          >
            Vaciar cesta
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <strong>{products.length}</strong>
          <span>productos en comparación</span>
        </article>
        <article className="stat-card">
          <strong>
            {new Set(products.map((product) => product.store)).size}
          </strong>
          <span>tiendas distintas</span>
        </article>
        <article className="stat-card">
          <strong>
            {products.filter((product) => product.price != null).length
              ? formatCurrency(
                  Math.min(
                    ...products
                      .filter((product) => product.price != null)
                      .map((product) => product.price as number),
                  ),
                  products.find((product) => product.currency)?.currency,
                )
              : "—"}
          </strong>
          <span>precio mínimo</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header grow">
          <div>
            <h2>Recomendación</h2>
            <p className="section-copy">
              Elige el criterio con el que SmartBuy prioriza la decisión.
            </p>
          </div>
          <div className="mode-grid">
            {recommendationModes.map((item) => (
              <button
                key={item.key}
                className={
                  item.key === mode ? "mode-button active" : "mode-button"
                }
                onClick={() => setMode(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {mode === "budget" ? (
          <label className="budget-field">
            <span>Presupuesto máximo</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={budgetInput}
              onChange={(event) => setBudgetInput(event.target.value)}
              placeholder="Ej. 199.99"
            />
          </label>
        ) : null}

        {recommendation ? (
          <article className="recommendation-card">
            <div className="winner-header">
              <div>
                <p className="winner-tag">{recommendation.title}</p>
                <h3>{recommendation.winner.title}</h3>
                <p className="winner-copy">{recommendation.explanation}</p>
              </div>
              <div className="winner-price">
                {formatCurrency(
                  recommendation.winner.price,
                  recommendation.winner.currency,
                )}
              </div>
            </div>

            <div className="winner-meta">
              <span>{recommendation.winner.store}</span>
              <span>⭐ {recommendation.winner.rating?.toFixed(1) ?? "—"}</span>
              <span>
                {formatNumber(recommendation.winner.reviewsCount)} reviews
              </span>
            </div>

            <div className="spec-pill-row winner-specs">
              {getProductSpecsPreview(recommendation.winner).map(
                ([key, value]) => (
                  <span key={key} className="spec-pill compact">
                    <strong>{key}:</strong> {truncateText(value, 28)}
                  </span>
                ),
              )}
            </div>

            <ul className="rationale-list">
              {recommendation.rationale.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ) : (
          <div className="empty-state">
            Guarda al menos un producto para generar una recomendación.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Tabla comparativa</h2>
            <p className="section-copy">
              Comparación normalizada entre 2 y 5 productos guardados.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Cargando productos guardados…</div>
        ) : products.length ? (
          <div className="comparison-scroll">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Campo</th>
                  {products.map((product) => (
                    <th key={product.id}>
                      <div className="product-column-header">
                        {product.image ? (
                          <img src={product.image} alt={product.title} />
                        ) : null}
                        <strong>{truncateText(product.title, 40)}</strong>
                        <span>{product.store}</span>
                        <div className="spec-pill-row column-specs">
                          {getProductSpecsPreview(product, 2).map(
                            ([key, value]) => (
                              <span key={key} className="spec-pill compact">
                                <strong>{key}:</strong>{" "}
                                {truncateText(value, 24)}
                              </span>
                            ),
                          )}
                        </div>
                        <button
                          className="inline-link"
                          onClick={() => void handleRemove(product.id)}
                        >
                          Quitar
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Precio</td>
                  {products.map((product) => (
                    <td key={`${product.id}-price`}>
                      {formatCurrency(product.price, product.currency)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Rating</td>
                  {products.map((product) => (
                    <td key={`${product.id}-rating`}>
                      {product.rating?.toFixed(1) ?? "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Reviews</td>
                  {products.map((product) => (
                    <td key={`${product.id}-reviews`}>
                      {formatNumber(product.reviewsCount)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Descripción</td>
                  {products.map((product) => (
                    <td key={`${product.id}-description`}>
                      {product.description ?? "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>URL</td>
                  {products.map((product) => (
                    <td key={`${product.id}-url`}>
                      <a href={product.url} target="_blank" rel="noreferrer">
                        Abrir ficha
                      </a>
                    </td>
                  ))}
                </tr>
                {comparableKeys.map((key) => (
                  <tr key={key}>
                    <td>{key}</td>
                    {products.map((product) => (
                      <td key={`${product.id}-${key}`}>
                        {product.specs[key] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            Aún no hay productos. Empieza guardando uno desde el popup.
          </div>
        )}
      </section>
    </main>
  );
}

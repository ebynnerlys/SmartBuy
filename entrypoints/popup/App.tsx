import { useEffect, useMemo, useState } from "react";
import type {
  DetectedProduct,
  RecommendationMode,
  SavedProduct,
} from "../../src/types/product";
import type { PageCacheEntry } from "../../src/types/pageCache";
import type { BridgeStatus } from "../../src/utils/bridge";
import {
  formatCurrency,
  formatNumber,
  getComparableSpecKeys,
  truncateText,
} from "../../src/utils/format";
import { getBridgeStatus } from "../../src/utils/bridge";
import { getRecommendation } from "../../src/utils/recommendation";
import {
  addProductToBasket,
  clearBasket,
  getSavedProducts,
  removeProductFromBasket,
  savePageCacheEntry,
  syncSavedProductsWithBridge,
} from "../../src/utils/storage";

interface ExtractResponse {
  product: DetectedProduct | null;
  pageCache?: PageCacheEntry;
}

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

function getProductSpecsPreview(
  product: Pick<DetectedProduct, "specs">,
  limit = 3,
): Array<[string, string]> {
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

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs[0]),
    );
  });
}

function extractFromActiveTab(tabId: number): Promise<ExtractResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "smartbuy:extract-product" },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve({
          product: response?.product ?? null,
          pageCache: response?.pageCache,
        });
      },
    );
  });
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detectedProduct, setDetectedProduct] =
    useState<DetectedProduct | null>(null);
  const [savedProducts, setSavedProducts] = useState<SavedProduct[]>([]);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncingBridge, setSyncingBridge] = useState(false);
  const [showComparator, setShowComparator] = useState(false);
  const [mode, setMode] = useState<RecommendationMode>("bestValue");
  const [budgetInput, setBudgetInput] = useState("");

  useEffect(() => {
    void initialize();
  }, []);

  const isBasketFull = savedProducts.length >= 5;
  const comparableKeys = useMemo(
    () => getComparableSpecKeys(savedProducts, 6),
    [savedProducts],
  );
  const comparisonRows = useMemo(
    () => [
      {
        label: "Precio",
        values: savedProducts.map((product) =>
          formatCurrency(product.price, product.currency),
        ),
      },
      {
        label: "Rating",
        values: savedProducts.map(
          (product) => `⭐ ${product.rating?.toFixed(1) ?? "—"}`,
        ),
      },
      {
        label: "Reviews",
        values: savedProducts.map(
          (product) => `${formatNumber(product.reviewsCount)} reviews`,
        ),
      },
      {
        label: "Descripción",
        values: savedProducts.map((product) => product.description ?? "—"),
      },
      ...comparableKeys.map((key) => ({
        label: key,
        values: savedProducts.map((product) => product.specs[key] ?? "—"),
      })),
    ],
    [comparableKeys, savedProducts],
  );
  const parsedBudget = budgetInput
    ? Number.parseFloat(budgetInput.replace(",", "."))
    : null;
  const recommendation = useMemo(
    () => getRecommendation(savedProducts, mode, parsedBudget),
    [mode, parsedBudget, savedProducts],
  );
  const alreadySaved = useMemo(
    () => savedProducts.some((product) => product.url === detectedProduct?.url),
    [detectedProduct?.url, savedProducts],
  );

  async function initialize() {
    try {
      setLoading(true);
      setError(null);
      const [basket, activeTab, bridge] = await Promise.all([
        getSavedProducts(),
        getActiveTab(),
        getBridgeStatus(),
      ]);
      setSavedProducts(basket);
      setBridgeStatus(bridge);

      if (!activeTab?.id || !activeTab.url) {
        setError("No se pudo acceder a la pestaña activa.");
        return;
      }

      if (
        /^(chrome|edge|about|moz-extension|chrome-extension):/i.test(
          activeTab.url,
        )
      ) {
        setError(
          "Abre una ficha de producto en una web normal para detectar información.",
        );
        return;
      }

      const { product, pageCache } = await extractFromActiveTab(activeTab.id);
      setDetectedProduct(product);

      if (pageCache) {
        void savePageCacheEntry(pageCache);
      }

      if (!product) {
        setError("No se detectó un producto claro en esta página.");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? "No se pudo analizar la página actual. Recarga la pestaña e inténtalo otra vez."
          : "No se pudo analizar la página actual.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!detectedProduct) {
      return;
    }

    try {
      setSaving(true);
      const basket = await addProductToBasket(detectedProduct);
      setSavedProducts(basket);
      setBridgeStatus(await getBridgeStatus());
      setNotice(
        alreadySaved
          ? "Producto actualizado en la cesta."
          : "Producto guardado en la cesta.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncBridge() {
    try {
      setSyncingBridge(true);
      const status = await syncSavedProductsWithBridge();
      setBridgeStatus(status);
      setNotice(
        status.connected
          ? "Cesta sincronizada con VS Code por MCP."
          : "No se pudo conectar con el bridge MCP local.",
      );
    } finally {
      setSyncingBridge(false);
    }
  }

  async function handleRemove(productId: string) {
    const basket = await removeProductFromBasket(productId);
    setSavedProducts(basket);
    setBridgeStatus(await getBridgeStatus());
  }

  async function handleClear() {
    await clearBasket();
    setSavedProducts([]);
    setBridgeStatus(await getBridgeStatus());
    setShowComparator(false);
  }

  return (
    <main
      className={showComparator ? "popup-shell comparator-open" : "popup-shell"}
    >
      <section className="hero-card">
        <div>
          <p className="eyebrow">SmartBuy</p>
          <h1>Tu cesta inteligente</h1>
          <p className="subtitle">
            Guarda lo que ves ahora y compáralo después sin perder contexto.
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => setShowComparator(true)}
        >
          Abrir comparador
        </button>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <strong>{savedProducts.length}</strong>
          <span>productos guardados</span>
        </article>
        <article className="stat-card">
          <strong>{detectedProduct?.store ?? "—"}</strong>
          <span>tienda actual</span>
        </article>
      </section>

      <section className="bridge-card">
        <div>
          <p className="eyebrow">MCP para VS Code</p>
          <strong>
            {bridgeStatus?.connected
              ? "Conectado a VS Code"
              : "Bridge MCP no disponible"}
          </strong>
          <p className="bridge-copy">
            {bridgeStatus?.connected
              ? `Bridge activo en ${bridgeStatus.endpoint} con ${bridgeStatus.productCount ?? 0} producto(s) sincronizados y ${bridgeStatus.pageCacheCount ?? 0} página(s) cacheadas.`
              : "Inicia `npm run mcp` o arranca el servidor SmartBuy desde VS Code para conectar la extensión."}
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={syncingBridge}
          onClick={() => void handleSyncBridge()}
        >
          {syncingBridge ? "Sincronizando…" : "Sincronizar con VS Code"}
        </button>
      </section>

      {notice ? <div className="notice success">{notice}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Producto detectado</h2>
          <button className="ghost-button" onClick={() => void initialize()}>
            Reintentar
          </button>
        </div>

        {loading ? (
          <div className="empty-state">Analizando la ficha actual…</div>
        ) : detectedProduct ? (
          <article className="product-card">
            {detectedProduct.image ? (
              <img
                className="product-image"
                src={detectedProduct.image}
                alt={detectedProduct.title}
              />
            ) : (
              <div className="product-image placeholder">Sin imagen</div>
            )}
            <div className="product-content">
              <p className="store-badge">{detectedProduct.store}</p>
              <div className="spec-pill-row">
                {getProductSpecsPreview(detectedProduct).map(([key, value]) => (
                  <span key={key} className="spec-pill">
                    <strong>{key}:</strong> {truncateText(value, 28)}
                  </span>
                ))}
              </div>
              <h3>{truncateText(detectedProduct.title, 96)}</h3>
              <p className="price">
                {formatCurrency(
                  detectedProduct.price,
                  detectedProduct.currency,
                )}
              </p>
              <div className="metrics">
                <span>⭐ {detectedProduct.rating?.toFixed(1) ?? "—"}</span>
                <span>
                  {formatNumber(detectedProduct.reviewsCount)} reviews
                </span>
                <span>{Object.keys(detectedProduct.specs).length} specs</span>
              </div>
              {detectedProduct.description ? (
                <p className="detected-description">
                  {truncateText(detectedProduct.description, 220)}
                </p>
              ) : null}
              <ul className="spec-list">
                {Object.entries(detectedProduct.specs)
                  .slice(0, 4)
                  .map(([key, value]) => (
                    <li key={key}>
                      <strong>{key}:</strong> {value}
                    </li>
                  ))}
              </ul>
              <div className="actions-row">
                <button
                  className="primary-button"
                  disabled={saving || (!alreadySaved && isBasketFull)}
                  onClick={() => void handleSave()}
                >
                  {saving
                    ? "Guardando…"
                    : alreadySaved
                      ? "Actualizar producto"
                      : "Guardar en cesta"}
                </button>
                <a
                  className="link-button"
                  href={detectedProduct.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver página
                </a>
              </div>
              {!alreadySaved && isBasketFull ? (
                <p className="hint">
                  La cesta MVP admite hasta 5 productos a la vez.
                </p>
              ) : null}
            </div>
          </article>
        ) : (
          <div className="empty-state">
            No hay un producto reconocible en la pestaña actual.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Cesta rápida</h2>
          <div className="inline-actions">
            <span className="counter">{savedProducts.length}/5</span>
            {savedProducts.length >= 2 ? (
              <button
                className="ghost-button small-button"
                onClick={() => setShowComparator(true)}
              >
                Comparar
              </button>
            ) : null}
          </div>
        </div>

        {savedProducts.length ? (
          <ul className="basket-list">
            {savedProducts.map((product) => (
              <li key={product.id} className="basket-item">
                <div>
                  <strong>{truncateText(product.title, 56)}</strong>
                  <span>
                    {product.store} ·{" "}
                    {formatCurrency(product.price, product.currency)}
                  </span>
                  <div className="spec-pill-row basket-specs">
                    {getProductSpecsPreview(product, 2).map(([key, value]) => (
                      <span key={key} className="spec-pill compact">
                        <strong>{key}:</strong> {truncateText(value, 24)}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state small">
            Guarda entre 2 y 5 productos para empezar a comparar.
          </div>
        )}
      </section>

      {showComparator ? (
        <section className="modal-overlay">
          <div className="modal-card">
            <div className="panel-header modal-header">
              <div>
                <p className="eyebrow">Comparador inline</p>
                <h2>Compara sin salir del popup</h2>
              </div>
              <button
                className="ghost-button"
                onClick={() => setShowComparator(false)}
              >
                Cerrar
              </button>
            </div>

            <div className="modal-actions">
              <div className="mode-grid compact-mode-grid">
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
              <div className="inline-actions">
                <button
                  className="ghost-button small-button"
                  disabled={!savedProducts.length}
                  onClick={() => void handleClear()}
                >
                  Vaciar cesta
                </button>
              </div>
            </div>

            {mode === "budget" ? (
              <label className="budget-field compact-budget-field">
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
              <article className="recommendation-card compact-recommendation-card">
                <div className="winner-top-row">
                  <div>
                    <p className="winner-tag">{recommendation.title}</p>
                    <h3>{truncateText(recommendation.winner.title, 80)}</h3>
                    <p className="winner-copy">{recommendation.explanation}</p>
                  </div>
                  <strong className="winner-price compact-winner-price">
                    {formatCurrency(
                      recommendation.winner.price,
                      recommendation.winner.currency,
                    )}
                  </strong>
                </div>
                <div className="winner-meta">
                  <span>{recommendation.winner.store}</span>
                  <span>
                    ⭐ {recommendation.winner.rating?.toFixed(1) ?? "—"}
                  </span>
                  <span>
                    {formatNumber(recommendation.winner.reviewsCount)} reviews
                  </span>
                </div>
                <div className="spec-pill-row winner-specs">
                  {getProductSpecsPreview(recommendation.winner).map(
                    ([key, value]) => (
                      <span key={key} className="spec-pill compact">
                        <strong>{key}:</strong> {truncateText(value, 26)}
                      </span>
                    ),
                  )}
                </div>
              </article>
            ) : (
              <div className="empty-state small">
                Guarda al menos 2 productos para comparar mejor.
              </div>
            )}

            {savedProducts.length ? (
              <div className="popup-comparison-content">
                <div className="popup-product-grid">
                  {savedProducts.map((product) => (
                    <article key={product.id} className="popup-product-card">
                      <div className="popup-product-top">
                        <div>
                          <strong>{truncateText(product.title, 54)}</strong>
                          <p className="popup-product-meta">{product.store}</p>
                          <div className="spec-pill-row popup-product-specs">
                            {getProductSpecsPreview(product, 2).map(
                              ([key, value]) => (
                                <span key={key} className="spec-pill compact">
                                  <strong>{key}:</strong>{" "}
                                  {truncateText(value, 20)}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                        <button
                          className="inline-link"
                          onClick={() => void handleRemove(product.id)}
                        >
                          Quitar
                        </button>
                      </div>

                      <div className="popup-product-highlights">
                        <span>
                          {formatCurrency(product.price, product.currency)}
                        </span>
                        <span>⭐ {product.rating?.toFixed(1) ?? "—"}</span>
                        <span>
                          {formatNumber(product.reviewsCount)} reviews
                        </span>
                      </div>

                      <a
                        className="link-button compact-link-button"
                        href={product.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir ficha
                      </a>
                    </article>
                  ))}
                </div>

                <div className="comparison-rows">
                  {comparisonRows.map((row) => (
                    <section key={row.label} className="comparison-row-card">
                      <h3 className="comparison-row-title">{row.label}</h3>
                      <div className="comparison-row-values">
                        {row.values.map((value, index) => (
                          <div
                            key={`${row.label}-${savedProducts[index]?.id ?? index}`}
                            className="comparison-value-card"
                          >
                            <span className="comparison-value-store">
                              {savedProducts[index]?.store ?? "Producto"}
                            </span>
                            <strong>{truncateText(value, 90)}</strong>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type {
  DetectedProduct,
  RecommendationMode,
  SavedProduct,
} from "../src/types/product";
import type { PageCacheEntry } from "../src/types/pageCache";
import {
  MAX_PRODUCTS,
  mergeProductIntoBasket,
  normalizeBasket,
  removeProductFromBasketItems,
  replaceBasketProducts,
} from "../src/utils/basket";
import {
  mergePageCacheEntry,
  normalizePageCacheEntries,
  removeAssociatedPageCacheEntries,
} from "../src/utils/pageCache";
import { getRecommendation } from "../src/utils/recommendation";

const BRIDGE_PORT = 3210;
const DATA_DIRECTORY = path.resolve(process.cwd(), ".smartbuy");
const DATA_FILE = path.join(DATA_DIRECTORY, "basket.json");
const PAGE_CACHE_FILE = path.join(DATA_DIRECTORY, "page-cache.json");

const specsSchema = z.record(z.string(), z.string());
const detectedProductSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional().default(null),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  store: z.string().min(1),
  image: z.string().nullable(),
  url: z.string().url(),
  rating: z.number().nullable(),
  reviewsCount: z.number().int().nullable(),
  specs: specsSchema,
  source: z.enum(["schema", "meta", "dom"]),
});
const savedProductSchema = detectedProductSchema.extend({
  id: z.string().min(1),
  savedAt: z.string().min(1),
});
const basketSchema = z.array(savedProductSchema).max(MAX_PRODUCTS);
const pageCacheSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  canonicalUrl: z.string().url().nullable(),
  title: z.string().min(1),
  store: z.string().nullable(),
  capturedAt: z.string().min(1),
  html: z.string(),
  textExcerpt: z.string(),
  summary: z.string(),
  meta: z.record(z.string(), z.string()),
  product: detectedProductSchema.nullable(),
});
const pageCacheListSchema = z.array(pageCacheSchema);

async function ensureJsonFile(
  filePath: string,
  fallback = "[]\n",
): Promise<void> {
  await mkdir(DATA_DIRECTORY, { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, fallback, "utf8");
  }
}

async function ensureDataFile(): Promise<void> {
  await ensureJsonFile(DATA_FILE);
}

async function ensurePageCacheFile(): Promise<void> {
  await ensureJsonFile(PAGE_CACHE_FILE);
}

async function readBasket(): Promise<SavedProduct[]> {
  await ensureDataFile();
  const raw = await readFile(DATA_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    const validated = basketSchema.safeParse(parsed);
    if (!validated.success) {
      return [];
    }

    return normalizeBasket(validated.data);
  } catch {
    return [];
  }
}

async function writeBasket(products: SavedProduct[]): Promise<SavedProduct[]> {
  const normalized = normalizeBasket(products);
  await ensureDataFile();
  await writeFile(
    DATA_FILE,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}

async function readPageCache(): Promise<PageCacheEntry[]> {
  await ensurePageCacheFile();
  const raw = await readFile(PAGE_CACHE_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    const validated = pageCacheListSchema.safeParse(parsed);
    if (!validated.success) {
      return [];
    }

    return normalizePageCacheEntries(validated.data);
  } catch {
    return [];
  }
}

async function writePageCache(
  entries: PageCacheEntry[],
): Promise<PageCacheEntry[]> {
  const normalized = normalizePageCacheEntries(entries);
  await ensurePageCacheFile();
  await writeFile(
    PAGE_CACHE_FILE,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}

function createTextResult(
  text: string,
  structuredContent?: Record<string, unknown>,
) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function summarizeProduct(product: SavedProduct): string {
  const price =
    product.price == null
      ? "sin precio"
      : `${product.price} ${product.currency ?? ""}`.trim();
  const rating =
    product.rating == null ? "sin rating" : `${product.rating.toFixed(1)}★`;
  return `- ${product.title} · ${product.store} · ${price} · ${rating}`;
}

function summarizeBasket(products: SavedProduct[]): string {
  if (!products.length) {
    return "La cesta de SmartBuy está vacía.";
  }

  return [
    `SmartBuy tiene ${products.length} producto(s) guardados:`,
    ...products.map((product) => summarizeProduct(product)),
  ].join("\n");
}

function summarizePageEntry(entry: PageCacheEntry): string {
  return [
    `- ${entry.title}`,
    entry.store ? `(${entry.store})` : null,
    `· ${entry.url}`,
    `· ${entry.capturedAt}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function summarizePageCache(entries: PageCacheEntry[]): string {
  if (!entries.length) {
    return "No hay páginas cacheadas en SmartBuy.";
  }

  return [
    `SmartBuy tiene ${entries.length} página(s) cacheadas:`,
    ...entries.map((entry) => summarizePageEntry(entry)),
  ].join("\n");
}

function createBridgeResponse(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function isExistingSmartBuyBridgeAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`);

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as { ok?: boolean };
    return payload.ok === true;
  } catch {
    return false;
  }
}

async function startBridgeServer() {
  const bridgeServer = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const requestUrl = new URL(
        request.url ?? "/",
        `http://127.0.0.1:${BRIDGE_PORT}`,
      );

      if (method === "OPTIONS") {
        createBridgeResponse(response, 204, {});
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/health") {
        const [products, pageCache] = await Promise.all([
          readBasket(),
          readPageCache(),
        ]);
        createBridgeResponse(response, 200, {
          ok: true,
          productCount: products.length,
          pageCacheCount: pageCache.length,
          storageFile: DATA_FILE,
          pageCacheFile: PAGE_CACHE_FILE,
        });
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/basket") {
        const products = await readBasket();
        createBridgeResponse(response, 200, {
          ok: true,
          productCount: products.length,
          products,
        });
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/page-cache") {
        const entries = await readPageCache();
        createBridgeResponse(response, 200, {
          ok: true,
          pageCacheCount: entries.length,
          entries,
        });
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/basket/replace") {
        const body = await readJsonBody(request);
        const parsed = z
          .object({
            products: z.array(savedProductSchema.or(detectedProductSchema)),
          })
          .safeParse(body);

        if (!parsed.success) {
          createBridgeResponse(response, 400, {
            ok: false,
            error: "Payload inválido para reemplazar la cesta.",
          });
          return;
        }

        const currentProducts = await readBasket();
        const nextProducts = replaceBasketProducts(parsed.data.products);
        const removedProducts = currentProducts.filter(
          (currentProduct) =>
            !nextProducts.some(
              (nextProduct) => nextProduct.url === currentProduct.url,
            ),
        );
        const currentPageCache = await readPageCache();
        const nextPageCache = removedProducts.length
          ? removeAssociatedPageCacheEntries(currentPageCache, removedProducts)
          : currentPageCache;
        const [products, pageCache] = await Promise.all([
          writeBasket(nextProducts),
          writePageCache(nextPageCache),
        ]);

        createBridgeResponse(response, 200, {
          ok: true,
          productCount: products.length,
          pageCacheCount: pageCache.length,
          products,
        });
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/basket/save") {
        const body = await readJsonBody(request);
        const parsed = z
          .object({ product: detectedProductSchema.or(savedProductSchema) })
          .safeParse(body);

        if (!parsed.success) {
          createBridgeResponse(response, 400, {
            ok: false,
            error: "Payload inválido para guardar producto.",
          });
          return;
        }

        const current = await readBasket();
        const products = await writeBasket(
          mergeProductIntoBasket(
            current,
            parsed.data.product as DetectedProduct | SavedProduct,
          ),
        );
        createBridgeResponse(response, 200, {
          ok: true,
          productCount: products.length,
          products,
        });
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/page-cache/save") {
        const body = await readJsonBody(request);
        const parsed = z.object({ entry: pageCacheSchema }).safeParse(body);

        if (!parsed.success) {
          createBridgeResponse(response, 400, {
            ok: false,
            error: "Payload inválido para guardar caché de página.",
          });
          return;
        }

        const current = await readPageCache();
        const entries = await writePageCache(
          mergePageCacheEntry(current, parsed.data.entry),
        );
        const products = await readBasket();

        createBridgeResponse(response, 200, {
          ok: true,
          productCount: products.length,
          pageCacheCount: entries.length,
          entries,
        });
        return;
      }

      createBridgeResponse(response, 404, {
        ok: false,
        error: "Ruta no encontrada.",
      });
    } catch (error) {
      createBridgeResponse(response, 500, {
        ok: false,
        error:
          error instanceof Error ? error.message : "Error interno del bridge.",
      });
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      bridgeServer.once("error", reject);
      bridgeServer.listen(BRIDGE_PORT, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EADDRINUSE" &&
      (await isExistingSmartBuyBridgeAvailable())
    ) {
      console.error(
        `[smartbuy-mcp] Reutilizando bridge HTTP ya activo en http://127.0.0.1:${BRIDGE_PORT}`,
      );

      return {
        bridgeServer: null,
        ownsBridge: false,
      };
    }

    throw error;
  }

  console.error(
    `[smartbuy-mcp] Bridge HTTP activo en http://127.0.0.1:${BRIDGE_PORT}`,
  );
  console.error(`[smartbuy-mcp] Almacenando datos en ${DATA_FILE}`);

  return {
    bridgeServer,
    ownsBridge: true,
  };
}

function registerTools(server: McpServer) {
  server.registerTool(
    "smartbuy_list_products",
    {
      description:
        "Lista los productos guardados por SmartBuy que la extensión sincronizó con el bridge local.",
    },
    async () => {
      const products = await readBasket();
      return createTextResult(summarizeBasket(products), {
        products,
        count: products.length,
      });
    },
  );

  server.registerTool(
    "smartbuy_get_recommendation",
    {
      description:
        "Devuelve la mejor recomendación de compra usando los productos sincronizados por SmartBuy.",
      inputSchema: {
        mode: z
          .enum(["bestValue", "cheapest", "topRated", "budget"])
          .default("bestValue"),
        budget: z.number().positive().optional(),
      },
    },
    async ({ mode, budget }) => {
      const products = await readBasket();
      const recommendation = getRecommendation(
        products,
        mode as RecommendationMode,
        budget ?? null,
      );

      if (!recommendation) {
        return createTextResult(
          "No hay productos suficientes en SmartBuy para recomendar una compra.",
          { products: [], recommendation: null },
        );
      }

      return createTextResult(
        `${recommendation.title}: ${recommendation.winner.title}. ${recommendation.explanation}`,
        { recommendation, count: products.length },
      );
    },
  );

  server.registerTool(
    "smartbuy_save_product",
    {
      description:
        "Guarda manualmente un producto en la cesta compartida de SmartBuy para que VS Code y la extensión trabajen con la misma información.",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().nullable().optional().default(null),
        price: z.number().nullable(),
        currency: z.string().nullable(),
        store: z.string().min(1),
        image: z.string().nullable(),
        url: z.string().url(),
        rating: z.number().nullable(),
        reviewsCount: z.number().int().nullable(),
        specs: specsSchema.default({}),
        source: z.enum(["schema", "meta", "dom"]).default("dom"),
      },
    },
    async (product) => {
      const current = await readBasket();
      const nextProducts = await writeBasket(
        mergeProductIntoBasket(current, product as DetectedProduct),
      );

      return createTextResult(
        `Producto guardado en SmartBuy. La cesta ahora tiene ${nextProducts.length} elemento(s).`,
        { products: nextProducts, count: nextProducts.length },
      );
    },
  );

  server.registerTool(
    "smartbuy_remove_product",
    {
      description:
        "Elimina un producto de la cesta compartida de SmartBuy por su id.",
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      const current = await readBasket();
      const removedProduct = current.find((product) => product.id === id);
      const nextProducts = removeProductFromBasketItems(current, id);
      const currentPageCache = await readPageCache();
      const nextPageCache = removedProduct
        ? removeAssociatedPageCacheEntries(currentPageCache, [removedProduct])
        : currentPageCache;

      const [savedProducts, pageCache] = await Promise.all([
        writeBasket(nextProducts),
        writePageCache(nextPageCache),
      ]);

      return createTextResult(
        `Producto eliminado. La cesta ahora tiene ${savedProducts.length} elemento(s) y ${pageCache.length} caché(s) asociadas.`,
        {
          products: savedProducts,
          pageCacheCount: pageCache.length,
          count: savedProducts.length,
        },
      );
    },
  );

  server.registerTool(
    "smartbuy_clear_basket",
    {
      description: "Vacía la cesta compartida de SmartBuy.",
    },
    async () => {
      const [currentProducts, currentPageCache] = await Promise.all([
        readBasket(),
        readPageCache(),
      ]);
      const nextPageCache = removeAssociatedPageCacheEntries(
        currentPageCache,
        currentProducts,
      );

      await Promise.all([writeBasket([]), writePageCache(nextPageCache)]);

      return createTextResult("La cesta compartida de SmartBuy quedó vacía.", {
        products: [],
        pageCacheCount: nextPageCache.length,
        count: 0,
      });
    },
  );

  server.registerTool(
    "smartbuy_list_page_cache",
    {
      description:
        "Lista las páginas cacheadas por SmartBuy con resumen, URL y fecha de captura.",
    },
    async () => {
      const entries = await readPageCache();
      return createTextResult(summarizePageCache(entries), {
        entries,
        count: entries.length,
      });
    },
  );

  server.registerTool(
    "smartbuy_get_page_cache",
    {
      description:
        "Devuelve la página cacheada más reciente de SmartBuy o la asociada a una URL concreta, incluyendo HTML sanitizado y el producto detectado.",
      inputSchema: {
        url: z.string().url().optional(),
      },
    },
    async ({ url }) => {
      const entries = await readPageCache();
      const entry = url
        ? entries.find((item) => item.url === url || item.canonicalUrl === url)
        : entries[0];

      if (!entry) {
        return createTextResult(
          url
            ? `No existe una página cacheada para ${url}.`
            : "No hay páginas cacheadas en SmartBuy.",
          { entry: null },
        );
      }

      return createTextResult(
        `${entry.summary}\nURL: ${entry.url}\nCapturada: ${entry.capturedAt}\nHTML sanitizado: ${entry.html.length} caracteres.`,
        { entry },
      );
    },
  );

  server.registerTool(
    "smartbuy_bridge_status",
    {
      description:
        "Indica si el bridge local de SmartBuy está levantado y cuántos productos compartidos tiene disponibles.",
    },
    async () => {
      const [products, pageCache] = await Promise.all([
        readBasket(),
        readPageCache(),
      ]);
      return createTextResult(
        `Bridge activo en http://127.0.0.1:${BRIDGE_PORT} con ${products.length} producto(s) y ${pageCache.length} página(s) cacheadas.`,
        {
          port: BRIDGE_PORT,
          productCount: products.length,
          pageCacheCount: pageCache.length,
          storageFile: DATA_FILE,
          pageCacheFile: PAGE_CACHE_FILE,
        },
      );
    },
  );
}

async function main() {
  await ensureDataFile();
  await ensurePageCacheFile();
  const { bridgeServer, ownsBridge } = await startBridgeServer();

  const server = new McpServer(
    {
      name: "smartbuy",
      version: "0.2.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    if (bridgeServer && ownsBridge) {
      await new Promise<void>((resolve, reject) => {
        bridgeServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error("[smartbuy-mcp] Error fatal:", error);
  process.exit(1);
});

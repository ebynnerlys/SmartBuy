import type { SavedProduct } from "../types/product";
import type { PageCacheEntry } from "../types/pageCache";

export interface BridgeStatus {
  connected: boolean;
  endpoint: string;
  productCount: number | null;
  pageCacheCount?: number | null;
  error: string | null;
}

const MCP_BRIDGE_URL = "http://127.0.0.1:3210";

interface BridgeHealthResponse {
  ok: boolean;
  productCount: number;
  pageCacheCount?: number;
}

function normalizeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Error desconocido";
}

async function fetchBridge<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 1500,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${MCP_BRIDGE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function disconnectedStatus(reason: unknown): BridgeStatus {
  return {
    connected: false,
    endpoint: MCP_BRIDGE_URL,
    productCount: null,
    error: normalizeError(reason),
  };
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  try {
    const payload = await fetchBridge<BridgeHealthResponse>("/health", {
      method: "GET",
    });

    return {
      connected: payload.ok,
      endpoint: MCP_BRIDGE_URL,
      productCount: payload.productCount,
      pageCacheCount: payload.pageCacheCount ?? null,
      error: null,
    };
  } catch (reason) {
    return disconnectedStatus(reason);
  }
}

export async function syncBasketToBridge(
  products: SavedProduct[],
): Promise<BridgeStatus> {
  try {
    const payload = await fetchBridge<BridgeHealthResponse>("/basket/replace", {
      method: "POST",
      body: JSON.stringify({ products }),
    });

    return {
      connected: payload.ok,
      endpoint: MCP_BRIDGE_URL,
      productCount: payload.productCount,
      pageCacheCount: payload.pageCacheCount ?? null,
      error: null,
    };
  } catch (reason) {
    return disconnectedStatus(reason);
  }
}

export async function syncPageCacheToBridge(
  entry: PageCacheEntry,
): Promise<BridgeStatus> {
  try {
    const payload = await fetchBridge<BridgeHealthResponse>(
      "/page-cache/save",
      {
        method: "POST",
        body: JSON.stringify({ entry }),
      },
    );

    return {
      connected: payload.ok,
      endpoint: MCP_BRIDGE_URL,
      productCount: payload.productCount,
      pageCacheCount: payload.pageCacheCount ?? null,
      error: null,
    };
  } catch (reason) {
    return disconnectedStatus(reason);
  }
}

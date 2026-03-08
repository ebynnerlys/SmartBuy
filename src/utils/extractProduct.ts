import type {
  DetectedProduct,
  ProductSource,
  ProductSpecs,
} from "../types/product";
import type { PageCacheEntry } from "../types/pageCache";
import { domainToStoreName } from "./format";

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function getMetaContent(selector: string): string | null {
  const element = document.querySelector<HTMLMetaElement>(selector);
  return cleanText(element?.content ?? null) || null;
}

function parseDecimal(
  rawValue: string | number | null | undefined,
): number | null {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  const text = cleanText(String(rawValue ?? ""));
  if (!text) {
    return null;
  }

  const matches = text.match(/\d+[\d.,]*/g);
  const candidate = matches?.sort((a, b) => b.length - a.length)[0];
  if (!candidate) {
    return null;
  }

  const lastComma = candidate.lastIndexOf(",");
  const lastDot = candidate.lastIndexOf(".");
  let normalized = candidate;

  if (lastComma > lastDot) {
    normalized = candidate.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalized = candidate.replace(/,/g, "");
  } else {
    normalized = candidate.replace(",", ".");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(
  rawValue: string | number | null | undefined,
): number | null {
  const text = cleanText(String(rawValue ?? ""));
  if (!text) {
    return null;
  }

  const grouped = text.match(/\d{1,3}(?:[.,\s]\d{3})+/)?.[0];
  if (grouped) {
    const parsed = Number.parseInt(grouped.replace(/\D/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const plain = text.match(/\d+/g)?.sort((a, b) => b.length - a.length)[0];
  if (!plain) {
    return null;
  }

  const parsed = Number.parseInt(plain, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRating(
  rawValue: string | number | null | undefined,
): number | null {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  const text = cleanText(String(rawValue ?? ""));
  if (!text) {
    return null;
  }

  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  for (const candidate of matches) {
    const parsed = Number.parseFloat(candidate.replace(",", "."));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5) {
      return parsed;
    }
  }

  return parseDecimal(text);
}

function flattenJsonLd(input: unknown): Record<string, any>[] {
  if (!input) {
    return [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => flattenJsonLd(item));
  }

  if (typeof input === "object") {
    const record = input as Record<string, any>;
    const graph = record["@graph"];
    return [record, ...flattenJsonLd(graph)];
  }

  return [];
}

function readStructuredProduct(): Record<string, any> | null {
  const scripts = [
    ...document.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    ),
  ];

  for (const script of scripts) {
    const text = script.textContent;
    if (!text) {
      continue;
    }

    try {
      const parsed = JSON.parse(text);
      const product = flattenJsonLd(parsed).find((item) => {
        const type = item["@type"];
        return (
          type === "Product" ||
          (Array.isArray(type) && type.includes("Product"))
        );
      });

      if (product) {
        return product;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractSpecsFromStructuredData(
  product: Record<string, any> | null,
): ProductSpecs {
  const specs: ProductSpecs = {};

  if (!product) {
    return specs;
  }

  const candidates: Array<[string, unknown]> = [
    ["Marca", product.brand?.name ?? product.brand],
    ["Modelo", product.model],
    ["Color", product.color],
    ["Material", product.material],
    ["Categoría", product.category],
    ["SKU", product.sku],
  ];

  for (const [label, value] of candidates) {
    const text = cleanText(String(value ?? ""));
    if (text) {
      specs[label] = text;
    }
  }

  const additional = Array.isArray(product.additionalProperty)
    ? product.additionalProperty
    : [];

  for (const property of additional) {
    const name = cleanText(property?.name);
    const value = cleanText(property?.value);
    if (name && value) {
      specs[name] = value;
    }
  }

  return specs;
}

function addSpec(specs: ProductSpecs, key: string, value: string): void {
  const normalizedKey = cleanText(key);
  const normalizedValue = cleanText(value);

  if (!normalizedKey || !normalizedValue) {
    return;
  }

  if (normalizedKey.length > 70 || normalizedValue.length > 240) {
    return;
  }

  specs[normalizedKey] = normalizedValue;
}

function queryTexts(selectors: string[], limit = 10): string[] {
  const values: string[] = [];

  for (const selector of selectors) {
    const elements = [...document.querySelectorAll<HTMLElement>(selector)];
    for (const element of elements) {
      const text = cleanText(element.textContent);
      if (!text) {
        continue;
      }

      values.push(text);
      if (values.length >= limit) {
        return values;
      }
    }
  }

  return values;
}

function uniqueTexts(values: string[], limit = 8): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = cleanText(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function trimDescription(text: string, maxLength = 700): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractDescriptionFromStructuredData(
  product: Record<string, any> | null,
): string | null {
  const description = cleanText(product?.description);
  return description || null;
}

function extractDescriptionFromDom(title: string): string | null {
  const metaDescription =
    getMetaContent('meta[name="description"]') ||
    getMetaContent('meta[property="og:description"]') ||
    getMetaContent('meta[name="twitter:description"]');

  const bulletTexts = uniqueTexts(
    queryTexts(
      [
        "#feature-bullets li span.a-list-item",
        "#feature-bullets li",
        "[data-feature-name='featurebullets'] li",
        "#productFactsDesktopExpander li",
        "#productFactsDesktop_feature_div li",
      ],
      8,
    ),
    6,
  ).filter((item) => item.length > 20);

  const paragraphTexts = uniqueTexts(
    queryTexts(
      [
        "#productDescription p",
        "#productDescription span",
        "#aplus p",
        "#aplus span",
        "#productOverview_feature_div td",
      ],
      10,
    ),
    4,
  ).filter((item) => item.length > 30 && item !== title);

  const descriptionParts = uniqueTexts(
    [metaDescription ?? "", ...bulletTexts, ...paragraphTexts],
    6,
  ).filter((item) => item && item !== title);

  if (!descriptionParts.length) {
    return null;
  }

  return trimDescription(descriptionParts.join(" "));
}

function extractAmazonSpecs(): ProductSpecs {
  const specs: ProductSpecs = {};

  const rowSelectors = [
    "#productDetails_techSpec_section_1 tr",
    "#productDetails_detailBullets_sections1 tr",
    "#technicalSpecifications_section_1 tr",
    "#productOverview_feature_div tr",
  ];

  for (const selector of rowSelectors) {
    for (const row of document.querySelectorAll<HTMLTableRowElement>(
      selector,
    )) {
      const header = cleanText(
        row.querySelector<HTMLElement>("th, td:first-child")?.textContent,
      );
      const value = cleanText(
        row.querySelector<HTMLElement>("td:last-child")?.textContent,
      );
      addSpec(specs, header, value);
    }
  }

  const bulletSelectors = [
    "#detailBullets_feature_div li",
    "#detailBulletsWrapper_feature_div li",
    "#glance_icons_div li",
  ];

  for (const selector of bulletSelectors) {
    for (const item of document.querySelectorAll<HTMLElement>(selector)) {
      const label =
        cleanText(
          item.querySelector<HTMLElement>(".a-text-bold")?.textContent,
        ) ||
        cleanText(
          item.querySelector<HTMLElement>("span:first-child")?.textContent,
        );
      const value = cleanText(item.textContent).replace(label, "").trim();
      addSpec(specs, label.replace(/[:：]\s*$/, ""), value);
    }
  }

  return specs;
}

function enrichMonitorSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const nextSpecs = { ...specs };
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;

  const inferredSpecs: Array<[string, RegExp]> = [
    ["Tamaño de pantalla", /(\d{2}(?:[.,]\d+)?)\s*(?:inch|inches|pulgadas?)/i],
    ["Resolución", /(4K|UHD|QHD|FHD|1080p|1440p|\d{3,4}\s*x\s*\d{3,4})/i],
    ["Frecuencia de actualización", /(\d{2,3})\s*Hz/i],
    ["Panel", /(IPS|VA|TN|OLED|Mini-LED)/i],
    ["Tiempo de respuesta", /(\d+(?:[.,]\d+)?)\s*ms/i],
    ["Sincronización", /(FreeSync|G-SYNC|Adaptive Sync)/i],
  ];

  for (const [label, pattern] of inferredSpecs) {
    if (nextSpecs[label]) {
      continue;
    }

    const match = haystack.match(pattern);
    if (match?.[0]) {
      addSpec(nextSpecs, label, match[0]);
    }
  }

  return nextSpecs;
}

function addInferredSpecs(
  specs: ProductSpecs,
  haystack: string,
  inferredSpecs: Array<[string, RegExp]>,
): ProductSpecs {
  const nextSpecs = { ...specs };

  for (const [label, pattern] of inferredSpecs) {
    if (nextSpecs[label]) {
      continue;
    }

    const match = haystack.match(pattern);
    if (match?.[0]) {
      addSpec(nextSpecs, label, match[0]);
    }
  }

  return nextSpecs;
}

function getExistingSpecValue(
  specs: ProductSpecs,
  labels: string[],
): string | null {
  for (const label of labels) {
    const value = cleanText(specs[label]);
    if (value) {
      return value;
    }
  }

  return null;
}

function applyCanonicalSpecAliases(
  specs: ProductSpecs,
  aliases: Record<string, string[]>,
): ProductSpecs {
  const nextSpecs = { ...specs };

  for (const [targetLabel, candidateLabels] of Object.entries(aliases)) {
    if (cleanText(nextSpecs[targetLabel])) {
      continue;
    }

    const value = getExistingSpecValue(nextSpecs, candidateLabels);
    if (value) {
      addSpec(nextSpecs, targetLabel, value);
    }
  }

  return nextSpecs;
}

function enrichLaptopSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;
  const storageValue = getExistingSpecValue(specs, [
    "Almacenamiento",
    "Disco Duro",
    "Tamaño del disco duro",
    "Capacidad de almacenamiento de memoria",
  ]);
  const normalizedSpecs = storageValue
    ? { ...specs, Almacenamiento: storageValue }
    : specs;

  return addInferredSpecs(normalizedSpecs, haystack, [
    ["Tamaño de pantalla", /(1[0-9](?:[.,]\d+)?)\s*(?:inch|inches|pulgadas?)/i],
    [
      "Procesador",
      /(Intel\s+(?:Core\s+)?i[3579][^,;|)]*|AMD\s+Ryzen\s+[3579][^,;|)]*|Apple\s+M[1-4][^,;|)]*|Snapdragon\s+X[^,;|)]*)/i,
    ],
    ["RAM", /(8|12|16|18|24|32|36|64)\s*GB\s*(?:RAM|DDR[45])?/i],
    [
      "Almacenamiento",
      /(128|256|512|1024|1|2)\s*(?:GB|TB)\s*(?:SSD|NVMe|PCIe|eMMC)?/i,
    ],
    [
      "Gráfica",
      /(RTX\s*\d{3,4}|GTX\s*\d{3,4}|Radeon\s+RX\s*\d{4,5}|Intel\s+Arc[^,;|)]*)/i,
    ],
    [
      "Sistema operativo",
      /(Windows\s*1[01]|Windows\s*11\s*Pro|macOS|ChromeOS|FreeDOS|Ubuntu|Linux)/i,
    ],
  ]);
}

function enrichDesktopSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;
  const storageValue = getExistingSpecValue(specs, [
    "Almacenamiento",
    "Disco Duro",
    "Tamaño del disco duro",
    "Capacidad de almacenamiento de memoria",
  ]);
  const normalizedSpecs = storageValue
    ? { ...specs, Almacenamiento: storageValue }
    : specs;

  return addInferredSpecs(normalizedSpecs, haystack, [
    [
      "Procesador",
      /(Intel\s+(?:Core\s+)?i[3579][^,;|)]*|AMD\s+Ryzen\s+[3579][^,;|)]*|Intel\s+N\d{2,3}[^,;|)]*)/i,
    ],
    ["RAM", /(8|12|16|24|32|48|64|96|128)\s*GB\s*(?:RAM|DDR[45])?/i],
    [
      "Almacenamiento",
      /((?:128|256|512|1024)\s*GB\s*(?:SSD|NVMe|PCIe|HDD|Gen4)?|(?:1|2|4|8)\s*TB\s*(?:SSD|NVMe|PCIe|HDD|Gen4)?)/i,
    ],
    [
      "Gráfica",
      /(RTX\s*\d{3,4}|GTX\s*\d{3,4}|Radeon\s+RX\s*\d{4,5}|Intel\s+Arc[^,;|)]*)/i,
    ],
    [
      "Sistema operativo",
      /(Windows\s*1[01](?:\s*Home|\s*Pro)?|FreeDOS|Ubuntu|Linux)/i,
    ],
    ["Chipset", /(AMD\s+B\d{3,4}|Intel\s+Z\d{3,4}|Intel\s+H\d{3,4})/i],
  ]);
}

function enrichPhoneSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;
  const normalizedSpecs = applyCanonicalSpecAliases(specs, {
    Almacenamiento: [
      "Capacidad de almacenamiento de memoria",
      "Memoria de almacenamiento",
      "Tamaño del disco duro",
    ],
    RAM: ["Memoria RAM", "Tamaño de la memoria RAM instalada"],
    Batería: ["Capacidad de la batería"],
  });

  return addInferredSpecs(normalizedSpecs, haystack, [
    ["Tamaño de pantalla", /(6(?:[.,]\d{1,2})?)\s*(?:inch|inches|pulgadas?)/i],
    ["Almacenamiento", /(128|256|512|1024|1)\s*(?:GB|TB)(?!\s*(?:SSD|NVMe))/i],
    ["RAM", /(6|8|12|16|18|24)\s*GB\s*RAM/i],
    ["Cámara principal", /(4?8|5?0|6?4|108|200)\s*MP/i],
    ["Batería", /([34-9]\d{3})\s*mAh/i],
    ["Conectividad", /(5G|LTE|Wi-?Fi\s*6E?|Wi-?Fi\s*7)/i],
    [
      "Procesador",
      /(Snapdragon\s*[A-Z0-9+ -]+|Dimensity\s*\d{3,4}|Tensor\s*[A-Z0-9]+|A1[5-9]|A2\d|Exynos\s*\d{4}|Helio\s+[A-Z0-9+ -]+)/i,
    ],
    ["Sistema operativo", /(Android|iOS|HarmonyOS)/i],
  ]);
}

function enrichTvSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;
  const normalizedSpecs = applyCanonicalSpecAliases(specs, {
    "Tamaño de pantalla": [
      "Tamaño",
      "Tamaño del área de visualización de la pantalla con pie",
    ],
    Resolución: ["Resolución de la pantalla", "Máxima resolución de pantalla"],
    "Frecuencia de actualización": [
      "Velocidad de actualización",
      "Frecuencia de actualización",
    ],
    Conectividad: ["Tecnología de conectividad"],
  });

  return addInferredSpecs(normalizedSpecs, haystack, [
    [
      "Tamaño de pantalla",
      /(3[2-9]|4\d|5\d|6\d|7\d|8\d)\s*(?:inch|inches|pulgadas?)/i,
    ],
    ["Resolución", /(8K|4K|UHD|QLED\s*4K|FHD|1080p|2160p|3840\s*x\s*2160)/i],
    ["Panel", /(OLED|QLED|Mini-LED|LED|QNED|Neo\s+QLED)/i],
    ["Frecuencia de actualización", /(60|120|144)\s*Hz/i],
    ["Smart TV", /(Google\s*TV|Android\s*TV|Tizen|webOS|Fire\s*TV|Roku\s*TV)/i],
    ["HDR", /(HDR\b|HDR10\+?|Dolby\s*Vision|HLG)/i],
    [
      "Audio",
      /(Dolby\s*Atmos|Dolby\s*Audio|Object Tracking Sound(?:\s*Lite)?|DTS(?:\s*Virtual:X)?)/i,
    ],
    ["Asistente de voz", /(Alexa|Google Assistant|Asistente de Google|Bixby)/i],
    ["Gaming", /(Game Mode|ALLM|VRR|FreeSync|Modo Juego)/i],
  ]);
}

function enrichTabletSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;
  const normalizedSpecs = applyCanonicalSpecAliases(specs, {
    Almacenamiento: [
      "Capacidad de almacenamiento de memoria",
      "Memoria de almacenamiento",
      "Tamaño del disco duro",
    ],
    RAM: ["Memoria RAM", "Tamaño de la memoria RAM instalada"],
    "Tamaño de pantalla": [
      "Tamaño",
      "Tamaño del área de visualización de la pantalla con pie",
    ],
  });

  return addInferredSpecs(normalizedSpecs, haystack, [
    [
      "Tamaño de pantalla",
      /(7(?:[.,]\d+)?|8(?:[.,]\d+)?|9(?:[.,]\d+)?|1[0-4](?:[.,]\d+)?)\s*(?:inch|inches|pulgadas?)/i,
    ],
    [
      "Almacenamiento",
      /(64|128|256|512|1024|1)\s*(?:GB|TB)(?!\s*(?:SSD|NVMe))/i,
    ],
    ["RAM", /(4|6|8|12|16)\s*GB\s*(?:RAM|LPDDR[45])?/i],
    [
      "Conectividad",
      /(Wi-?Fi\s*6E?|Wi-?Fi\s*7|5G|LTE|Bluetooth\s*5(?:\.[0-9])?)/i,
    ],
    ["Sistema operativo", /(Android|iPadOS|Fire\s*OS|Windows\s*1[01])/i],
    [
      "Procesador",
      /(Snapdragon\s*[A-Z0-9+ -]+|Dimensity\s*\d{3,4}|Apple\s+M[1-4]|Tensor\s*[A-Z0-9]+)/i,
    ],
    ["Stylus", /(S Pen|Apple Pencil|stylus)/i],
  ]);
}

function enrichSmartwatchSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;
  const normalizedSpecs = applyCanonicalSpecAliases(specs, {
    Batería: ["Capacidad de la batería", "Duración de la batería"],
    Conectividad: ["Tecnología de conectividad"],
  });

  return addInferredSpecs(normalizedSpecs, haystack, [
    [
      "Tamaño de pantalla",
      /(1(?:[.,]\d{1,2})|2(?:[.,]\d{1,2})?)\s*(?:inch|inches|pulgadas?)/i,
    ],
    [
      "Batería",
      /([12-9]\d{2,3})\s*mAh|((?:1|2|3|4|5|6|7|10|14)\s*(?:d[ií]as|days|horas|hours))/i,
    ],
    ["Conectividad", /(Bluetooth\s*5(?:\.[0-9])?|LTE|GPS|NFC|Wi-?Fi)/i],
    ["Compatibilidad", /(Android|iPhone|iOS)/i],
    ["Resistencia", /(5\s*ATM|10\s*ATM|IP6[78]|MIL-STD-810H)/i],
    ["Sensores", /(ECG|SpO2|frecuencia cardiaca|heart rate|GPS)/i],
  ]);
}

function enrichSpeakerSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;
  const normalizedSpecs = applyCanonicalSpecAliases(specs, {
    Conectividad: ["Tecnología de conectividad"],
  });

  return addInferredSpecs(normalizedSpecs, haystack, [
    [
      "Tipo",
      /(soundbar|barra de sonido|altavoz(?:es)? port[aá]til(?:es)?|smart speaker|subwoofer|speaker)/i,
    ],
    ["Potencia", /(\d{2,4})\s*W(?!h)/i],
    [
      "Conectividad",
      /(Bluetooth\s*5(?:\.[0-9])?|Wi-?Fi|AirPlay|Aux|USB-C|HDMI\s*e?ARC)/i,
    ],
    ["Autonomía", /((?:6|8|10|12|15|20|24)\s*(?:horas|hours|hrs))/i],
    ["Asistente", /(Alexa|Google Assistant|Siri)/i],
    ["Resistencia", /(IPX[4-8]|IP67|IP68)/i],
  ]);
}

function enrichCameraSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;

  return addInferredSpecs(specs, haystack, [
    ["Resolución", /(12|16|20|24|26|33|45|50|61)\s*MP/i],
    ["Vídeo", /(4K|5\.3K|6K|8K|1080p)/i],
    ["Sensor", /(full frame|APS-C|Micro Four Thirds|1-inch|CMOS)/i],
    ["Montura", /(E-mount|RF mount|Z mount|L-mount|EF-M)/i],
    ["Zoom", /(\d{1,3})x\s*(?:optical\s*)?zoom/i],
    ["Estabilización", /(OIS|IBIS|estabilizaci[oó]n (?:de imagen|óptica))/i],
  ]);
}

function enrichConsoleSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;
  const normalizedSpecs = applyCanonicalSpecAliases(specs, {
    Almacenamiento: [
      "Capacidad de almacenamiento de memoria",
      "Memoria de almacenamiento",
      "Tamaño del disco duro",
    ],
  });

  return addInferredSpecs(normalizedSpecs, haystack, [
    ["Almacenamiento", /(256|512|1024|1|2)\s*(?:GB|TB)(?!\s*(?:SSD|NVMe))/i],
    ["Resolución", /(4K|8K|1440p|1080p)/i],
    ["Rendimiento", /(60\s*fps|120\s*fps|120\s*Hz)/i],
    ["Conectividad", /(Wi-?Fi\s*6E?|Bluetooth\s*5(?:\.[0-9])?|HDMI\s*2\.1)/i],
    ["Edición", /(Digital Edition|Slim|OLED|Lite)/i],
  ]);
}

function enrichHeadphoneSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const haystack = `${title} ${description ?? ""} ${Object.values(specs).join(" ")}`;

  return addInferredSpecs(specs, haystack, [
    ["Tipo", /(in-?ear|over-?ear|on-?ear|earbuds?|true wireless)/i],
    [
      "Cancelación de ruido",
      /(ANC|cancelaci[oó]n activa de ruido|noise cancelling)/i,
    ],
    ["Autonomía", /((?:1\d|2\d|3\d|4\d|5\d)\s*(?:horas|hours|hrs))/i],
    ["Conectividad", /(Bluetooth\s*(?:5\.[0-9]|5|6)?|USB-C|Jack\s*3\.5\s*mm)/i],
    ["Micrófono", /(micr[oó]fono(?:s)?|microphone(?:s)?)/i],
    ["Resistencia", /(IPX[4-8]|IP[4-6][4-8])/i],
  ]);
}

type ProductCategory =
  | "monitor"
  | "laptop"
  | "desktop"
  | "phone"
  | "tablet"
  | "smartwatch"
  | "tv"
  | "speaker"
  | "camera"
  | "console"
  | "headphones"
  | null;

function omitSpecs(
  specs: ProductSpecs,
  labelsToRemove: string[],
): ProductSpecs {
  if (!labelsToRemove.length) {
    return specs;
  }

  const ignored = new Set(labelsToRemove.map((label) => label.toLowerCase()));

  return Object.fromEntries(
    Object.entries(specs).filter(
      ([label]) => !ignored.has(label.toLowerCase()),
    ),
  );
}

function sanitizeSpecsForCategory(
  category: ProductCategory,
  specs: ProductSpecs,
): ProductSpecs {
  switch (category) {
    case "desktop":
      return omitSpecs(specs, [
        "Tamaño del área de visualización de la pantalla con pie",
        "Tamaño de pantalla",
        "Resolución de la pantalla",
        "Máxima resolución de pantalla",
        "Resolución",
        "Relación de aspecto",
        "Frecuencia de actualización",
        "Descripción de la superficie de pantalla",
        "Panel",
        "Tiempo de respuesta",
        "Sincronización",
      ]);
    case "phone":
    case "tablet":
    case "smartwatch":
      return omitSpecs(specs, [
        "Descripción de la tarjeta",
        "Descripción de la tarjeta gráfica",
        "Marca Chipset",
        "Número de puertos USB 2.0",
        "Número de puertos USB 3.0",
      ]);
    default:
      return specs;
  }
}

function detectProductCategory(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductCategory {
  const titleHaystack = `${title} ${description ?? ""}`.toLowerCase();
  const specHaystack = Object.values(specs).join(" ").toLowerCase();
  const combinedHaystack = `${titleHaystack} ${specHaystack}`;
  const monitorHaystack = combinedHaystack.replace(/displayport/g, " ");

  if (
    /laptop|notebook|ultrabook|macbook|chromebook|port[áa]til/.test(
      combinedHaystack,
    )
  ) {
    return "laptop";
  }

  if (
    /tablet|ipad|galaxy\s*tab|tab\s*s\d|surface\s+go|surface\s+pro|fire\s*hd|xiaomi\s*pad|lenovo\s*tab/.test(
      combinedHaystack,
    )
  ) {
    return "tablet";
  }

  if (
    /gaming\s*pc|desktop|computer\s*tower|torre\s+de\s+ordenador|ordenador\s+de\s+sobremesa|mini\s*pc|workstation/.test(
      combinedHaystack,
    )
  ) {
    return "desktop";
  }

  if (
    /smartphone|iphone|galaxy\s*[as]\d|pixel\s*\d|redmi\s*note|poco\s*[a-z0-9]+|oneplus|motorola|xiaomi\s*(?:\d|redmi)|huawei|honor|oppo|realme|celular|tel[eé]fono|m[oó]vil/.test(
      combinedHaystack,
    )
  ) {
    return "phone";
  }

  if (
    /smartwatch|smart\s*watch|apple\s*watch|galaxy\s*watch|pixel\s*watch|garmin|amazfit|fitbit/.test(
      combinedHaystack,
    )
  ) {
    return "smartwatch";
  }

  if (
    /smart\s*tv|televisor|tv\b|bravia|qled|oled\s*tv/.test(combinedHaystack)
  ) {
    return "tv";
  }

  if (
    /speaker|altavoz|parlante|bocina|soundbar|barra\s+de\s+sonido|echo\s*dot|homepod/.test(
      combinedHaystack,
    )
  ) {
    return "speaker";
  }

  if (
    /camera|c[aá]mara|mirrorless|dslr|gopro|instax|webcam|camcorder/.test(
      combinedHaystack,
    )
  ) {
    return "camera";
  }

  if (
    /playstation|\bps5\b|\bps4\b|xbox|nintendo\s*switch|steam\s*deck|rog\s*ally/.test(
      combinedHaystack,
    )
  ) {
    return "console";
  }

  if (
    /auriculares|headphones|earbuds|airpods|headset|cascos/.test(
      combinedHaystack,
    )
  ) {
    return "headphones";
  }

  if (
    /\bmonitor\b|pantalla\b|\bscreen\b|\bdisplay\b/.test(monitorHaystack) ||
    /(frecuencia de actualizaci[oó]n|freesync|g-sync|adaptive sync|relaci[oó]n de aspecto)/.test(
      combinedHaystack,
    )
  ) {
    return "monitor";
  }

  return null;
}

function enrichProductSpecs(
  title: string,
  description: string | null,
  specs: ProductSpecs,
): ProductSpecs {
  const category = detectProductCategory(title, description, specs);
  const sanitizedSpecs = sanitizeSpecsForCategory(category, specs);

  switch (category) {
    case "monitor":
      return enrichMonitorSpecs(title, description, sanitizedSpecs);
    case "laptop":
      return enrichLaptopSpecs(title, description, sanitizedSpecs);
    case "desktop":
      return enrichDesktopSpecs(title, description, sanitizedSpecs);
    case "phone":
      return enrichPhoneSpecs(title, description, sanitizedSpecs);
    case "tablet":
      return enrichTabletSpecs(title, description, sanitizedSpecs);
    case "smartwatch":
      return enrichSmartwatchSpecs(title, description, sanitizedSpecs);
    case "tv":
      return enrichTvSpecs(title, description, sanitizedSpecs);
    case "speaker":
      return enrichSpeakerSpecs(title, description, sanitizedSpecs);
    case "camera":
      return enrichCameraSpecs(title, description, sanitizedSpecs);
    case "console":
      return enrichConsoleSpecs(title, description, sanitizedSpecs);
    case "headphones":
      return enrichHeadphoneSpecs(title, description, sanitizedSpecs);
    default:
      return sanitizedSpecs;
  }
}

function extractSpecsFromDom(): ProductSpecs {
  const specs: ProductSpecs = {};

  const tableRows = [
    ...document.querySelectorAll<HTMLTableRowElement>("table tr"),
  ].slice(0, 20);

  for (const row of tableRows) {
    const cells = row.querySelectorAll("th, td");
    if (cells.length < 2) {
      continue;
    }

    const key = cleanText(cells[0]?.textContent);
    const value = cleanText(cells[1]?.textContent);
    if (key && value && key.length < 50 && value.length < 120) {
      specs[key] = value;
    }
  }

  const dtElements = [...document.querySelectorAll<HTMLElement>("dl dt")].slice(
    0,
    12,
  );
  for (const dt of dtElements) {
    const dd = dt.nextElementSibling;
    const key = cleanText(dt.textContent);
    const value = cleanText(dd?.textContent);
    if (key && value) {
      specs[key] = value;
    }
  }

  const bulletItems = [...document.querySelectorAll<HTMLElement>("li")].slice(
    0,
    30,
  );
  for (const item of bulletItems) {
    const text = cleanText(item.textContent);
    if (!text || text.length > 120) {
      continue;
    }

    const separator = text.includes(":")
      ? ":"
      : text.includes("-")
        ? "-"
        : null;
    if (!separator) {
      continue;
    }

    const [rawKey, ...rawValue] = text.split(separator);
    const key = cleanText(rawKey);
    const value = cleanText(rawValue.join(separator));
    if (key && value && key.length < 50 && value.length < 100) {
      specs[key] = value;
    }
  }

  return specs;
}

function firstText(selectors: string[]): string | null {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    const value = cleanText(element?.textContent ?? null);
    if (value) {
      return value;
    }
  }

  return null;
}

function getCanonicalUrl(): string | null {
  const canonical = cleanText(
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
  );

  return canonical || null;
}

function normalizeUrl(url: string | null | undefined): string {
  const normalized = cleanText(url);
  if (!normalized) {
    return window.location.href;
  }

  return normalized.replace(/#.*$/, "");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function extractPageMeta(): Record<string, string> {
  const metaEntries: Array<[string, string | null]> = [
    ["description", getMetaContent('meta[name="description"]')],
    ["og:title", getMetaContent('meta[property="og:title"]')],
    ["og:description", getMetaContent('meta[property="og:description"]')],
    ["og:type", getMetaContent('meta[property="og:type"]')],
    ["og:image", getMetaContent('meta[property="og:image"]')],
    ["twitter:title", getMetaContent('meta[name="twitter:title"]')],
    ["twitter:description", getMetaContent('meta[name="twitter:description"]')],
  ];

  return Object.fromEntries(
    metaEntries.filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function extractTextExcerpt(): string {
  const mainRoot =
    document.querySelector<HTMLElement>("main") || document.body || null;
  const text = cleanText(mainRoot?.innerText ?? document.body?.innerText ?? "");
  return truncateText(text, 8000);
}

function sanitizeHtmlSnapshot(): string {
  const root = document.documentElement.cloneNode(true);
  if (!(root instanceof HTMLElement)) {
    return "";
  }

  for (const element of root.querySelectorAll(
    "script, style, noscript, iframe, svg, canvas, video, audio, source",
  )) {
    element.remove();
  }

  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcset" ||
        name === "ping"
      ) {
        element.removeAttribute(attribute.name);
      }

      if (
        ["input", "textarea", "select", "option"].includes(
          element.tagName.toLowerCase(),
        ) &&
        ["value", "checked", "selected"].includes(name)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const html = root.outerHTML
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();

  return truncateText(html, 50000);
}

function summarizeDetectedPage(product: DetectedProduct | null): string {
  if (!product) {
    return `Página capturada en ${domainToStoreName(window.location.href)}: ${cleanText(document.title) || normalizeUrl(window.location.href)}.`;
  }

  const parts = [
    `Producto detectado en ${product.store}`,
    product.title,
    product.price == null
      ? null
      : `precio ${product.price} ${product.currency ?? ""}`.trim(),
    product.rating == null ? null : `rating ${product.rating.toFixed(1)}★`,
  ].filter(Boolean);

  return `${parts.join(" · ")}.`;
}

function extractAmazonAsin(): string | null {
  const directValue = cleanText(
    document.querySelector<HTMLInputElement>("#ASIN, input[name='ASIN']")
      ?.value,
  );
  if (/^[A-Z0-9]{10}$/i.test(directValue)) {
    return directValue.toUpperCase();
  }

  const itemAsin = cleanText(
    document.querySelector<HTMLInputElement>(
      "input[name='items[0.base][asin]']",
    )?.value,
  );
  if (/^[A-Z0-9]{10}$/i.test(itemAsin)) {
    return itemAsin.toUpperCase();
  }

  const canonicalMatch = getCanonicalUrl()?.match(
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
  );
  if (canonicalMatch?.[1]) {
    return canonicalMatch[1].toUpperCase();
  }

  const pathMatch = window.location.pathname.match(
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
  );
  if (pathMatch?.[1]) {
    return pathMatch[1].toUpperCase();
  }

  const dataAsin = cleanText(
    document
      .querySelector<HTMLElement>("[data-csa-c-asin]")
      ?.getAttribute("data-csa-c-asin"),
  );

  return /^[A-Z0-9]{10}$/i.test(dataAsin) ? dataAsin.toUpperCase() : null;
}

function normalizeAmazonBrand(text: string | null | undefined): string | null {
  const value = cleanText(text);
  if (!value) {
    return null;
  }

  return (
    cleanText(
      value
        .replace(/^Visita la tienda de\s+/i, "")
        .replace(/^Visit the\s+/i, "")
        .replace(/\s+Store$/i, "")
        .replace(/^Marca:\s*/i, "")
        .replace(/^Brand:\s*/i, ""),
    ) || null
  );
}

function extractAmazonBrand(
  structuredProduct: Record<string, any> | null,
): string | null {
  const structuredBrand = normalizeAmazonBrand(
    structuredProduct?.brand?.name ?? structuredProduct?.brand,
  );
  if (structuredBrand) {
    return structuredBrand;
  }

  return normalizeAmazonBrand(
    firstText([
      "#bylineInfo",
      "#bylineInfo_feature_div a",
      "#brand",
      "#brandByline_feature_div a",
      "#premiumBylineInfo_feature_div a",
    ]),
  );
}

function extractAmazonSelectedVariationSpecs(): ProductSpecs {
  const specs: ProductSpecs = {};

  for (const valueElement of document.querySelectorAll<HTMLElement>(
    "[id^='inline-twister-expanded-dimension-text-']",
  )) {
    const value = cleanText(valueElement.textContent);
    const container = valueElement.closest<HTMLElement>(
      ".inline-twister-row, .dimension-heading",
    );
    const label = cleanText(
      container?.querySelector<HTMLElement>(".a-color-secondary")?.textContent,
    ).replace(/[:：]\s*$/, "");
    const fallbackLabel = valueElement.id
      .replace("inline-twister-expanded-dimension-text-", "")
      .replace(/_/g, " ");

    addSpec(specs, label || fallbackLabel, value);
  }

  return specs;
}

function extractAmazonPriceData(): {
  price: number | null;
  currency: string | null;
  priceText: string | null;
} {
  const amountValue =
    cleanText(
      document.querySelector<HTMLInputElement>("#twister-plus-price-data-price")
        ?.value,
    ) ||
    cleanText(
      document.querySelector<HTMLInputElement>(
        "input[name='items[0.base][customerVisiblePrice][amount]']",
      )?.value,
    ) ||
    null;

  const currencyValue =
    cleanText(
      document.querySelector<HTMLInputElement>(
        "#twister-plus-price-data-price-unit",
      )?.value,
    ) ||
    cleanText(
      document.querySelector<HTMLInputElement>(
        "input[name='items[0.base][customerVisiblePrice][currencyCode]']",
      )?.value,
    ) ||
    null;

  const displayValue =
    cleanText(
      document.querySelector<HTMLInputElement>(
        "input[name='items[0.base][customerVisiblePrice][displayString]']",
      )?.value,
    ) ||
    firstText([
      "#apex-pricetopay-accessibility-label",
      "#corePrice_feature_div .a-price .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .priceToPay",
      "#apex_desktop .priceToPay",
      "#tp_price_block_total_price_ww .a-offscreen",
    ]);

  return {
    price: parseDecimal(amountValue ?? displayValue),
    currency: detectCurrency(displayValue, currencyValue),
    priceText: displayValue,
  };
}

function detectCurrency(
  priceText: string | null,
  structuredCurrency: string | null,
): string | null {
  if (structuredCurrency) {
    return structuredCurrency.toUpperCase();
  }

  const text = priceText ?? "";
  if (/€|EUR/i.test(text)) return "EUR";
  if (/USD|US\$|\$/i.test(text)) return "USD";
  if (/GBP|£/i.test(text)) return "GBP";
  if (/MXN/i.test(text)) return "MXN";
  return null;
}

export function extractProductFromPage(): DetectedProduct | null {
  const structuredProduct = readStructuredProduct();
  const amazonAsin = extractAmazonAsin();
  const amazonBrand = extractAmazonBrand(structuredProduct);
  const amazonPriceData = extractAmazonPriceData();
  const productUrl = normalizeUrl(getCanonicalUrl() || window.location.href);
  const source: ProductSource = structuredProduct
    ? "schema"
    : getMetaContent('meta[property="og:title"]')
      ? "meta"
      : "dom";

  const title =
    cleanText(structuredProduct?.name) ||
    getMetaContent('meta[property="og:title"]') ||
    getMetaContent('meta[name="twitter:title"]') ||
    firstText([
      "#productTitle",
      "h1",
      '[itemprop="name"]',
      '[data-testid*="title"]',
    ]) ||
    cleanText(document.title);

  if (!title) {
    return null;
  }

  const structuredOffer = Array.isArray(structuredProduct?.offers)
    ? structuredProduct?.offers[0]
    : structuredProduct?.offers;

  const domPriceText =
    amazonPriceData.priceText ||
    getMetaContent('meta[property="product:price:amount"]') ||
    getMetaContent('meta[itemprop="price"]') ||
    firstText([
      "#apex-pricetopay-accessibility-label",
      ".priceToPay .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-offscreen",
      "#corePrice_feature_div .a-offscreen",
      "#tp_price_block_total_price_ww .a-offscreen",
      "#price_inside_buybox",
      '[itemprop="price"]',
      '[data-testid*="price"]',
      '[class*="price"]',
      '[id*="price"]',
    ]);

  const price = parseDecimal(
    structuredOffer?.price ??
      structuredProduct?.price ??
      amazonPriceData.price ??
      domPriceText,
  );
  const currency = detectCurrency(
    domPriceText,
    cleanText(structuredOffer?.priceCurrency) || amazonPriceData.currency,
  );

  const ratingText =
    cleanText(structuredProduct?.aggregateRating?.ratingValue) ||
    getMetaContent('meta[itemprop="ratingValue"]') ||
    firstText([
      "#acrPopover",
      "[data-hook='rating-out-of-text']",
      "i[data-hook='average-star-rating'] span",
      "i[data-hook='cmps-review-star-rating'] span",
      '[itemprop="ratingValue"]',
      '[data-testid*="rating"]',
      '[class*="rating"]',
      '[aria-label*="de 5"]',
    ]);

  const reviewsText =
    cleanText(structuredProduct?.aggregateRating?.reviewCount) ||
    getMetaContent('meta[itemprop="reviewCount"]') ||
    firstText([
      "#acrCustomerReviewText",
      "[data-hook='total-review-count']",
      "#reviews-medley-footer .a-link-normal",
      '[itemprop="reviewCount"]',
      '[data-testid*="reviews"]',
      '[class*="reviews"]',
      '[class*="reviewCount"]',
    ]);

  const image =
    cleanText(
      Array.isArray(structuredProduct?.image)
        ? structuredProduct.image[0]
        : structuredProduct?.image,
    ) ||
    getMetaContent('meta[property="og:image"]') ||
    getMetaContent('meta[name="twitter:image"]') ||
    document.querySelector<HTMLImageElement>("#landingImage")?.src ||
    document.querySelector<HTMLImageElement>("#imgTagWrapperId img")?.src ||
    document.querySelector<HTMLImageElement>("img")?.src ||
    null;

  const description =
    extractDescriptionFromStructuredData(structuredProduct) ||
    extractDescriptionFromDom(title);

  const specs = {
    ...extractSpecsFromStructuredData(structuredProduct),
    ...extractAmazonSpecs(),
    ...extractAmazonSelectedVariationSpecs(),
    ...extractSpecsFromDom(),
  };

  if (amazonBrand && !specs["Marca"]) {
    addSpec(specs, "Marca", amazonBrand);
  }

  if (amazonAsin && !specs.ASIN) {
    addSpec(specs, "ASIN", amazonAsin);
  }

  const enrichedSpecs = enrichProductSpecs(title, description, specs);

  return {
    title,
    description,
    price,
    currency,
    store: domainToStoreName(window.location.href),
    image,
    url: productUrl,
    rating: parseRating(ratingText),
    reviewsCount: parseInteger(reviewsText),
    specs: enrichedSpecs,
    source,
  };
}

export function extractPageCacheFromPage(
  product: DetectedProduct | null = extractProductFromPage(),
): PageCacheEntry {
  const canonicalUrl = getCanonicalUrl();

  return {
    id: crypto.randomUUID(),
    url: normalizeUrl(window.location.href),
    canonicalUrl: canonicalUrl ? normalizeUrl(canonicalUrl) : null,
    title:
      cleanText(document.title) ||
      product?.title ||
      normalizeUrl(window.location.href),
    store: product?.store ?? domainToStoreName(window.location.href),
    capturedAt: new Date().toISOString(),
    html: sanitizeHtmlSnapshot(),
    textExcerpt: extractTextExcerpt(),
    summary: summarizeDetectedPage(product),
    meta: extractPageMeta(),
    product,
  };
}

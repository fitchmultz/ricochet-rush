import { Cursor, type ModelListItem, type ModelParameterValue, type ModelSelection } from "@cursor/sdk";
import { CURSOR_MODEL, type CursorModelSelection } from "../shared/evolution.js";

const COMPOSER_MODEL_ID = CURSOR_MODEL.id;
const COMPOSER_MODEL_ALIASES = ["composer-2-5", "composer-latest", "composer"];
const AUTO_MODEL_SELECTION: ModelSelection = { id: "auto" };
const MODEL_CATALOG_TIMEOUT_MS = 3_000;

let catalogPromise: Promise<ModelListItem[]> | undefined;

interface ResolveCursorModelSelectionOptions {
  timeoutMs?: number;
  loadCatalog?: (apiKey: string) => Promise<ModelListItem[]>;
}

class CursorModelCatalogTimeoutError extends Error {
  constructor() {
    super("Cursor model catalog lookup timed out.");
    this.name = "CursorModelCatalogTimeoutError";
  }
}

export async function resolveCursorModelSelection(apiKey: string, options: ResolveCursorModelSelectionOptions = {}): Promise<ModelSelection> {
  try {
    const catalog = await withTimeout((options.loadCatalog ?? loadModelCatalog)(apiKey), options.timeoutMs ?? MODEL_CATALOG_TIMEOUT_MS);
    return selectCursorModelFromCatalog(catalog);
  } catch (error) {
    if (error instanceof CursorModelCatalogTimeoutError) catalogPromise = undefined;
    return cloneModelSelection(CURSOR_MODEL);
  }
}

export function selectCursorModelFromCatalog(catalog: ModelListItem[]): ModelSelection {
  const composer =
    catalog.find((model) => model.id === COMPOSER_MODEL_ID) ??
    catalog.find((model) => model.aliases?.some((alias) => alias === COMPOSER_MODEL_ID || COMPOSER_MODEL_ALIASES.includes(alias)));

  if (!composer) return AUTO_MODEL_SELECTION;

  const explicitParams = supportedParams(composer, CURSOR_MODEL.params ?? []);
  if (explicitParams.length > 0) {
    return { id: composer.id, params: explicitParams };
  }

  const defaultVariant = composer.variants?.find((variant) => variant.isDefault);
  if (defaultVariant?.params.length) {
    return { id: composer.id, params: defaultVariant.params.map(cloneParam) };
  }

  return { id: composer.id };
}

export function readCursorModelSelectionFromEnv(): ModelSelection {
  return normalizeModelSelection(process.env.CURSOR_MODEL_SELECTION_JSON) ?? cloneModelSelection(CURSOR_MODEL);
}

export function resetCursorModelCatalogCacheForTests(): void {
  catalogPromise = undefined;
}

function loadModelCatalog(apiKey: string): Promise<ModelListItem[]> {
  catalogPromise ??= Cursor.models.list({ apiKey }).catch((error: unknown) => {
    catalogPromise = undefined;
    throw error;
  });
  return catalogPromise;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new CursorModelCatalogTimeoutError()), timeoutMs);
    timeout.unref?.();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function supportedParams(model: ModelListItem, params: readonly ModelParameterValue[]): ModelParameterValue[] {
  return params.filter((param) => model.parameters?.some((definition) => definition.id === param.id && definition.values.some((value) => value.value === param.value))).map(cloneParam);
}

function normalizeModelSelection(value: string | undefined): ModelSelection | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isModelSelection(parsed)) return undefined;
    return cloneModelSelection(parsed);
  } catch {
    return undefined;
  }
}

function isModelSelection(value: unknown): value is CursorModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { id?: unknown; params?: unknown };
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return false;
  if (candidate.params === undefined) return true;
  return Array.isArray(candidate.params) && candidate.params.every(isModelParameter);
}

function isModelParameter(value: unknown): value is ModelParameterValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { id?: unknown; value?: unknown };
  return typeof candidate.id === "string" && candidate.id.trim().length > 0 && typeof candidate.value === "string" && candidate.value.trim().length > 0;
}

function cloneModelSelection(selection: CursorModelSelection): ModelSelection {
  return {
    id: selection.id,
    params: selection.params?.map(cloneParam)
  };
}

function cloneParam(param: ModelParameterValue): ModelParameterValue {
  return { id: param.id, value: param.value };
}

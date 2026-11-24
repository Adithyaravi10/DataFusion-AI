import type {
  AIInsightsResult,
  AIProviderStatus,
  AIUsageRecord,
  AIUsageSummary,
  AnalyseResponse,
  BatchResponse,
  ChartsResponse,
  CleanResponse,
  CombineResponse,
  HistoryItem,
  JobStatus,
  ModelSummary,
  PredictResponse,
  Report,
  Session,
  UploadResponse,
} from "./types";

// Empty by default: requests stay same-origin and use the Vite proxy in dev or
// the FastAPI static build in production. Set VITE_API_URL when the API lives
// on another origin, e.g. https://api.example.com.
const configuredBase = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").trim();
export const API_BASE: string = configuredBase.replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
}

// --------------------------------------------------------------- ownership
// Each browser keeps one unpredictable token and sends it with every request;
// the API stores only its hash, so sessions and datasets stay private to the
// browser that created them. The server mirrors it into an HttpOnly cookie.
const OWNER_STORAGE_KEY = "df-owner";
const OWNER_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
let cachedOwner: string | null = null;

function randomOwnerToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ownerToken(): string {
  if (cachedOwner) return cachedOwner;
  try {
    const stored = window.localStorage.getItem(OWNER_STORAGE_KEY);
    if (stored && OWNER_PATTERN.test(stored)) {
      cachedOwner = stored;
      return stored;
    }
  } catch {
    /* storage unavailable */
  }
  const created = randomOwnerToken();
  cachedOwner = created;
  try {
    window.localStorage.setItem(OWNER_STORAGE_KEY, created);
  } catch {
    /* storage unavailable */
  }
  return created;
}

function ownerHeaders(extra?: HeadersInit): Record<string, string> {
  return { ...(extra as Record<string, string> | undefined), "X-DF-Owner": ownerToken() };
}

export interface FieldError {
  file: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  errors?: FieldError[];

  constructor(message: string, status: number, errors?: FieldError[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

function payloadError(status: number, payload: unknown): ApiError {
  const detail = (payload as { detail?: unknown })?.detail;
  if (typeof detail === "string") return new ApiError(detail, status);
  if (detail && typeof detail === "object") {
    const record = detail as { message?: string; errors?: FieldError[] };
    return new ApiError(record.message ?? "The request was rejected.", status, record.errors);
  }
  return new ApiError(
    typeof payload === "string" && payload ? payload : `Request failed (${status}).`,
    status,
  );
}

/** multipart upload over XHR so the browser can report real progress. */
function xhrUpload<T>(
  path: string,
  files: File[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file, file.name));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(path));
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-DF-Owner", ownerToken());
    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / Math.max(1, event.total)) * 100),
      });
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          "Cannot reach the DataFusion API. Make sure the FastAPI server is running on port 8000.",
          0,
        ),
      );
    xhr.onload = () => {
      let payload: unknown = xhr.responseText;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* plain text response */
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(payloadError(xhr.status, payload));
        return;
      }
      resolve(payload as T);
    };
    xhr.send(form);
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      headers: ownerHeaders(init?.headers),
    });
  } catch {
    throw new ApiError(
      "Cannot reach the DataFusion API. Make sure the FastAPI server is running on port 8000.",
      0,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw payloadError(response.status, payload);
  }
  return payload as T;
}

/** The names the backend serves each report artefact with. */
export const REPORT_FILENAMES: Record<string, string> = {
  pdf: "DataFusion_Report.pdf",
  csv: "fused_dataset.csv",
  xlsx: "fusion_summary.xlsx",
};

function sanitiseFilename(raw: string): string | null {
  const cleaned = raw.replace(/[\r\n\t]/g, "").replace(/[\\/]/g, "_").trim();
  return cleaned || null;
}

/**
 * Read the filename a download was served with. Handles the RFC 5987
 * `filename*=UTF-8''…` form, a quoted `filename="…"`, and a bare value.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header);
  const extendedValue = extended?.[1]?.trim().replace(/^UTF-8''/i, "").replace(/^"|"$/g, "");
  if (extendedValue) {
    try {
      const decoded = sanitiseFilename(decodeURIComponent(extendedValue));
      if (decoded) return decoded;
    } catch {
      /* malformed percent-encoding: fall through to the plain forms */
    }
  }
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted?.[1]) {
    const value = sanitiseFilename(quoted[1]);
    if (value) return value;
  }
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  if (bare?.[1]) {
    const value = sanitiseFilename(bare[1].replace(/^"|"$/g, ""));
    if (value) return value;
  }
  return null;
}

/** Last-resort name when no Content-Disposition header reaches the browser. */
function filenameFromPath(path: string): string {
  const [bare = "", query = ""] = path.split("?");
  const segments = bare.split("/").filter(Boolean);
  const kind = new URLSearchParams(query).get("kind");
  if (kind) return `fusion_report.${kind}`;
  const last = segments[segments.length - 1] ?? "";
  if (/\.[A-Za-z0-9]{2,5}$/.test(last)) return last;
  const previous = segments[segments.length - 2] ?? "";
  if (/\.[A-Za-z0-9]{2,5}$/.test(previous)) return previous;
  return last || "download";
}

/**
 * Fetch a generated artefact with the ownership token and save it via a blob
 * link. Plain anchors cannot carry the header, so downloads use this helper.
 * The server's Content-Disposition filename wins; `fallbackName` is used only
 * when that header is unavailable.
 */
export async function downloadFile(path: string, fallbackName?: string): Promise<void> {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    headers: { "X-DF-Owner": ownerToken() },
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    throw payloadError(response.status, payload);
  }
  const resolved =
    filenameFromContentDisposition(response.headers.get("content-disposition")) ??
    (fallbackName ? sanitiseFilename(fallbackName) : null) ??
    filenameFromPath(path);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = resolved;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the transfer in some browsers, so hold the
  // blob URL briefly before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export const api = {
  health: () => request<{ status: string }>("/api/health"),

  upload: (files: File[], onProgress?: (progress: UploadProgress) => void) =>
    xhrUpload<UploadResponse>("/api/upload", files, onProgress),

  /** Append sources to an existing session; earlier files are kept. */
  addFiles: (sessionId: string, files: File[], onProgress?: (progress: UploadProgress) => void) =>
    xhrUpload<UploadResponse>(`/api/session/${sessionId}/files`, files, onProgress),

  removeFile: (sessionId: string, fileId: string) =>
    request<{ session: Session; files: Session["files"] }>(
      `/api/session/${sessionId}/files/${fileId}`,
      { method: "DELETE" },
    ),

  startFusion: (sessionId: string) =>
    request<{ job_id: string; state: string }>("/api/fuse", jsonBody({ session_id: sessionId })),

  jobStatus: (jobId: string) => request<JobStatus>(`/api/fuse/${jobId}/status`),

  confirmJob: (
    jobId: string,
    payload: { join_keys?: Record<string, { left: string; right: string }>; target?: string },
  ) => request<{ ok: boolean }>(`/api/fuse/${jobId}/confirm`, jsonBody(payload)),

  session: (sessionId: string) => request<Session>(`/api/session/${sessionId}`),

  history: () => request<HistoryItem[]>("/api/history"),

  deleteSession: (sessionId: string) =>
    request<{ deleted: boolean }>(`/api/history/${sessionId}`, { method: "DELETE" }),

  clean: (sessionId: string) => request<CleanResponse>(`/api/session/${sessionId}/clean`),

  combine: (
    sessionId: string,
    params: { page?: number; pageSize?: number; search?: string; sort?: string; direction?: string },
  ) => {
    const query = new URLSearchParams();
    query.set("page", String(params.page ?? 1));
    query.set("page_size", String(params.pageSize ?? 20));
    if (params.search) query.set("search", params.search);
    if (params.sort) query.set("sort", params.sort);
    if (params.direction) query.set("direction", params.direction);
    return request<CombineResponse>(`/api/session/${sessionId}/combine?${query.toString()}`);
  },

  analyse: (sessionId: string) => request<AnalyseResponse>(`/api/session/${sessionId}/analyse`),

  charts: (sessionId: string) => request<ChartsResponse>(`/api/session/${sessionId}/charts`),

  train: (
    sessionId: string,
    payload: { target: string; test_size: number; cv_folds: number; task?: string | null },
  ) =>
    request<{ model: ModelSummary }>("/api/train", jsonBody({ session_id: sessionId, ...payload })),

  model: (sessionId: string) =>
    request<{ model: ModelSummary }>(`/api/session/${sessionId}/model`),

  predict: (sessionId: string, values: Record<string, unknown>) =>
    request<PredictResponse>("/api/predict", jsonBody({ session_id: sessionId, values })),

  predictBatch: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return request<BatchResponse>(`/api/predict/batch?session_id=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: form,
    });
  },

  createReport: (sessionId: string) =>
    request<Report>("/api/report", jsonBody({ session_id: sessionId })),

  reports: () => request<Report[]>("/api/reports"),

  aiInsights: (sessionId: string, question?: string) =>
    request<AIInsightsResult>(
      `/api/session/${sessionId}/ai-insights`,
      jsonBody({ question: question?.trim() ? question.trim() : null }),
    ),

  cachedAiInsights: (sessionId: string) =>
    request<{ insights: AIInsightsResult | null }>(`/api/session/${sessionId}/ai-insights`),

  aiProviders: () => request<AIProviderStatus>("/api/ai/providers"),

  aiUsage: () => request<AIUsageSummary>("/api/ai/usage"),

  aiHistory: (limit = 25) =>
    request<{ records: AIUsageRecord[] }>(`/api/ai/history?limit=${limit}`),

  download: (path: string, filename?: string) => downloadFile(path, filename),
};

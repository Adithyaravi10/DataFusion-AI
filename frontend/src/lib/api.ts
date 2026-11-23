import type {
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

export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
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
    response = await fetch(apiUrl(path), init);
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
};

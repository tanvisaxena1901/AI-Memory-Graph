function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? "").replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const telemetryApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_TELEMETRY_API_BASE_URL);

export function apiUrl(path: string): string {
  return joinUrl(apiBaseUrl, path);
}

export function telemetryApiUrl(path: string): string {
  if (telemetryApiBaseUrl) {
    return joinUrl(telemetryApiBaseUrl, path);
  }
  if (apiBaseUrl) {
    return joinUrl(apiBaseUrl, path);
  }
  return joinUrl("/telemetry-api", path.replace(/^\/api/, ""));
}

const SERVER_URL_STORAGE_KEY = "poker:server-url";

function currentOrigin() {
  return typeof window === "undefined"
    ? "http://localhost:3000"
    : window.location.origin;
}

export function normalizeServerUrl(value: string): string {
  let input = value.trim();
  if (!input) return "";

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
    input = `http://${input}`;
  }

  const url = new URL(input);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("服务地址只支持 http、https、ws 或 wss 协议");
  }
  if (url.username || url.password) {
    throw new Error("服务地址不能包含用户名或密码");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname === "/" ? "" : pathname}`;
}

export function getServerUrl(): string {
  if (typeof window === "undefined") return currentOrigin();

  const stored = window.localStorage.getItem(SERVER_URL_STORAGE_KEY);
  if (!stored) return currentOrigin();

  try {
    return normalizeServerUrl(stored) || currentOrigin();
  } catch {
    return currentOrigin();
  }
}

export function saveServerUrl(value: string): string {
  const normalized = normalizeServerUrl(value);
  const fallback = currentOrigin();

  if (typeof window !== "undefined") {
    if (!normalized || normalized === fallback) {
      window.localStorage.removeItem(SERVER_URL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SERVER_URL_STORAGE_KEY, normalized);
    }
  }

  return normalized || fallback;
}

export function resetServerUrl() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SERVER_URL_STORAGE_KEY);
  }
}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function buildApiUrl(baseUrl = getServerUrl()) {
  return appendPath(baseUrl, "/api/trpc");
}

export function buildWebSocketUrl(baseUrl = getServerUrl()) {
  const url = new URL(appendPath(baseUrl, "/ws"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

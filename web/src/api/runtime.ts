interface WmuxRuntime {
  baseUrl: string
  token: string
}

interface RuntimeFlags {
  isTauri: boolean
  isElectron: boolean
  omniAvailable: boolean
}

declare global {
  interface Window {
    __WMUX_RUNTIME__?: WmuxRuntime
  }
}

const AUTH_TOKEN_KEY = "wmux-auth-token"

export function getBaseUrl(): string {
  return window.__WMUX_RUNTIME__?.baseUrl ?? ""
}

export function getAuthToken(): string | null {
  return window.__WMUX_RUNTIME__?.token || sessionStorage.getItem(AUTH_TOKEN_KEY)
}

export function getRuntimeFlags(): RuntimeFlags {
  const mediaDevices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices

  return {
    isTauri: Boolean(window.__WMUX_RUNTIME__?.baseUrl),
    isElectron: false,
    omniAvailable: typeof mediaDevices?.getUserMedia === "function",
  }
}

export function getWebSocketUrl(path: string, query: URLSearchParams): string {
  const runtimeBaseUrl = window.__WMUX_RUNTIME__?.baseUrl
  const baseUrl = runtimeBaseUrl ? new URL(runtimeBaseUrl) : window.location
  const protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:"

  return `${protocol}//${baseUrl.host}${path}?${query.toString()}`
}

export {}

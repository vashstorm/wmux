import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { getAuthToken, getBaseUrl, getRuntimeFlags, getWebSocketUrl } from "./runtime.js"

const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices")

function restoreMediaDevices(): void {
  if (originalMediaDevicesDescriptor) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor)
    return
  }

  Reflect.deleteProperty(navigator, "mediaDevices")
}

describe("runtime", () => {
  beforeEach(() => {
    delete window.__WMUX_RUNTIME__
    sessionStorage.clear()
    restoreMediaDevices()
  })

  afterEach(() => {
    delete window.__WMUX_RUNTIME__
    sessionStorage.clear()
    restoreMediaDevices()
  })

  test("uses same-origin defaults in web mode", () => {
    sessionStorage.setItem("wmux-auth-token", "web-token")
    const query = new URLSearchParams({ token: "web-token" })

    expect(getBaseUrl()).toBe("")
    expect(getAuthToken()).toBe("web-token")
    expect(getWebSocketUrl("/api/terminal", query)).toBe(
      `ws://${window.location.host}/api/terminal?token=web-token`,
    )
  })

  test("uses injected Tauri runtime for API, auth, and WebSocket URL", () => {
    window.__WMUX_RUNTIME__ = {
      baseUrl: "http://127.0.0.1:7331",
      token: "runtime-token",
    }
    const query = new URLSearchParams({ token: "runtime-token" })

    expect(getBaseUrl()).toBe("http://127.0.0.1:7331")
    expect(getAuthToken()).toBe("runtime-token")
    expect(getWebSocketUrl("/api/terminal", query)).toBe(
      "ws://127.0.0.1:7331/api/terminal?token=runtime-token",
    )
  })

  test("keeps Tauri runtime injection scoped to base URL and token", () => {
    window.__WMUX_RUNTIME__ = {
      baseUrl: "http://127.0.0.1:7331",
      token: "runtime-token",
    }
    const runtimeRecord = window.__WMUX_RUNTIME__ as unknown as Record<string, unknown>
    const serializedRuntime = JSON.stringify(runtimeRecord).toLowerCase()

    expect(Object.keys(runtimeRecord).sort()).toEqual(["baseUrl", "token"])
    expect(serializedRuntime).not.toContain("dashscope")
    expect(serializedRuntime).not.toContain("api_key")
    expect(serializedRuntime).not.toContain("apikey")
  })

  test("reports runtime and voice availability flags", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    })

    expect(getRuntimeFlags()).toEqual({ isTauri: false, omniAvailable: false })

    window.__WMUX_RUNTIME__ = {
      baseUrl: "http://127.0.0.1:7331",
      token: "runtime-token",
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() } as unknown as MediaDevices,
    })

    expect(getRuntimeFlags()).toEqual({ isTauri: true, omniAvailable: true })
  })

  test("derives secure WebSocket protocol from HTTPS base URL", () => {
    window.__WMUX_RUNTIME__ = {
      baseUrl: "https://wmux.local:7443",
      token: "runtime-token",
    }

    expect(getWebSocketUrl("/api/terminal", new URLSearchParams())).toBe(
      "wss://wmux.local:7443/api/terminal?",
    )
  })

  test("falls back to session storage when runtime token is empty", () => {
    window.__WMUX_RUNTIME__ = {
      baseUrl: "http://127.0.0.1:7331",
      token: "",
    }
    sessionStorage.setItem("wmux-auth-token", "fallback-token")

    expect(getAuthToken()).toBe("fallback-token")
  })
})

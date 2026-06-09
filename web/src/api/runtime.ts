interface RuntimeFlags {
  isTauri: boolean
  isElectron: boolean
  omniAvailable: boolean
}

export function getRuntimeFlags(): RuntimeFlags {
  const mediaDevices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices

  return {
    isTauri: typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== "undefined",
    isElectron: false,
    omniAvailable: typeof mediaDevices?.getUserMedia === "function",
  }
}

export function getAuthToken(): string | null {
  return null
}

export {}
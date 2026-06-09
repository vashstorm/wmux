import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { getRuntimeFlags } from "./runtime.js"

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
    restoreMediaDevices()
  })

  afterEach(() => {
    restoreMediaDevices()
  })

  test("reports runtime and voice availability flags when mediaDevices unavailable", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    })

    expect(getRuntimeFlags()).toEqual({ isElectron: false, isTauri: false, omniAvailable: false })
  })

  test("reports runtime and voice availability flags when mediaDevices available", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() } as unknown as MediaDevices,
    })

    expect(getRuntimeFlags()).toEqual({ isElectron: false, isTauri: false, omniAvailable: true })
  })
})
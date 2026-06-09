import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

vi.mock("@mui/material", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mui/material")>()
  return {
    ...original,
    Tooltip: ({ children }: any) => children,
  }
})

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (!window.ResizeObserver) {
  class ResizeObserverMock implements ResizeObserver {
    observe(): void {}

    unobserve(): void {}

    disconnect(): void {}
  }

  window.ResizeObserver = ResizeObserverMock
}

vi.mock("@mui/material", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mui/material")>()
  return {
    ...original,
    Tooltip: ({ children }: any) => children,
  }
})

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (!window.ResizeObserver) {
  class ResizeObserverMock implements ResizeObserver {
    observe(): void {}

    unobserve(): void {}

    disconnect(): void {}
  }

  window.ResizeObserver = ResizeObserverMock
}

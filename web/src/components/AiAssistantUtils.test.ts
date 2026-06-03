import { describe, test, expect } from "vitest"
import { scalePosOnResize } from "./AiAssistantUtils.js"

describe("AiAssistantUtils - scalePosOnResize", () => {
  test("scales position proportionally when window sizes change", () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight

    try {
      // Set the window size to the new size so that clampAssistantPos doesn't clamp to jsdom default
      window.innerWidth = 1920
      window.innerHeight = 1080

      // If the launcher is at the bottom-right corner:
      // Window: 1000 x 800, element size: 42 x 42, margin: 16
      // maxX = 1000 - 42 - 16 = 942
      // maxY = 800 - 42 - 16 = 742
      const elementSize = { width: 42, height: 42 }
      const pos = { x: 942, y: 742 }

      const newPos = scalePosOnResize(
        pos,
        elementSize,
        1000,
        800,
        1920,
        1080
      )

      // Expected position on 1920 x 1080 should also be bottom-right:
      // 1920 - 42 - 16 = 1862
      // 1080 - 42 - 16 = 1022
      expect(newPos).toEqual({ x: 1862, y: 1022 })
    } finally {
      window.innerWidth = originalInnerWidth
      window.innerHeight = originalInnerHeight
    }
  })

  test("scales position to center when it is originally in the center", () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight

    try {
      window.innerWidth = 2000
      window.innerHeight = 1600

      const elementSize = { width: 40, height: 40 }
      // Window 1000 x 800
      // RangeX = 1000 - 40 - 32 = 928. Center = 16 + 0.5 * 928 = 480
      // RangeY = 800 - 40 - 32 = 728. Center = 16 + 0.5 * 728 = 380
      const pos = { x: 480, y: 380 }

      const newPos = scalePosOnResize(
        pos,
        elementSize,
        1000,
        800,
        2000,
        1600
      )

      // New Window 2000 x 1600
      // RangeX = 2000 - 40 - 32 = 1928. Expected = 16 + 0.5 * 1928 = 980
      // RangeY = 1600 - 40 - 32 = 1528. Expected = 16 + 0.5 * 1528 = 780
      expect(newPos).toEqual({ x: 980, y: 780 })
    } finally {
      window.innerWidth = originalInnerWidth
      window.innerHeight = originalInnerHeight
    }
  })
})

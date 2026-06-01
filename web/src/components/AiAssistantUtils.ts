export const LAUNCHER_POS_STORAGE_KEY = "wmux-launcher-pos"

const LAUNCHER_ELEM_SIZE = { width: 42, height: 42 }
const VIEWPORT_MARGIN_PX = 16

export type AssistantPos = { x: number; y: number }

function defaultLauncherPos(): AssistantPos {
  if (typeof window === "undefined") return { x: VIEWPORT_MARGIN_PX, y: VIEWPORT_MARGIN_PX }
  return {
    x: window.innerWidth - LAUNCHER_ELEM_SIZE.width - VIEWPORT_MARGIN_PX,
    y: window.innerHeight - LAUNCHER_ELEM_SIZE.height - VIEWPORT_MARGIN_PX,
  }
}

export function clampAssistantPos(
  pos: AssistantPos,
  size: { width: number; height: number },
): AssistantPos {
  if (typeof window === "undefined") return pos
  const maxX = window.innerWidth - size.width - VIEWPORT_MARGIN_PX
  const maxY = window.innerHeight - size.height - VIEWPORT_MARGIN_PX
  return {
    x: Math.round(Math.max(VIEWPORT_MARGIN_PX, Math.min(maxX, pos.x))),
    y: Math.round(Math.max(VIEWPORT_MARGIN_PX, Math.min(maxY, pos.y))),
  }
}

export function loadLauncherPos(): AssistantPos {
  try {
    const raw = localStorage.getItem(LAUNCHER_POS_STORAGE_KEY)
    if (!raw) return defaultLauncherPos()
    const parsed = JSON.parse(raw) as Partial<AssistantPos>
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return defaultLauncherPos()
    }
    return clampAssistantPos({ x: parsed.x, y: parsed.y }, LAUNCHER_ELEM_SIZE)
  } catch {
    return defaultLauncherPos()
  }
}

export function saveLauncherPos(pos: AssistantPos): void {
  try {
    localStorage.setItem(LAUNCHER_POS_STORAGE_KEY, JSON.stringify(pos))
  } catch {}
}

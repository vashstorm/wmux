export function formatRelativeTime(isoString: string | undefined): string | null {
  if (!isoString) return null

  const then = Date.parse(isoString)
  if (isNaN(then)) return null

  const diffMs = Date.now() - then
  if (diffMs < 0) return null

  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return "<1m"

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h`

  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay}d`
}

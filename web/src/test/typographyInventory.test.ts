import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "vitest"

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(__dirname, "../..")

function resolveWeb(relative: string): string {
  return join(WEB_ROOT, relative)
}

/**
 * Decorative / icon sizes that are EXCLUDED from the typography scale.
 * These are intentionally fixed and should NOT migrate to CSS variables.
 */
const DECORATIVE_ALLOWLIST_PX = new Set([16, 48])

/**
 * Inventory of targets: each entry records the file, a label, and whether
 * it should be migrated (true = prohibited, must use token).
 *
 * After migration, every target with migrate=true must pass its check.
 */
interface TypographyTarget {
  file: string
  label: string
  migrate: boolean
  /** Regex patterns that indicate prohibited hardcodes in this file. */
  patterns: RegExp[]
}

const TSX_TARGETS: TypographyTarget[] = [
  {
    file: "src/ui/muiTheme.ts",
    label: "muiTheme body2/caption/DialogTitle",
    migrate: true,
    patterns: [/fontSize:\s*"(?:0\.\d+rem|[\d.]+px)"/gi],
  },
  {
    file: "src/components/AiEventDetail.tsx",
    label: "AiEventDetail DETAIL_FONT_SIZE constant",
    migrate: true,
    patterns: [/const\s+DETAIL_FONT_SIZE\s*=\s*\{[\s\S]*?"[\d]+px"/gi],
  },
  {
    file: "src/components/sidebar/StatsView.tsx",
    label: "StatsView STATS_FONT_SIZE constant",
    migrate: true,
    patterns: [/const\s+STATS_FONT_SIZE\s*=\s*\{[\s\S]*?"[\d]+px"/gi],
  },
  {
    file: "src/components/WindowTabs.tsx",
    label: "WindowTabs hardcoded fontSize (rem, numeric px)",
    migrate: true,
    patterns: [/fontSize:\s*"[0-9.]+rem"/gi, /fontSize:\s*(?:14|10)(?![.\d\w])/gi],
  },
  {
    file: "src/components/Sidebar.tsx",
    label: "Sidebar hardcoded fontSize (session count)",
    migrate: true,
    patterns: [/fontSize:\s*"[0-9]+px"/gi],
  },
  {
    file: "src/components/sidebar/SessionCard.tsx",
    label: "SessionCard hardcoded fontSize (16px, 10px)",
    migrate: true,
    patterns: [/fontSize:\s*"(?:16|10)px"/gi],
  },
  {
    file: "src/components/sidebar/SidebarFooter.tsx",
    label: "SidebarFooter badge fontSize 9px",
    migrate: true,
    patterns: [/fontSize:\s*"9px"/gi],
  },
  {
    file: "src/components/ErrorLogsPanel.tsx",
    label: "ErrorLogsPanel code fontSize rem",
    migrate: true,
    patterns: [/fontSize:\s*"[0-9.]+rem"/gi],
  },
]

const CSS_TARGETS: TypographyTarget[] = [
  {
    file: "src/styles/components.css",
    label: "components.css text-density font-size hardcodes",
    migrate: true,
    /**
     * Match font-size: Npx where N is in the scale range (8–16),
     * but NOT when the value is in the decorative allowlist.
     * CSS variables (var(--...)) are allowed.
     */
    patterns: [
      /font-size:\s*(?:8|9|10|11|12|13|14|15)px(?!\s*;?\s*\/\*.*decorative|\s*\/\*.*icon)/gi,
      /font-size:\s*0\.68rem/gi,
    ],
  },
]

function checkTsFile(file: string, target: TypographyTarget): string[] {
  const filePath = resolveWeb(target.file)
  const content = readFileSync(filePath, "utf-8")
  const violations: string[] = []

  for (const pattern of target.patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[0]
      const pxMatch = raw.match(/(?:fontSize|font-size):\s*(\d+)/i)
      if (pxMatch && pxMatch[1]) {
        const num = parseInt(pxMatch[1], 10)
        if (DECORATIVE_ALLOWLIST_PX.has(num)) {
          continue
        }
      }
      violations.push(`  "${raw.trim()}" in ${target.label}`)
    }
  }

  return violations
}

function checkCssFile(file: string, target: TypographyTarget): string[] {
  const filePath = resolveWeb(target.file)
  const content = readFileSync(filePath, "utf-8")

  const violations: string[] = []

  for (const pattern of target.patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[0]
      const start = Math.max(0, match.index - 20)
      const context = content.slice(start, match.index + match[0].length)
      if (context.includes("var(--")) {
        continue
      }
      violations.push(`  "${raw.trim()}" in ${target.label}`)
    }
  }

  return violations
}

describe("Typography Inventory — no hardcoded scale-participating font sizes", () => {
  test("TSX files — no prohibited hardcoded typography", () => {
    const allViolations: string[] = []

    for (const target of TSX_TARGETS) {
      const violations = checkTsFile(target.file, target)
      allViolations.push(...violations)
    }

    if (allViolations.length > 0) {
      const msg = [
        "Prohibited hardcoded typography found:",
        ...allViolations,
        "",
        "Migration required:",
        "  - muiTheme.ts: use CSS variable-aware rem values",
        "  - AiEventDetail.tsx: replace DETAIL_FONT_SIZE with CSS var refs",
        "  - StatsView.tsx: replace STATS_FONT_SIZE with CSS var refs",
        "  - WindowTabs.tsx: replace 0.68rem, 14, 10 with CSS vars",
        "  - SessionCard.tsx: replace 16px, 10px with CSS vars",
        "  - Sidebar.tsx: replace hardcoded px with CSS vars",
        "  - SidebarFooter.tsx: replace 9px badge fontSize with CSS var",
        "  - ErrorLogsPanel.tsx: replace rem fontSize with CSS var",
      ].join("\n")
      throw new Error(msg)
    }
  })

  test("CSS files — no prohibited hardcoded font-size", () => {
    const allViolations: string[] = []

    for (const target of CSS_TARGETS) {
      const violations = checkCssFile(target.file, target)
      allViolations.push(...violations)
    }

    if (allViolations.length > 0) {
      const msg = [
        "Prohibited hardcoded font-size in CSS:",
        ...allViolations,
        "",
        "Migration required:",
        "  - components.css: replace 8/9/10/12/14/16px with CSS vars",
        "  - 48px decorative/icon sizes are allowlisted",
      ].join("\n")
      throw new Error(msg)
    }
  })
})

import DOMPurify, { type Config } from "dompurify"
import { useMemo } from "react"

const SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["script", "iframe", "form", "input", "object", "embed", "style"],
  FORBID_ATTR: [
    "onclick",
    "onerror",
    "onload",
    "onmouseover",
    "onmouseout",
    "onmousedown",
    "onmouseup",
    "onkeydown",
    "onkeyup",
    "onfocus",
    "onblur",
    "onchange",
    "oninput",
    "onsubmit",
    "onreset",
    "onselect",
    "ondblclick",
    "oncontextmenu",
    "onwheel",
    "ondrag",
    "ondragstart",
    "ondragend",
    "ondragover",
    "ondragenter",
    "ondragleave",
    "ondrop",
  ],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
}

export interface SafeHtmlProps {
  html: string
  className?: string
}

export function SafeHtml({ html, className }: SafeHtmlProps) {
  const sanitized = useMemo(() => DOMPurify.sanitize(html, SANITIZE_CONFIG), [html])

  return (
    <div
      className={className}
      data-testid="safe-html-wrapper"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  )
}

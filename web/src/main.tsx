import React from "react"
import ReactDOM from "react-dom/client"

import { App } from "./App.js"

// Suppress CSS transitions while the window is being resized so that layout
// elements (sidebar, main panel, etc.) snap instantly to the new window size
// instead of lagging behind with animated transitions.
// We observe the document body so we catch both manual drags and the macOS
// window-zoom animation (double-click title bar / green zoom button).
let resizeTimer = 0
const resizeObserver = new ResizeObserver(() => {
  document.body.classList.add("is-resizing")
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    document.body.classList.remove("is-resizing")
  }, 150)
})
resizeObserver.observe(document.body)

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element not found")
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

import type { ReactElement } from "react"
import { render, type RenderOptions } from "@testing-library/react"
import { AppProvider } from "../state/store.js"

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, {
    wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    ...options,
  })
}

export * from "@testing-library/react"

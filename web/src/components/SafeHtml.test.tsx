import { describe, test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SafeHtml } from "./SafeHtml.js"

describe("SafeHtml", () => {
  test("renders safe HTML content", () => {
    const { container } = render(<SafeHtml html="<p>Hello <strong>world</strong></p>" />)
    expect(screen.getByText("Hello")).toBeInTheDocument()
    expect(container.querySelector("strong")).toHaveTextContent("world")
  })

  test("strips script tags", () => {
    const { container } = render(<SafeHtml html='<div>safe</div><script>alert("xss")</script>' />)
    expect(screen.getByText("safe")).toBeInTheDocument()
    expect(container.querySelector("script")).toBeNull()
  })

  test("strips onclick attributes", () => {
    render(<SafeHtml html='<button onclick="alert(1)">Click</button>' />)
    const btn = screen.getByText("Click")
    expect(btn).not.toHaveAttribute("onclick")
  })

  test("strips javascript: URLs", () => {
    render(<SafeHtml html='<a href="javascript:alert(1)">link</a>' />)
    const link = screen.getByText("link")
    const href = link.getAttribute("href")
    expect(href).toBeFalsy()
  })

  test("strips iframe tags", () => {
    const { container } = render(
      <SafeHtml html='<iframe src="https://evil.com"></iframe><p>safe</p>' />,
    )
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("safe")).toBeInTheDocument()
  })

  test("strips form tags", () => {
    const { container } = render(
      <SafeHtml html='<form action="/hack"><input type="text"/></form>' />,
    )
    expect(container.querySelector("form")).toBeNull()
    expect(container.querySelector("input")).toBeNull()
  })

  test("strips style tags", () => {
    const { container } = render(<SafeHtml html="<style>.evil{color:red}</style><p>visible</p>" />)
    expect(container.querySelector("style")).toBeNull()
    expect(screen.getByText("visible")).toBeInTheDocument()
  })

  test("allows http and https href", () => {
    render(<SafeHtml html='<a href="https://example.com">link</a>' />)
    const link = screen.getByText("link") as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe("https://example.com")
  })

  test("allows mailto href", () => {
    render(<SafeHtml html='<a href="mailto:test@example.com">email</a>' />)
    const link = screen.getByText("email") as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe("mailto:test@example.com")
  })

  test("strips data attributes when ALLOW_DATA_ATTR is false", () => {
    render(<SafeHtml html='<div data-evil="payload">content</div>' />)
    const div = screen.getByText("content")
    expect(div).not.toHaveAttribute("data-evil")
  })

  test("renders empty string without error", () => {
    render(<SafeHtml html="" />)
    const container = screen.getByTestId("safe-html-wrapper")
    expect(container.innerHTML).toBe("")
  })

  test("applies className to wrapper", () => {
    render(<SafeHtml html="<span>test</span>" className="custom-class" />)
    expect(screen.getByTestId("safe-html-wrapper").className).toContain("custom-class")
  })

  test("strips object and embed tags", () => {
    const { container } = render(
      <SafeHtml html='<object data="evil.swf"></object><embed src="evil.swf"/><p>ok</p>' />,
    )
    expect(container.querySelector("object")).toBeNull()
    expect(container.querySelector("embed")).toBeNull()
    expect(screen.getByText("ok")).toBeInTheDocument()
  })

  test("multiple on* attributes are all stripped", () => {
    render(<SafeHtml html='<div onmouseover="evil()" onfocus="hack()" onblur="pwn()">text</div>' />)
    const div = screen.getByText("text")
    expect(div).not.toHaveAttribute("onmouseover")
    expect(div).not.toHaveAttribute("onfocus")
    expect(div).not.toHaveAttribute("onblur")
  })
})

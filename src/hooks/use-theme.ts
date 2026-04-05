"use client"

import * as React from "react"

export function useTheme() {
  const [theme, setTheme] = React.useState<"light" | "dark">("light")

  React.useEffect(() => {
    const nextTheme = document.documentElement.classList.contains("dark") ? "dark" : "light"
    document.documentElement.dataset.theme = nextTheme
    setTheme(nextTheme)
  }, [])

  const toggle = React.useCallback(() => {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark"
    document.documentElement.classList.toggle("dark", next === "dark")
    document.documentElement.dataset.theme = next
    localStorage.setItem("theme", next)
    setTheme(next)
  }, [])

  return { theme, toggle }
}

import type { KbSidebarEntry } from "@/lib/kb-types"
import { escapeHtml } from "@/lib/kb-markdown"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchDocument = {
  id: string
  title: string
  author: string
  folder: string
  date: string
  previewText: string
  contentText: string
}

export type SearchResultItem = {
  entry: KbSidebarEntry
  score: number
  titleHtml: string
  previewHtml: string
  author: string
  date: string
}

// ─── Query tokenization ───────────────────────────────────────────────────────

export function tokenizeSearchQuery(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((part) => part.replace(/[^\p{L}\p{N}]+/gu, "").trim())
        .filter(Boolean),
    ),
  ]
}

// ─── Highlight utilities ──────────────────────────────────────────────────────

export function highlightText(text: string, terms: string[]): string {
  if (!text) return ""
  if (terms.length === 0) return escapeHtml(text)

  const lowered = text.toLowerCase()
  const ranges: Array<{ start: number; end: number }> = []

  for (const term of terms) {
    if (!term) continue
    let startIndex = 0
    const loweredTerm = term.toLowerCase()
    while (startIndex < lowered.length) {
      const matchIndex = lowered.indexOf(loweredTerm, startIndex)
      if (matchIndex === -1) break
      ranges.push({ start: matchIndex, end: matchIndex + loweredTerm.length })
      startIndex = matchIndex + loweredTerm.length
    }
  }

  if (ranges.length === 0) return escapeHtml(text)

  ranges.sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end) {
      merged.push({ ...range })
    } else {
      previous.end = Math.max(previous.end, range.end)
    }
  }

  let cursor = 0
  let html = ""
  for (const range of merged) {
    if (cursor < range.start) html += escapeHtml(text.slice(cursor, range.start))
    html += `<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`
    cursor = range.end
  }
  if (cursor < text.length) html += escapeHtml(text.slice(cursor))
  return html
}

export function createHighlightedSnippet(
  text: string,
  terms: string[],
  maxLength = 160,
): string {
  const normalized = text.trim()
  if (!normalized) return ""
  if (terms.length === 0) {
    const snippet = normalized.slice(0, maxLength)
    return `${escapeHtml(snippet)}${normalized.length > maxLength ? "…" : ""}`
  }

  const lowered = normalized.toLowerCase()
  const firstMatchIndex = terms
    .map((term) => lowered.indexOf(term.toLowerCase()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0]

  const start = Math.max(0, (firstMatchIndex ?? 0) - 36)
  const end = Math.min(normalized.length, start + maxLength)
  const snippet = normalized.slice(start, end)
  const prefix = start > 0 ? "…" : ""
  const suffix = end < normalized.length ? "…" : ""
  return `${prefix}${highlightText(snippet, terms)}${suffix}`
}

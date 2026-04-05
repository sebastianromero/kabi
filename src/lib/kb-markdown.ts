import hljs from "highlight.js/lib/core"
import markdownLanguage from "highlight.js/lib/languages/markdown"
import { marked } from "marked"
import type { Tokens } from "marked"

import { convertWikiLinks, mapHrefForNavigation, buildLocalAssetHref, isExternalHref } from "@/lib/kb-utils"

if (!hljs.getLanguage("markdown")) {
  hljs.registerLanguage("markdown", markdownLanguage)
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function renderMarkdownToHtml(
  markdown: string,
  sourceFilePath = "",
  vaultRootPath = "",
): string {
  const renderer = new marked.Renderer()

  renderer.link = ({ href, title, tokens }: Tokens.Link): string => {
    const rawHref = (href || "").trim()
    const mappedHref = mapHrefForNavigation(rawHref, sourceFilePath, vaultRootPath)
    const rawText = tokens?.length ? parser.parseInline(tokens) : rawHref
    const safeTitle = title ? ` title="${title.replace(/"/g, "&quot;")}"` : ""
    const targetAttrs = isExternalHref(mappedHref)
      ? ' target="_blank" rel="noopener noreferrer"'
      : ""
    return `<a href="${mappedHref || "#"}"${safeTitle}${targetAttrs}>${rawText}</a>`
  }

  renderer.image = ({ href, title, text }: Tokens.Image): string => {
    const rawHref = (href || "").trim()
    const mappedHref =
      /^https?:\/\//i.test(rawHref) || /^file:\/\//i.test(rawHref)
        ? rawHref
        : buildLocalAssetHref(rawHref, sourceFilePath, vaultRootPath)
    const safeAlt = escapeHtml(text || "")
    const safeTitle = title ? ` title="${title.replace(/"/g, "&quot;")}"` : ""
    return `<img src="${mappedHref}" alt="${safeAlt}"${safeTitle} loading="lazy" />`
  }

  const parser = new marked.Parser({ renderer })
  const normalized = convertWikiLinks(markdown)
  const tokens = marked.lexer(normalized, { gfm: true, breaks: true })
  return parser.parse(tokens)
}

export function renderMarkdownPreviewToHtml(
  markdown: string,
  sourceFilePath = "",
  vaultRootPath = "",
): string {
  const html = renderMarkdownToHtml(markdown, sourceFilePath, vaultRootPath)
  return html.replace(/^<p>/, "").replace(/<\/p>\s*$/, "").replace(/\n+/g, " ")
}

export function markdownToPlainText(markdown: string): string {
  return convertWikiLinks(markdown)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#-]+/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function renderRawMarkdownHighlighted(markdown: string): string {
  try {
    return hljs.highlight(markdown, { language: "markdown", ignoreIllegals: true }).value
  } catch {
    return escapeHtml(markdown)
  }
}

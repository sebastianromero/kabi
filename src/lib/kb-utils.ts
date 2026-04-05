import {
  ArchiveXIcon,
  FileIcon,
  FolderIcon,
  InboxIcon,
  SendIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react"

import type { KbSidebarEntry } from "@/lib/kb-types"

// ─── Types ────────────────────────────────────────────────────────────────────

export type FolderGroup = {
  name: string
  entries: KbSidebarEntry[]
}

export type SortMode = "date-desc" | "date-asc" | "title-asc" | "title-desc"

export type CategoryListItem =
  | { kind: "folder"; path: string; label: string; count: number; isNavigation?: boolean }
  | { kind: "entry"; entry: KbSidebarEntry; parentFolder?: string }

export type SidebarNavigationItem = {
  key: string
  action: () => void
}

export type SearchSessionSnapshot = {
  activeFolder: string
  activeCategoryPath: string
  selectedEntryId: string | null
  notesOpen: boolean
  pendingHighlightTerms: string[]
  locationHref: string | null
}

// ─── Folder icons ─────────────────────────────────────────────────────────────

const folderIconMap: Record<string, LucideIcon> = {
  root: FolderIcon,
  inbox: InboxIcon,
  drafts: FileIcon,
  sent: SendIcon,
  junk: ArchiveXIcon,
  trash: Trash2Icon,
}

export function getFolderIcon(folderName: string): LucideIcon {
  return folderIconMap[folderName.toLowerCase()] ?? FolderIcon
}

// ─── Date formatting ──────────────────────────────────────────────────────────

export function formatHumanDate(dateIso: string): string {
  const parsed = new Date(dateIso)
  if (Number.isNaN(parsed.getTime())) return "No date"
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(parsed)
}

export function formatHumanDateTime(dateIso: string): string {
  const parsed = new Date(dateIso)
  if (Number.isNaN(parsed.getTime())) return dateIso
  const hasTime = /T\d{2}:\d{2}/.test(dateIso)
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(parsed)
}

export function formatPropertyValue(key: string, value: string): string {
  if (!value || value === "-") return "-"
  if (/date|updated|created|published|pubdate/i.test(key)) {
    return formatHumanDateTime(value)
  }
  return value
}

// ─── Path / URL utilities ─────────────────────────────────────────────────────

export function normalizeEntryLookup(value: string): string {
  return decodeURIComponent(value)
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.mdx?$/i, "")
}

export function isMarkdownPath(value: string): boolean {
  const pathOnly = value.split(/[?#]/)[0] || ""
  return /\.mdx?$/i.test(pathOnly)
}

export function buildViewerDocHref(rawPath: string): string {
  const pathOnly = decodeURIComponent(rawPath.split(/[?#]/)[0] || rawPath).trim()
  return `/?doc=${encodeURIComponent(pathOnly)}`
}

export function buildFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/")
  if (!normalized) return ""
  const withLeadingSlash = /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized
  return encodeURI(`file://${withLeadingSlash}`)
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F")
}

export function buildElectronAssetUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/")
  return `kb-file://local/${encodeURIComponent(normalized)}`
}

export function buildLocalResourceUrl(absolutePath: string): string {
  if (!absolutePath) return ""
  return buildElectronAssetUrl(absolutePath)
}

export function buildDirectoryFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/").replace(/\/+$/, "")
  return `${buildFileUrl(normalized)}/`
}

export function getRelativeSourceDir(sourceFilePath = "", vaultRootPath = ""): string {
  const normalizedSource = sourceFilePath.replace(/\\/g, "/")
  const normalizedRoot = vaultRootPath.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalizedSource || !normalizedRoot) return ""
  const sourceDir = normalizedSource.replace(/\/[^/]*$/, "")
  if (!sourceDir.startsWith(`${normalizedRoot}/`)) return ""
  return sourceDir.slice(normalizedRoot.length + 1)
}

export function resolveLocalAbsolutePath(
  rawPath: string,
  sourceFilePath = "",
  vaultRootPath = "",
): string {
  const pathOnly = decodeURIComponent(rawPath.split(/[?#]/)[0] || rawPath).trim()
  if (!pathOnly) return ""
  if (pathOnly.startsWith("/")) return pathOnly
  if (/^[A-Za-z]:[\\/]/.test(pathOnly)) return pathOnly

  const normalizedPath = pathOnly.replace(/\\/g, "/").replace(/^\/+/, "")
  const relativeSourceDir = getRelativeSourceDir(sourceFilePath, vaultRootPath)
  if (
    vaultRootPath &&
    normalizedPath &&
    !normalizedPath.startsWith("./") &&
    !normalizedPath.startsWith("../") &&
    (normalizedPath.includes("/") || relativeSourceDir) &&
    (!relativeSourceDir ||
      normalizedPath === relativeSourceDir ||
      normalizedPath.startsWith(`${relativeSourceDir}/`))
  ) {
    return decodeURIComponent(
      new URL(normalizedPath, buildDirectoryFileUrl(vaultRootPath)).pathname,
    )
  }

  if (!sourceFilePath) return pathOnly
  return decodeURIComponent(new URL(pathOnly, buildFileUrl(sourceFilePath)).pathname)
}

export function buildLocalAssetHref(
  rawPath: string,
  sourceFilePath = "",
  vaultRootPath = "",
): string {
  const suffix = rawPath.match(/[?#].*$/)?.[0] ?? ""
  const resolvedPath = resolveLocalAbsolutePath(rawPath, sourceFilePath, vaultRootPath)
  return `${buildLocalResourceUrl(resolvedPath)}${suffix}`
}

export function mapHrefForNavigation(
  rawHref: string,
  sourceFilePath = "",
  vaultRootPath = "",
): string {
  const href = rawHref.trim()
  if (!href) return "#"
  if (href.startsWith("#")) return href
  if (href.startsWith("/?doc=")) return href
  if (/^(file|kb-file):\/\//i.test(href)) return href
  if (/^(mailto:|tel:|data:)/i.test(href)) return href
  if (/^https?:\/\//i.test(href)) {
    try {
      const parsed = new URL(href)
      if (isMarkdownPath(parsed.pathname)) return buildViewerDocHref(parsed.pathname)
    } catch {
      return href
    }
    return href
  }
  const resolvedPath = resolveLocalAbsolutePath(href, sourceFilePath, vaultRootPath)
  if (isMarkdownPath(resolvedPath)) return buildViewerDocHref(resolvedPath)
  return buildLocalAssetHref(href, sourceFilePath, vaultRootPath)
}

// ─── Wiki link helpers ────────────────────────────────────────────────────────

export function wikiDisplayLabel(target: string): string {
  const clean = target.split("#")[0]?.trim() || target.trim()
  const base = clean.split("/").pop() || clean
  return base.replace(/\.mdx?$/i, "")
}

export function convertWikiLinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (fullMatch, inner: string) => {
    const [rawTarget, rawAlias] = inner.split("|")
    const target = (rawTarget || "").trim()
    const alias = (rawAlias || "").trim()
    if (!target) return fullMatch
    const label = alias || wikiDisplayLabel(target)
    return `[${label}](/?doc=${encodeURIComponent(target.trim())})`
  })
}

// ─── Link introspection ───────────────────────────────────────────────────────

export function extractDocFromHref(rawHref: string): string | null {
  const href = rawHref.trim()
  if (!href) return null
  if (/^https?:\/\//i.test(href)) {
    try {
      return new URL(href).searchParams.get("doc")
    } catch {
      return null
    }
  }
  const qIndex = href.indexOf("?")
  if (qIndex === -1) return null
  return new URLSearchParams(href.slice(qIndex + 1)).get("doc")
}

export function isExternalHref(rawHref: string): boolean {
  const href = rawHref.trim()
  if (!href || href.startsWith("#")) return false
  if (/^(mailto:|tel:)/i.test(href)) return true
  if (/^(file|kb-file):\/\//i.test(href)) return true
  if (!/^https?:\/\//i.test(href)) return false
  if (typeof window === "undefined") return true
  try {
    return new URL(href).origin !== window.location.origin
  } catch {
    return true
  }
}

export function inferLinkHref(
  value: string,
  sourceFilePath = "",
  vaultRootPath = "",
): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "-") return null
  if (
    /^(https?:\/\/|file:\/\/|mailto:|tel:)/i.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /^\w[^\s]*\.mdx?(?:[?#].*)?$/i.test(trimmed)
  ) {
    return mapHrefForNavigation(trimmed, sourceFilePath, vaultRootPath)
  }
  if (/^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return null
}

// ─── Category / navigation helpers ───────────────────────────────────────────

export function createInitialSelection(groups: FolderGroup[]): {
  folder: string
  entry: KbSidebarEntry | null
} {
  const firstGroup = groups.find((group) => normalizeEntryLookup(group.name) === "root") ?? groups[0]
  if (!firstGroup) return { folder: "", entry: null }
  return { folder: firstGroup.name, entry: firstGroup.entries[0] ?? null }
}

export function getEntryCategoryPath(entry: KbSidebarEntry): string {
  const parts = normalizeEntryLookup(entry.id).split("/").filter(Boolean)
  return parts.slice(0, -1).join("/") || normalizeEntryLookup(entry.folder || "root")
}

export function getBreadcrumbSegments(
  entry: KbSidebarEntry,
): Array<{ label: string; path: string }> {
  const rawParts = decodeURIComponent(entry.id).split("/").filter(Boolean)
  const categoryParts = rawParts.slice(0, -1)
  return categoryParts.map((part, index) => ({
    label: part,
    path: rawParts.slice(0, index + 1).join("/"),
  }))
}

export function getParentCategoryPath(categoryPath: string): string | null {
  const normalized = normalizeEntryLookup(categoryPath)
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join("/")
}

export function getCategoryDisplayLabel(categoryPath: string): string {
  const normalized = normalizeEntryLookup(categoryPath)
  if (!normalized || normalized === "root") return "Files"
  const parts = normalized.split("/").filter(Boolean)
  return decodeURIComponent(parts.at(-1) || normalized || "No folder")
}

export function hasCategoryContent(entries: KbSidebarEntry[], categoryPath: string): boolean {
  const normalizedCategory = normalizeEntryLookup(categoryPath)
  if (!normalizedCategory) return false
  return entries.some((entry) => {
    const entryCategory = getEntryCategoryPath(entry)
    const entryId = normalizeEntryLookup(entry.id)
    return (
      entryCategory === normalizedCategory ||
      entryCategory.startsWith(`${normalizedCategory}/`) ||
      entryId === normalizedCategory
    )
  })
}

export function getDirectChildCategoryPath(
  categoryPath: string,
  entry: KbSidebarEntry,
): string | null {
  const normalizedCategory = normalizeEntryLookup(categoryPath)
  const entryCategory = getEntryCategoryPath(entry)
  if (entryCategory === normalizedCategory) return null
  if (!entryCategory.startsWith(`${normalizedCategory}/`)) return null
  const categoryParts = normalizedCategory.split("/").filter(Boolean)
  const entryParts = entryCategory.split("/").filter(Boolean)
  const nextPart = entryParts[categoryParts.length]
  if (!nextPart) return null
  return [...categoryParts, nextPart].join("/")
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

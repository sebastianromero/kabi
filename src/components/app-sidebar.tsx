"use client"

import * as React from "react"
import MiniSearch from "minisearch"
import type { KbSidebarEntry } from "@/lib/kb-types"
import {
  type FolderGroup, type SortMode, type CategoryListItem,
  type SidebarNavigationItem, type SearchSessionSnapshot,
  formatHumanDate, normalizeEntryLookup, extractDocFromHref,
  createInitialSelection, getEntryCategoryPath, getBreadcrumbSegments,
  getParentCategoryPath, getCategoryDisplayLabel, hasCategoryContent,
  getDirectChildCategoryPath,
} from "@/lib/kb-utils"
import {
  type SearchDocument, type SearchResultItem,
  tokenizeSearchQuery, highlightText, createHighlightedSnippet,
} from "@/lib/kb-search"
import {
  renderMarkdownToHtml, renderMarkdownPreviewToHtml,
  markdownToPlainText, renderRawMarkdownHighlighted,
} from "@/lib/kb-markdown"
import { useTheme } from "@/hooks/use-theme"
import { DocumentPropertiesPanel } from "@/components/properties-panel"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarContent, SidebarGroup, SidebarGroupContent, SidebarInput,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { toast } from "sonner"
import {
  ArrowDownAZIcon, ArrowUpAZIcon, BookOpenIcon,
  CalendarArrowDownIcon, CalendarArrowUpIcon, ChevronLeftIcon, ChevronRightIcon,
  Code2Icon, FileIcon, FolderIcon, MoonIcon,
  PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightCloseIcon, PanelRightOpenIcon,
  SearchIcon, Settings2Icon, SunIcon, XIcon,
} from "lucide-react"

// ─── AppSidebar ───────────────────────────────────────────────────────────────

export function AppSidebar({ entries }: { entries: KbSidebarEntry[] }) {
  console.log('[AppSidebar] Mount with entries:', entries.length)
  const [isDesktopMac, setIsDesktopMac] = React.useState(false)
  const [viewportWidth, setViewportWidth] = React.useState<number | null>(null)

  React.useEffect(() => {
    setIsDesktopMac(Boolean(window.kabi) && /Mac/i.test(window.navigator.platform))
  }, [])

  React.useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth)
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  const [runtimeEntries, setRuntimeEntries] = React.useState<KbSidebarEntry[]>(entries)
  const [vaultPath, setVaultPath] = React.useState("")
  const [vaultPathLoaded, setVaultPathLoaded] = React.useState(false)
  const [entriesLoaded, setEntriesLoaded] = React.useState(entries.length > 0)
  const didAutoOpenPreferencesRef = React.useRef(false)

  React.useEffect(() => {
    console.log('[AppSidebar] runtimeEntries updated:', runtimeEntries.length)
  }, [runtimeEntries])

  const refreshEntries = React.useCallback(async () => {
    console.log('[AppSidebar] refreshEntries called')
    if (!window.kabi?.getEntries) {
      console.log('[AppSidebar] window.kabi.getEntries not available')
      return
    }
    try {
      const nextEntries = await window.kabi.getEntries()
      console.log('[AppSidebar] Loaded entries:', nextEntries.length)
      setRuntimeEntries(nextEntries)
    } catch (error) {
      console.error('[AppSidebar] Failed to get entries:', error)
      setRuntimeEntries([])
    } finally {
      setEntriesLoaded(true)
    }
  }, [])

  // Initialize IPC listeners and load initial state
  React.useEffect(() => {
    if (typeof window === 'undefined') return

    let vaultChangedDispose: (() => void) | undefined
    let entriesChangedDispose: (() => void) | undefined
    let isMounted = true
    let pollInterval: NodeJS.Timeout | undefined

    const initialize = async () => {
      // Wait for window.kabi to be available (max 5 seconds)
      let attempts = 0
      while (!window.kabi && attempts < 50) {
        await new Promise(r => setTimeout(r, 100))
        attempts++
      }

      if (!isMounted || !window.kabi) {
        console.log('[AppSidebar] window.kabi not available after timeout')
        return
      }

      console.log('[AppSidebar] window.kabi is available, initializing...')

      // Register vault changed listener
      if (window.kabi.onVaultChanged) {
        vaultChangedDispose = window.kabi.onVaultChanged((newVaultPath) => {
          console.log('[AppSidebar] Vault changed:', newVaultPath)
          if (isMounted) {
            setVaultPath(newVaultPath)
            setEntriesLoaded(false)
            void refreshEntries()
          }
        })
      }

      // Register entries changed listener
      if (window.kabi.onEntriesChanged) {
        entriesChangedDispose = window.kabi.onEntriesChanged(() => {
          console.log('[AppSidebar] Entries changed event')
          void refreshEntries()
        })
      }

      // Load initial vault path
      try {
        if (window.kabi.getVaultPath) {
          const currentVault = await window.kabi.getVaultPath()
          console.log('[AppSidebar] Initial vault path:', currentVault)
          if (isMounted) {
            setVaultPath(currentVault)
            setVaultPathLoaded(true)
          }
        }
      } catch (error) {
        console.error('[AppSidebar] Failed to get vault path:', error)
        if (isMounted) setVaultPathLoaded(true)
      }

      // Load entries
      await refreshEntries()

      // Also poll every 2 seconds to catch vault changes (as fallback)
      pollInterval = setInterval(async () => {
        if (!isMounted || !window.kabi?.getVaultPath) return
        try {
          const currentVault = await window.kabi.getVaultPath()
          if (currentVault && currentVault !== vaultPath) {
            console.log('[AppSidebar] Vault changed detected via polling:', currentVault)
            setVaultPath(currentVault)
            setEntriesLoaded(false)
            void refreshEntries()
          }
        } catch {
          // Ignore polling errors
        }
      }, 2000)
    }

    void initialize()

    return () => {
      isMounted = false
      vaultChangedDispose?.()
      entriesChangedDispose?.()
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [refreshEntries, vaultPath])

  const groups = React.useMemo<FolderGroup[]>(() => {
    console.log('[AppSidebar] Building groups from', runtimeEntries.length, 'entries')
    const byFolder = new Map<string, KbSidebarEntry[]>()
    for (const entry of runtimeEntries) {
      const folder = entry.folder || "root"
      const existing = byFolder.get(folder)
      if (existing) existing.push(entry)
      else byFolder.set(folder, [entry])
    }
    const result = [...byFolder.entries()]
      .map(([name, folderEntries]) => ({
        name,
        entries: [...folderEntries].sort((a, b) => b.date.localeCompare(a.date)),
      }))
      .sort((a, b) => {
        const aIsRoot = normalizeEntryLookup(a.name) === "root"
        const bIsRoot = normalizeEntryLookup(b.name) === "root"
        if (aIsRoot && !bIsRoot) return -1
        if (!aIsRoot && bIsRoot) return 1
        return a.name.localeCompare(b.name)
      })
    console.log('[AppSidebar] Built groups:', result.length, result.map(g => ({ name: g.name, entries: g.entries.length })))
    return result
  }, [runtimeEntries])

  const initial = React.useMemo(() => createInitialSelection(groups), [groups])
  const [activeFolder, setActiveFolder] = React.useState(() => initial.folder)
  const [selectedEntryId, setSelectedEntryId] = React.useState<string | null>(
    () => initial.entry?.id ?? null,
  )
  const [activeCategoryPath, setActiveCategoryPath] = React.useState(() => initial.folder)
  const [query, setQuery] = React.useState("")
  const [sortMode, setSortMode] = React.useState<SortMode>("date-desc")
  const [pendingHighlightTerms, setPendingHighlightTerms] = React.useState<string[]>([])
  const [rendered, setRendered] = React.useState(true)
  const [propertiesOpen, setPropertiesOpen] = React.useState(true)
  const [notesOpen, setNotesOpen] = React.useState(true)
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => new Set(["root"]))
  const [focusedFolderPath, setFocusedFolderPath] = React.useState<string | null>(null)
  const [categoryTransitionDirection, setCategoryTransitionDirection] = React.useState<"none" | "forward" | "back">("none")
  const [categoryTransitionKey, setCategoryTransitionKey] = React.useState(0)
  const [outgoingSidebarItems, setOutgoingSidebarItems] = React.useState<CategoryListItem[] | null>(null)
  const [isCategorySliding, setIsCategorySliding] = React.useState(false)
  const [categoryTrackOffset, setCategoryTrackOffset] = React.useState(0)
  const [categoryTrackAnimated, setCategoryTrackAnimated] = React.useState(false)
  const isCompactLayout = viewportWidth !== null && viewportWidth < 1060
  const isBootstrapping = entries.length === 0 && (!vaultPathLoaded || !entriesLoaded)

  React.useEffect(() => {
    if (isCompactLayout) setPropertiesOpen(false)
  }, [isCompactLayout])

  const articleRef = React.useRef<HTMLElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const sidebarItemRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map())
  const searchSessionSnapshotRef = React.useRef<SearchSessionSnapshot | null>(null)
  const visibleSidebarItemsRef = React.useRef<CategoryListItem[]>([])
  const categorySlideKickoffFrameRef = React.useRef<number | null>(null)
  const categorySlideResetTimerRef = React.useRef<number | null>(null)
  const { theme, toggle: toggleTheme } = useTheme()

  const openPreferences = React.useCallback(async () => {
    await window.kabi?.openPreferencesWindow?.()
    if (!window.kabi?.getVaultPath) return
    const current = await window.kabi.getVaultPath()
    setVaultPath(current)
  }, [])

  React.useEffect(() => {
    if (didAutoOpenPreferencesRef.current) return
    if (!vaultPathLoaded) return
    if (runtimeEntries.length > 0) return
    if (vaultPath) return
    didAutoOpenPreferencesRef.current = true
    void openPreferences()
  }, [openPreferences, runtimeEntries.length, vaultPath, vaultPathLoaded])

  const searchDocuments = React.useMemo<SearchDocument[]>(() =>
    runtimeEntries.map((entry) => ({
      id: entry.id, title: entry.title, author: entry.author || "",
      folder: entry.folder, date: entry.date,
      previewText: markdownToPlainText(entry.preview),
      contentText: markdownToPlainText(entry.content),
    })),
    [runtimeEntries],
  )

  const searchIndex = React.useMemo(() => {
    const index = new MiniSearch<SearchDocument>({
      fields: ["title", "author", "previewText", "contentText"],
      storeFields: ["id", "title", "author", "folder", "date", "previewText", "contentText"],
      searchOptions: {
        prefix: true, fuzzy: 0.2,
        boost: { title: 5, author: 2, previewText: 2, contentText: 1 },
      },
    })
    index.addAll(searchDocuments)
    return index
  }, [searchDocuments])

  const entryLookup = React.useMemo(() => {
    const lookup = new Map<string, KbSidebarEntry>()
    for (const entry of runtimeEntries) {
      const byId = normalizeEntryLookup(entry.id)
      const byBasename = normalizeEntryLookup(entry.id.split("/").pop() || entry.id)
      const byTitle = normalizeEntryLookup(entry.title)
      if (!lookup.has(byId)) lookup.set(byId, entry)
      if (!lookup.has(byBasename)) lookup.set(byBasename, entry)
      if (!lookup.has(byTitle)) lookup.set(byTitle, entry)
    }
    return lookup
  }, [runtimeEntries])

  const sourcePathLookup = React.useMemo(() => {
    const lookup = new Map<string, KbSidebarEntry>()
    for (const entry of runtimeEntries) {
      if (!entry.sourceFilePath) continue
      const normalizedPath = normalizeEntryLookup(entry.sourceFilePath)
      if (!lookup.has(normalizedPath)) lookup.set(normalizedPath, entry)
    }
    return lookup
  }, [runtimeEntries])

  const selectedEntry = React.useMemo(
    () => runtimeEntries.find((e) => e.id === selectedEntryId) ?? null,
    [runtimeEntries, selectedEntryId],
  )

  React.useEffect(() => {
    const normalizedActiveFolder = normalizeEntryLookup(activeFolder || "root")
    setExpandedFolders((current) => {
      if (current.has(normalizedActiveFolder)) return current
      const next = new Set(current)
      next.add(normalizedActiveFolder)
      return next
    })
  }, [activeFolder])

  React.useEffect(() => {
    if (!selectedEntry) return
    const categoryPath = normalizeEntryLookup(getEntryCategoryPath(selectedEntry))
    const parts = categoryPath.split("/").filter(Boolean)
    setExpandedFolders((current) => {
      const next = new Set(current)
      let changed = false
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join("/")
        if (!next.has(path)) {
          next.add(path)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [selectedEntry])

  React.useEffect(() => {
    if (runtimeEntries.length === 0) {
      setActiveFolder(""); setSelectedEntryId(null); setActiveCategoryPath(""); return
    }
    const fallbackEntry = initial.entry
    const fallbackFolder = fallbackEntry?.folder ?? initial.folder
    const fallbackCategory = fallbackEntry ? getEntryCategoryPath(fallbackEntry) : initial.folder
    setSelectedEntryId((current) => {
      if (current && runtimeEntries.some((e) => e.id === current)) return current
      return fallbackEntry?.id ?? null
    })
    setActiveFolder((current) => {
      // Allow current folder if it's a valid group or if it's a valid nested path
      if (current) {
        // Check if it's a top-level group
        if (groups.some((g) => g.name === current)) return current
        // Check if it's a valid nested path (has entries in that path)
        if (current === "root" || runtimeEntries.some((e) => e.id.startsWith(current + "/"))) return current
      }
      return fallbackFolder
    })
    setActiveCategoryPath((current) => {
      if (current && hasCategoryContent(runtimeEntries, current)) return current
      return fallbackCategory
    })
  }, [runtimeEntries, groups, initial.entry, initial.folder])

  const openInternalDocument = React.useCallback(
    (rawDocPath: string, historyMode: "push" | "replace" = "push") => {
      const normalized = normalizeEntryLookup(rawDocPath)
      const byBasename = normalizeEntryLookup(rawDocPath.split("/").pop() || rawDocPath)
      const match = sourcePathLookup.get(normalized) ?? entryLookup.get(normalized) ?? entryLookup.get(byBasename)
      if (!match) return
      const categoryPath = getEntryCategoryPath(match)
      const isFolderIndexEntry = normalizeEntryLookup(match.id.split("/").pop() || "") === "index"
      const folderContextPath = isFolderIndexEntry
        ? getParentCategoryPath(categoryPath) || "root"
        : categoryPath
      setActiveFolder(folderContextPath)
      setActiveCategoryPath(categoryPath)
      setSelectedEntryId(match.id)
      if (typeof window !== "undefined") {
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set("doc", rawDocPath)
        const nextHref = nextUrl.toString()
        if (historyMode === "replace") window.history.replaceState({}, "", nextHref)
        else if (window.location.href !== nextHref) window.history.pushState({}, "", nextHref)
      }
    },
    [entryLookup, sourcePathLookup],
  )

  const openCategoryPath = React.useCallback(
    (categoryPath: string, navigationDirection: "auto" | "forward" | "back" = "auto") => {
      const normalizedPath = normalizeEntryLookup(categoryPath)
      const nextFolder = normalizedPath || "root"
      const exactEntry = entryLookup.get(normalizedPath)
      if (exactEntry) { setPendingHighlightTerms([]); openInternalDocument(exactEntry.id); return }

      const currentPath = normalizeEntryLookup(activeCategoryPath || focusedFolderPath || activeFolder)
      const currentDepth = currentPath.split("/").filter(Boolean).length
      const nextDepth = normalizedPath.split("/").filter(Boolean).length
      const resolvedDirection = navigationDirection === "auto"
        ? nextDepth > currentDepth ? "forward" : nextDepth < currentDepth ? "back" : "forward"
        : navigationDirection

      setCategoryTransitionDirection(resolvedDirection)
      setCategoryTransitionKey((value) => value + 1)
      if (!query.trim()) {
        setOutgoingSidebarItems(visibleSidebarItemsRef.current)
        setIsCategorySliding(true)
        setCategoryTrackAnimated(false)
        setCategoryTrackOffset(resolvedDirection === "forward" ? 0 : -50)
      }

      setActiveFolder(nextFolder)
      setActiveCategoryPath(normalizedPath)
      setFocusedFolderPath(normalizedPath)
      setSelectedEntryId(null)
      setNotesOpen(true)
      if (typeof window !== "undefined") {
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.delete("doc")
        window.history.pushState({}, "", nextUrl.toString())
      }
    },
    [
      activeCategoryPath,
      activeFolder,
      entryLookup,
      focusedFolderPath,
      openInternalDocument,
      query,
    ],
  )

  const handleFolderSidebarClick = React.useCallback(
    (folderName: string) => {
      const normalizedFolder = normalizeEntryLookup(folderName)
      setNotesOpen(true)
      setActiveFolder(normalizedFolder)
      setActiveCategoryPath(normalizedFolder)
      setFocusedFolderPath(normalizedFolder)
      setExpandedFolders((current) => {
        if (current.has(normalizedFolder)) return current
        const next = new Set(current)
        next.add(normalizedFolder)
        return next
      })
      if (selectedEntry) {
        return
      }
      openCategoryPath(normalizedFolder)
    },
    [openCategoryPath, selectedEntry],
  )

  const handleFolderContextMenu = React.useCallback(
    async (event: React.MouseEvent, folderPath: string) => {
      event.preventDefault()
      const action = await window.kabi?.showFolderContextMenu?.()
      if (action !== "open") return
      const normalizedPath = normalizeEntryLookup(folderPath)
      openCategoryPath(normalizedPath, "forward")
      setFocusedFolderPath(normalizedPath)
      setActiveCategoryPath(normalizedPath)
      setSelectedEntryId(null)
      setNotesOpen(true)
    },
    [openCategoryPath],
  )

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const rawDoc = new URLSearchParams(window.location.search).get("doc")
    if (!rawDoc) return
    openInternalDocument(rawDoc, "replace")
  }, [openInternalDocument])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const onPopState = () => {
      const rawDoc = new URLSearchParams(window.location.search).get("doc")
      if (!rawDoc) return
      openInternalDocument(rawDoc, "replace")
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [openInternalDocument])

  const restoreSearchSession = React.useCallback(() => {
    const snapshot = searchSessionSnapshotRef.current
    setQuery("")
    if (!snapshot) { setPendingHighlightTerms([]); searchInputRef.current?.focus(); return }
    searchSessionSnapshotRef.current = null
    setPendingHighlightTerms(snapshot.pendingHighlightTerms)
    setNotesOpen(snapshot.notesOpen)
    if (snapshot.selectedEntryId) {
      openInternalDocument(snapshot.selectedEntryId, "replace")
      if (!snapshot.notesOpen) setNotesOpen(false)
    } else {
      setActiveFolder(snapshot.activeFolder)
      setActiveCategoryPath(snapshot.activeCategoryPath)
      setSelectedEntryId(null)
      if (typeof window !== "undefined")
        window.history.replaceState({}, "", snapshot.locationHref ?? window.location.href)
    }
    searchInputRef.current?.focus()
  }, [openInternalDocument])

  const handleSearchChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextQuery = event.target.value
      if (!query.trim() && nextQuery.trim() && !searchSessionSnapshotRef.current) {
        searchSessionSnapshotRef.current = {
          activeFolder, activeCategoryPath, selectedEntryId, notesOpen, pendingHighlightTerms,
          locationHref: typeof window !== "undefined" ? window.location.href : null,
        }
      }
      setQuery(nextQuery)
    },
    [activeCategoryPath, activeFolder, notesOpen, pendingHighlightTerms, query, selectedEntryId],
  )

  React.useEffect(() => {
    const article = articleRef.current
    if (!article) return
    for (const mark of article.querySelectorAll<HTMLElement>("mark[data-search-highlight]")) {
      const parent = mark.parentNode
      if (parent) { parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark); parent.normalize() }
    }
    if (pendingHighlightTerms.length === 0 || !rendered) return
    const escaped = pendingHighlightTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi")
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName.toLowerCase()
        if (tag === "script" || tag === "style" || tag === "mark") return NodeFilter.FILTER_REJECT
        const val = node.nodeValue ?? ""
        pattern.lastIndex = 0
        return val.trim() && pattern.test(val) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      },
    })
    const textNodes: Text[] = []
    let node: Node | null
    while ((node = walker.nextNode())) textNodes.push(node as Text)
    let firstMark: HTMLElement | null = null
    for (const textNode of textNodes) {
      const text = textNode.nodeValue ?? ""
      pattern.lastIndex = 0
      const parts = text.split(pattern)
      if (parts.length <= 1) continue
      const fragment = document.createDocumentFragment()
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? ""
        if (i % 2 === 0) { if (part) fragment.appendChild(document.createTextNode(part)) }
        else {
          const mark = document.createElement("mark")
          mark.setAttribute("data-search-highlight", "")
          mark.textContent = part
          fragment.appendChild(mark)
          if (!firstMark) firstMark = mark
        }
      }
      textNode.parentNode?.replaceChild(fragment, textNode)
    }
    if (firstMark) {
      const block = firstMark.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th") ?? firstMark
      requestAnimationFrame(() => {
        block.scrollIntoView({ behavior: "smooth", block: "center" })
        block.classList.add("search-hit-flash")
        block.addEventListener("animationend", () => block.classList.remove("search-hit-flash"), { once: true })
      })
    }
  }, [selectedEntry?.id, pendingHighlightTerms, rendered])

  const handleMarkdownClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const link = (event.target as HTMLElement | null)?.closest("a") as HTMLAnchorElement | null
      if (!link) return
      const docPath = extractDocFromHref(link.getAttribute("href") || "")
      if (!docPath) return
      event.preventDefault()
      setPendingHighlightTerms([])
      openInternalDocument(docPath)
    },
    [openInternalDocument],
  )

  const handleCopyInternalLink = React.useCallback(async (entry: KbSidebarEntry) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    const wikiLink = `[[${entry.id}|${entry.title}]]`
    try {
      await navigator.clipboard.writeText(wikiLink)
      toast.success("Internal link copied", { description: wikiLink })
    } catch { toast.error("Could not copy link") }
  }, [])

  const activeGroup = groups.find((g) => g.name === activeFolder) ?? null
  const queryTerms = React.useMemo(() => tokenizeSearchQuery(query), [query])
  const categoryParentPath = React.useMemo(
    () => getParentCategoryPath(activeCategoryPath), [activeCategoryPath],
  )

  const visibleItems = React.useMemo<CategoryListItem[]>(() => {
    console.log('[AppSidebar] visibleItems memo running, runtimeEntries:', runtimeEntries.length)
    
    // Determine what items to show
    const items: CategoryListItem[] = []
    const normalizedActiveFolder = normalizeEntryLookup(activeFolder || "root")
    const activeSegments = normalizedActiveFolder === "root"
      ? []
      : normalizedActiveFolder.split("/").filter(Boolean)
    
    // Add "back" navigation button if not at root
    if (activeFolder !== "root") {
      const parentPath = getParentCategoryPath(activeFolder) || "root"
      items.push({
        kind: "folder",
        path: "..up",
        label: `Back to ${getCategoryDisplayLabel(parentPath) || "Files"}`,
        count: 0,
        isNavigation: true
      })
    }
    
    // Group items by their immediate child folder/entry
    const folderCounts = new Map<string, number>()
    const folderLabels = new Map<string, string>()
    const childIndexEntryId = new Map<string, string>()
    const childHasNonIndexContent = new Set<string>()
    const entryPaths = new Set<string>()
    
    for (const entry of runtimeEntries) {
      const rawSegments = entry.id.split("/").filter(Boolean)
      if (rawSegments.length === 0) continue
      const normalizedSegments = rawSegments.map((segment) => normalizeEntryLookup(segment))

      // Check whether this entry belongs to the active folder (case-insensitive)
      let belongsToActiveFolder = true
      for (let i = 0; i < activeSegments.length; i++) {
        if (normalizedSegments[i] !== activeSegments[i]) {
          belongsToActiveFolder = false
          break
        }
      }
      if (!belongsToActiveFolder || normalizedSegments.length <= activeSegments.length) continue

      const relativeSegmentsRaw = rawSegments.slice(activeSegments.length)
      const relativeRaw = relativeSegmentsRaw[0]
      const relativeNormalized = normalizeEntryLookup(relativeRaw)
      if (!folderLabels.has(relativeNormalized)) folderLabels.set(relativeNormalized, relativeRaw)
      const isDirectEntry = normalizedSegments.length === activeSegments.length + 1
      
      if (isDirectEntry) {
        entryPaths.add(entry.id)
      } else {
        const isChildIndexFile =
          relativeSegmentsRaw.length === 2
          && normalizeEntryLookup(relativeSegmentsRaw[1] || "") === "index"

        if (isChildIndexFile) {
          if (!childIndexEntryId.has(relativeNormalized)) childIndexEntryId.set(relativeNormalized, entry.id)
          continue
        }

        childHasNonIndexContent.add(relativeNormalized)
        folderCounts.set(relativeNormalized, (folderCounts.get(relativeNormalized) ?? 0) + 1)
      }
    }
    
    // Add folder nodes (or index files when folder only contains index)
    const childKeys = Array.from(new Set([
      ...folderCounts.keys(),
      ...childIndexEntryId.keys(),
    ])).sort()

    for (const childKey of childKeys) {
      const hasIndex = childIndexEntryId.has(childKey)
      const hasNonIndex = childHasNonIndexContent.has(childKey)

      // If child folder only has index, treat it as a file in current folder.
      if (hasIndex && !hasNonIndex) {
        entryPaths.add(childIndexEntryId.get(childKey) as string)
        continue
      }

      const path = normalizedActiveFolder === "root" ? childKey : `${normalizedActiveFolder}/${childKey}`
      const noteCount = (folderCounts.get(childKey) ?? 0) + (hasIndex ? 1 : 0)
      items.push({
        kind: "folder",
        path,
        label: folderLabels.get(childKey) ?? childKey,
        count: noteCount,
      })
    }
    
    // Add direct entries
    for (const entryId of entryPaths) {
      const entry = runtimeEntries.find(e => e.id === entryId)
      if (entry) {
        items.push({ 
          kind: "entry", 
          entry, 
          parentFolder: normalizedActiveFolder 
        })
      }
    }

    console.log('[AppSidebar] Built items:', items.length, 'folders:', folderCounts.size, 'entries:', entryPaths.size)
    return items
  }, [runtimeEntries, activeFolder])

  const searchResults = React.useMemo<SearchResultItem[]>(() => {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []
    return searchIndex
      .search(normalizedQuery)
      .map((result) => {
        const entry = runtimeEntries.find((e) => e.id === result.id)
        if (!entry) return null
        return {
          entry, score: result.score,
          titleHtml: highlightText(entry.title, queryTerms),
          previewHtml: createHighlightedSnippet(
            result.contentText || result.previewText || entry.preview || entry.content, queryTerms,
          ),
          author: entry.author || "Unknown author",
          date: formatHumanDate(entry.date),
        }
      })
      .filter((item): item is SearchResultItem => item !== null)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
  }, [runtimeEntries, query, queryTerms, searchIndex])

  const visibleSidebarItems = React.useMemo<CategoryListItem[]>(() =>
    query.trim() ? searchResults.map((r) => ({ kind: "entry" as const, entry: r.entry })) : visibleItems,
    [query, searchResults, visibleItems],
  )

  React.useEffect(() => {
    visibleSidebarItemsRef.current = visibleSidebarItems
  }, [visibleSidebarItems])

  const sidebarNavigationItems = React.useMemo<SidebarNavigationItem[]>(() =>
    visibleSidebarItems.map((item) => {
      if (item.kind === "folder")
        return {
          key: `folder:${item.path}`,
          action: () => {
            if (item.isNavigation) {
              const parentPath = getParentCategoryPath(activeFolder) || "root"
              openCategoryPath(parentPath, "back")
              return
            }
            openCategoryPath(item.path, "forward")
          },
        }
      return {
        key: `entry:${item.entry.id}`,
        action: () => {
          setPendingHighlightTerms(query.trim() ? queryTerms : [])
          openInternalDocument(item.entry.id)
        },
      }
    }),
    [activeFolder, openCategoryPath, openInternalDocument, query, queryTerms, visibleSidebarItems],
  )

  const setSidebarItemRef = React.useCallback(
    (key: string, node: HTMLButtonElement | null) => {
      if (node) sidebarItemRefs.current.set(key, node)
      else sidebarItemRefs.current.delete(key)
    },
    [],
  )

  const navigateSearchResultsFromInput = React.useCallback(
    (direction: "up" | "down") => {
      if (!query.trim() || sidebarNavigationItems.length === 0) return
      const currentIndex = selectedEntryId
        ? sidebarNavigationItems.findIndex((item) => item.key === `entry:${selectedEntryId}`)
        : -1
      const nextIndex = direction === "down"
        ? currentIndex >= 0 ? Math.min(currentIndex + 1, sidebarNavigationItems.length - 1) : 0
        : currentIndex >= 0 ? Math.max(currentIndex - 1, 0) : sidebarNavigationItems.length - 1
      const nextItem = sidebarNavigationItems[nextIndex]
      if (!nextItem) return
      nextItem.action()
      sidebarItemRefs.current.get(nextItem.key)?.focus()
    },
    [query, selectedEntryId, sidebarNavigationItems],
  )

  const handleSearchKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        if (!query.trim()) return
        event.preventDefault()
        restoreSearchSession()
        return
      }
      if (event.key === "ArrowDown") { event.preventDefault(); navigateSearchResultsFromInput("down"); return }
      if (event.key === "ArrowUp") { event.preventDefault(); navigateSearchResultsFromInput("up") }
    },
    [navigateSearchResultsFromInput, query, restoreSearchSession],
  )

  const handleSidebarItemKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, itemKey: string) => {
      const currentIndex = sidebarNavigationItems.findIndex((item) => item.key === itemKey)
      if (currentIndex === -1) return
      if (event.key === "Enter") {
        event.preventDefault()
        sidebarNavigationItems[currentIndex]?.action()
        return
      }
      let nextIndex = currentIndex
      if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + 1, sidebarNavigationItems.length - 1)
      else if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - 1, 0)
      else if (event.key === "Home") nextIndex = 0
      else if (event.key === "End") nextIndex = sidebarNavigationItems.length - 1
      else return
      event.preventDefault()
      const nextItem = sidebarNavigationItems[nextIndex]
      if (!nextItem) return
      sidebarItemRefs.current.get(nextItem.key)?.focus()
      nextItem.action()
    },
    [sidebarNavigationItems],
  )

  const renderSidebarItemList = React.useCallback((items: CategoryListItem[]) => (
    items.map((item) => {
      if (item.kind === "folder") {
        const itemKey = `folder:${item.path}`
        const normalizedPath = normalizeEntryLookup(item.path)
        const isNavigation = (item as any).isNavigation
        
        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton
              type="button"
              ref={(node) => setSidebarItemRef(itemKey, node)}
              onClick={() => {
                if (isNavigation) {
                  const parentPath = getParentCategoryPath(activeFolder) || "root"
                  openCategoryPath(parentPath, "back")
                } else {
                  openCategoryPath(item.path, "forward")
                }
              }}
              onContextMenu={(event) => {
                if (!isNavigation) {
                  void handleFolderContextMenu(event, normalizedPath)
                }
              }}
              onKeyDown={(event) => handleSidebarItemKeyDown(event, itemKey)}
              className="h-auto w-full cursor-pointer select-none items-start py-2.5 transition-colors"
              style={{ paddingLeft: "10px" }}
            >
              <div className="pointer-events-none flex w-full items-center gap-3">
                <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
                  {isNavigation ? (
                    <ChevronLeftIcon className="size-4" />
                  ) : (
                    <ChevronRightIcon className="size-3.5" />
                  )}
                  {!isNavigation && <FolderIcon className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-sm font-medium text-foreground">
                    {item.label}
                  </div>
                  {item.count > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.count} {item.count === 1 ? "note" : "notes"}
                    </div>
                  )}
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      }

      const entry = item.entry
      const itemKey = `entry:${entry.id}`
      const parentFolder = (item as any).parentFolder || "root"
      // Entries under non-root folders get indented by 1 level
      const entryIndentLevel = parentFolder === "root" ? 0 : 1
      const searchResult = query.trim()
        ? searchResults.find((r) => r.entry.id === entry.id) ?? null
        : null

      return (
        <SidebarMenuItem key={entry.id}>
          <SidebarMenuButton
            ref={(node) => setSidebarItemRef(itemKey, node)}
            isActive={selectedEntryId === entry.id}
            onClick={() => {
              setPendingHighlightTerms(query.trim() ? queryTerms : [])
              openInternalDocument(entry.id)
            }}
            onKeyDown={(event) => handleSidebarItemKeyDown(event, itemKey)}
            className="h-auto items-start py-3"
            style={query.trim() ? undefined : { paddingLeft: `${10 + entryIndentLevel * 20}px` }}
          >
            {entryIndentLevel > 0 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-500"
                style={{ left: `${6 + (entryIndentLevel - 1) * 20}px` }}
              />
            )}
            <div className="flex w-full flex-col gap-1">
              <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">
                  {searchResult?.author ?? entry.author ?? "Unknown author"}
                </span>
                <span className="ml-auto">
                  {searchResult?.date ?? formatHumanDate(entry.date)}
                </span>
              </div>
              {searchResult ? (
                <div
                  className="line-clamp-1 w-full text-sm font-medium text-foreground [&_mark]:rounded [&_mark]:bg-primary/20 [&_mark]:px-0.5 [&_mark]:text-foreground"
                  dangerouslySetInnerHTML={{ __html: searchResult.titleHtml }}
                />
              ) : (
                <span className="line-clamp-1 w-full">{entry.title}</span>
              )}
              {searchResult ? (
                <div
                  className="line-clamp-3 w-full text-xs text-muted-foreground [&_mark]:rounded [&_mark]:bg-primary/20 [&_mark]:px-0.5 [&_mark]:text-foreground"
                  dangerouslySetInnerHTML={{ __html: searchResult.previewHtml }}
                />
              ) : (
                <div
                  className="sidebar-preview line-clamp-2 w-full text-xs text-muted-foreground"
                  data-theme={theme}
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownPreviewToHtml(
                      entry.preview, entry.sourceFilePath, entry.vaultRootPath,
                    ),
                  }}
                />
              )}
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )
    })
  ), [
    activeFolder,
    handleFolderContextMenu,
    handleSidebarItemKeyDown,
    openCategoryPath,
    openInternalDocument,
    query,
    queryTerms,
    searchResults,
    selectedEntryId,
    setSidebarItemRef,
    theme,
  ])

  const shouldRenderCategoryCarousel = !query.trim() && isCategorySliding && Boolean(outgoingSidebarItems)
  const CATEGORY_CAROUSEL_DURATION_MS = 520

  React.useEffect(() => {
    if (typeof window === "undefined") return

    if (categorySlideKickoffFrameRef.current !== null) {
      window.cancelAnimationFrame(categorySlideKickoffFrameRef.current)
      categorySlideKickoffFrameRef.current = null
    }
    if (categorySlideResetTimerRef.current !== null) {
      window.clearTimeout(categorySlideResetTimerRef.current)
      categorySlideResetTimerRef.current = null
    }

    if (!isCategorySliding || query.trim() || !outgoingSidebarItems) {
      setCategoryTrackAnimated(false)
      setCategoryTrackOffset(0)
      if (isCategorySliding) setIsCategorySliding(false)
      if (outgoingSidebarItems) setOutgoingSidebarItems(null)
      return
    }

    setCategoryTrackAnimated(false)
    setCategoryTrackOffset(categoryTransitionDirection === "forward" ? 0 : -50)

    categorySlideKickoffFrameRef.current = window.requestAnimationFrame(() => {
      categorySlideKickoffFrameRef.current = window.requestAnimationFrame(() => {
        setCategoryTrackAnimated(true)
        setCategoryTrackOffset(categoryTransitionDirection === "forward" ? -50 : 0)
        categorySlideKickoffFrameRef.current = null
      })
    })

    categorySlideResetTimerRef.current = window.setTimeout(() => {
      setIsCategorySliding(false)
      setOutgoingSidebarItems(null)
      setCategoryTrackAnimated(false)
      setCategoryTrackOffset(0)
      categorySlideResetTimerRef.current = null
    }, CATEGORY_CAROUSEL_DURATION_MS + 20)

    return () => {
      if (categorySlideKickoffFrameRef.current !== null) {
        window.cancelAnimationFrame(categorySlideKickoffFrameRef.current)
        categorySlideKickoffFrameRef.current = null
      }
      if (categorySlideResetTimerRef.current !== null) {
        window.clearTimeout(categorySlideResetTimerRef.current)
        categorySlideResetTimerRef.current = null
      }
    }
  }, [CATEGORY_CAROUSEL_DURATION_MS, categoryTransitionDirection, isCategorySliding, outgoingSidebarItems, query])

  if (isBootstrapping) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        <header
          className={`main-window-titlebar flex shrink-0 items-center border-b bg-sidebar px-2 py-1.5 gap-1 ${
            isDesktopMac ? "main-window-titlebar-inner" : ""
          }`}
        >
          <div className="flex shrink-0 items-center gap-0.5">
            <Skeleton className="size-8 rounded-xl" />
          </div>
          <div className="flex-1 px-1">
            <Skeleton className="h-5 w-36 rounded-lg" />
          </div>
          <Skeleton className="size-8 rounded-xl" />
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <aside className="hidden w-12.25 shrink-0 border-r bg-sidebar md:flex md:flex-col md:p-2">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full rounded-2xl" />
              <Skeleton className="h-9 w-full rounded-2xl" />
              <Skeleton className="h-9 w-full rounded-2xl" />
            </div>
            <div className="mt-auto flex flex-col gap-2 pt-2">
              <Skeleton className="h-9 w-full rounded-2xl" />
              <Skeleton className="h-9 w-full rounded-2xl" />
            </div>
          </aside>

          <section className="hidden w-88 shrink-0 border-r bg-sidebar md:flex md:flex-col">
            <div className="border-b p-3">
              <Skeleton className="h-10 w-full rounded-3xl" />
            </div>
            <div className="flex flex-col gap-3 p-3">
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-20 w-full rounded-2xl" />
            </div>
          </section>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 flex-col gap-4 p-6">
              <Skeleton className="h-10 w-56 rounded-xl" />
              <Skeleton className="h-5 w-72 rounded-lg" />
              <Skeleton className="h-28 w-full rounded-3xl" />
              <Skeleton className="h-5 w-[92%] rounded-lg" />
              <Skeleton className="h-5 w-[86%] rounded-lg" />
              <Skeleton className="h-5 w-[78%] rounded-lg" />
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">

      {/* ── Top chrome bar — full width, no vertical borders crossing it ───── */}
      <header
        className={`main-window-titlebar flex shrink-0 items-center border-b bg-sidebar px-2 py-1.5 gap-1 ${
          isDesktopMac ? "main-window-titlebar-inner" : ""
        }`}
      >
        {/* Left: toggle + optional back (always at fixed position) */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm"
                onClick={() => setNotesOpen((v) => !v)}
                aria-label={notesOpen ? "Hide notes panel" : "Show notes panel"}
              >
                {notesOpen
                  ? <PanelLeftCloseIcon className="size-4" />
                  : <PanelLeftOpenIcon className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {notesOpen ? "Hide notes panel" : "Show notes panel"}
            </TooltipContent>
          </Tooltip>

          {!selectedEntry && categoryParentPath && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm"
                  onClick={() => openCategoryPath(categoryParentPath, "back")} aria-label="Go back"
                >
                  <ChevronLeftIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Go back</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Center: breadcrumb or folder name */}
        <div className="min-w-0 flex-1 overflow-hidden px-1">
          {selectedEntry ? (
            (() => {
              const isFolderIndexEntry = normalizeEntryLookup(selectedEntry.id.split("/").pop() || "") === "index"
              const breadcrumbSegments = getBreadcrumbSegments(selectedEntry)
              const selectedEntryDisplayTitle = isFolderIndexEntry
                ? getCategoryDisplayLabel(getEntryCategoryPath(selectedEntry))
                : selectedEntry.title

              return (
                <Breadcrumb className="min-w-0 overflow-hidden">
                  <BreadcrumbList
                    className="min-w-0 flex-nowrap overflow-hidden whitespace-nowrap"
                    style={{ flexWrap: "nowrap" }}
                  >
                    {breadcrumbSegments.map((segment, index) => {
                      const isLastSegment = index === breadcrumbSegments.length - 1
                      const shouldOpenIndexDocument = isFolderIndexEntry && isLastSegment

                      return (
                      <React.Fragment key={segment.path}>
                        <BreadcrumbItem className="shrink-0">
                          <BreadcrumbLink asChild>
                            <button type="button"
                              className="max-w-40 cursor-pointer truncate capitalize text-muted-foreground"
                                onClick={() => {
                                  if (shouldOpenIndexDocument) {
                                    openInternalDocument(selectedEntry.id)
                                    return
                                  }
                                  openCategoryPath(segment.path)
                                }}
                            >
                              {segment.label}
                            </button>
                          </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator className="shrink-0" />
                      </React.Fragment>
                      )
                    })}
                    {!isFolderIndexEntry && (
                      <BreadcrumbItem className="min-w-0 flex-1 overflow-hidden">
                        <BreadcrumbPage className="block truncate">{selectedEntryDisplayTitle}</BreadcrumbPage>
                      </BreadcrumbItem>
                    )}
                  </BreadcrumbList>
                </Breadcrumb>
              )
            })()
          ) : (
            (() => {
              const currentPath = normalizeEntryLookup(activeCategoryPath || activeFolder)
              const pathSegments = currentPath && currentPath !== "root"
                ? decodeURIComponent(currentPath).split("/").filter(Boolean)
                : []

              if (pathSegments.length === 0) {
                return (
                  <span className="block truncate text-sm font-medium text-foreground">
                    Files
                  </span>
                )
              }

              return (
                <Breadcrumb className="min-w-0 overflow-hidden">
                  <BreadcrumbList
                    className="min-w-0 flex-nowrap overflow-hidden whitespace-nowrap"
                    style={{ flexWrap: "nowrap" }}
                  >
                    {pathSegments.map((segment, index) => {
                      const segmentPath = pathSegments.slice(0, index + 1).join("/")
                      const isLastSegment = index === pathSegments.length - 1

                      return (
                        <React.Fragment key={segmentPath}>
                          <BreadcrumbItem className="shrink-0">
                            {isLastSegment ? (
                              <BreadcrumbPage className="block truncate capitalize">{segment}</BreadcrumbPage>
                            ) : (
                              <BreadcrumbLink asChild>
                                <button
                                  type="button"
                                  className="max-w-40 cursor-pointer truncate capitalize text-muted-foreground"
                                  onClick={() => openCategoryPath(segmentPath)}
                                >
                                  {segment}
                                </button>
                              </BreadcrumbLink>
                            )}
                          </BreadcrumbItem>
                          {!isLastSegment && <BreadcrumbSeparator className="shrink-0" />}
                        </React.Fragment>
                      )
                    })}
                  </BreadcrumbList>
                </Breadcrumb>
              )
            })()
          )}
        </div>

        {/* Right: document actions or sort */}
        <div className="flex shrink-0 items-center gap-0.5">
          {selectedEntry ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm"
                    onClick={() => setRendered((v) => !v)}
                    aria-label={rendered ? "Show raw markdown" : "Show rendered markdown"}
                  >
                    {rendered ? <Code2Icon className="size-4" /> : <BookOpenIcon className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {rendered ? "Show raw markdown" : "Show rendered markdown"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm"
                    onClick={() => setPropertiesOpen((v) => !v)}
                    aria-label={propertiesOpen ? "Hide properties" : "Show properties"}
                  >
                    {propertiesOpen
                      ? <PanelRightCloseIcon className="size-4" />
                      : <PanelRightOpenIcon className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {propertiesOpen ? "Hide properties" : "Show properties"}
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Sort notes">
                      {sortMode === "date-desc" && <CalendarArrowDownIcon className="size-4" />}
                      {sortMode === "date-asc" && <CalendarArrowUpIcon className="size-4" />}
                      {sortMode === "title-asc" && <ArrowDownAZIcon className="size-4" />}
                      {sortMode === "title-desc" && <ArrowUpAZIcon className="size-4" />}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Sort notes</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortMode("date-desc")}>Newest first</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortMode("date-asc")}>Oldest first</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortMode("title-asc")}>Title A–Z</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortMode("title-desc")}>Title Z–A</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {/* ── Content row — vertical borders live only here ─────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Icon nav */}
        <nav className="sidebar-ui-region hidden h-full min-h-0 w-12.25 shrink-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground md:flex">
          <SidebarContent className="min-h-0">
            <SidebarGroup>
              <SidebarGroupContent className="px-1.5 md:px-0">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={{ children: "Files", hidden: false }}
                      onClick={() => handleFolderSidebarClick("root")}
                      isActive={normalizeEntryLookup(activeFolder) === "root"}
                      className="justify-center px-2.5 md:px-2"
                      aria-label="Files"
                    >
                      <FolderIcon />
                      <span className="sr-only">Files</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <div className="shrink-0 border-t bg-sidebar">
            <SidebarMenu>
              <SidebarMenuItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton onClick={() => void openPreferences()}
                      className="justify-center px-2.5 md:px-2" aria-label="Open preferences"
                    >
                      <Settings2Icon />
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent side="right">Preferences</TooltipContent>
                </Tooltip>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton onClick={toggleTheme}
                      className="justify-center px-2.5 md:px-2"
                      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    >
                      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                  </TooltipContent>
                </Tooltip>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </nav>

        {/* Notes list panel — consistent push mechanism */}
        <div
          className={`sidebar-ui-region hidden h-full min-h-0 border-r bg-sidebar text-sidebar-foreground transition-[width,opacity] duration-200 ease-linear md:flex md:flex-col ${
            notesOpen
              ? "w-88 opacity-100"
              : "w-0 overflow-hidden border-r-0 opacity-0 pointer-events-none"
          }`}
          aria-hidden={!notesOpen}
        >
          <div className="shrink-0 border-b border-sidebar-border p-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <SidebarInput
                ref={searchInputRef}
                placeholder="Search by title, author, or content..."
                value={query}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                className="pl-9 pr-10"
              />
              {query.trim() && (
                <button type="button" aria-label="Clear search"
                  className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={restoreSearchSession}
                >
                  <XIcon className="size-4" />
                </button>
              )}
            </div>
          </div>

          <SidebarContent className="min-h-0">
            <SidebarGroup className="px-0">
              <SidebarGroupContent>
                {!query.trim() && (
                  <div className="border-b border-sidebar-border px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Location:</span>{" "}
                    <span className="truncate">{activeFolder === "root" ? "Files" : activeFolder}</span>
                  </div>
                )}
                {shouldRenderCategoryCarousel ? (
                  <div className="relative overflow-hidden">
                    <div
                      className="flex w-[200%] will-change-transform"
                      style={{
                        transform: `translateX(${categoryTrackOffset}%)`,
                        transition: categoryTrackAnimated
                          ? `transform ${CATEGORY_CAROUSEL_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
                          : "none",
                      }}
                    >
                      {categoryTransitionDirection === "back" ? (
                        <>
                          <div className="w-1/2 shrink-0">
                            <SidebarMenu className="gap-0 px-2">{renderSidebarItemList(visibleSidebarItems)}</SidebarMenu>
                          </div>
                          <div className="w-1/2 shrink-0">
                            <SidebarMenu className="gap-0 px-2">{renderSidebarItemList(outgoingSidebarItems ?? [])}</SidebarMenu>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-1/2 shrink-0">
                            <SidebarMenu className="gap-0 px-2">{renderSidebarItemList(outgoingSidebarItems ?? [])}</SidebarMenu>
                          </div>
                          <div className="w-1/2 shrink-0">
                            <SidebarMenu className="gap-0 px-2">{renderSidebarItemList(visibleSidebarItems)}</SidebarMenu>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <SidebarMenu className="gap-0 px-2">{renderSidebarItemList(visibleSidebarItems)}</SidebarMenu>
                )}

                {(query.trim() ? searchResults.length === 0 : visibleItems.length === 0) && (
                  <div className="p-4 text-sm text-muted-foreground">
                    {query.trim() ? "No search results found." : "No entries match this filter."}
                  </div>
                )}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </div>

        {/* Document viewer + properties panel */}
        <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
          {selectedEntry ? (
            <>
              <article ref={articleRef}
                className="gpu-text-layer relative min-h-0 flex-1 min-w-0 overflow-auto overflow-x-hidden"
              >
                {rendered ? (
                  <div onClick={handleMarkdownClick}
                    className="markdown-body gpu-text-surface min-w-0 overflow-x-hidden px-6 py-5"
                    data-theme={theme}
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdownToHtml(
                        selectedEntry.content, selectedEntry.sourceFilePath, selectedEntry.vaultRootPath,
                      ),
                    }}
                  />
                ) : (
                  <pre className="raw-markdown gpu-text-surface min-w-0 overflow-auto px-6 py-5 text-xs whitespace-pre-wrap wrap-break-word font-mono">
                    <code className="hljs language-markdown block whitespace-pre-wrap wrap-break-word"
                      dangerouslySetInnerHTML={{ __html: renderRawMarkdownHighlighted(selectedEntry.content) }}
                    />
                  </pre>
                )}
              </article>

              <DocumentPropertiesPanel
                entry={selectedEntry}
                isOpen={propertiesOpen}
                onInternalDocLink={openInternalDocument}
                onCopyInternalLink={handleCopyInternalLink}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <FileIcon className="size-5" />
                </div>
                <h2 className="text-base font-medium text-foreground">
                  {runtimeEntries.length === 0 ? "No vault selected" : "No note selected"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {runtimeEntries.length === 0
                    ? "Choose a vault folder to load your markdown notes."
                    : "Select a note from the sidebar to preview its content and properties."}
                </p>
                {runtimeEntries.length === 0 && (
                  <Button variant="default" size="sm" onClick={() => void openPreferences()}>
                    Open preferences
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

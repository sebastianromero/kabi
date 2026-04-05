"use client"

import * as React from "react"

import type { KbSidebarEntry } from "@/lib/kb-types"
import {
  formatHumanDate,
  formatPropertyValue,
  humanizeKey,
  inferLinkHref,
  isExternalHref,
  extractDocFromHref,
} from "@/lib/kb-utils"

// ─── PropertiesContent ────────────────────────────────────────────────────────
// Renders the metadata list for a single entry. Used in both the sidebar panel
// and the standalone properties drawer.

export function PropertiesContent({
  entry,
  onInternalDocLink,
  onCopyInternalLink,
}: {
  entry: KbSidebarEntry
  onInternalDocLink?: (docPath: string) => void
  onCopyInternalLink?: (entry: KbSidebarEntry) => void
}) {
  const wikiLink = `[[${entry.id}|${entry.title}]]`
  const properties = entry.properties?.length
    ? entry.properties
    : [
        { key: "id", value: entry.id },
        { key: "folder", value: entry.folder },
      ]

  return (
    <dl className="space-y-3">
      <div className="rounded-md border bg-background px-3 py-3">
        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Title</dt>
        <dd className="mt-2 text-lg font-semibold text-foreground wrap-break-word">
          {entry.title}
        </dd>
        <div className="mt-2 text-xs text-muted-foreground">
          {entry.author || "Unknown author"} · {formatHumanDate(entry.date)}
        </div>
      </div>

      <div className="rounded-md border bg-background px-3 py-2">
        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Internal Link
        </dt>
        <dd className="mt-1 text-xs whitespace-pre-wrap wrap-break-word text-foreground">
          <button
            type="button"
            className="cursor-pointer text-left underline underline-offset-2 hover:opacity-85"
            onClick={() => onCopyInternalLink?.(entry)}
          >
            {wikiLink}
          </button>
        </dd>
      </div>

      {properties.map((property) => {
        const formatted = formatPropertyValue(property.key, property.value)
        const href = inferLinkHref(formatted, entry.sourceFilePath, entry.vaultRootPath)
        return (
          <div key={property.key} className="rounded-md border bg-background px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {humanizeKey(property.key)}
            </dt>
            {href ? (
              <dd className="mt-1 text-xs whitespace-pre-wrap wrap-break-word text-foreground">
                <a
                  href={href}
                  target={isExternalHref(href) ? "_blank" : undefined}
                  rel={isExternalHref(href) ? "noopener noreferrer" : undefined}
                  onClick={(event) => {
                    const docPath = extractDocFromHref(href)
                    if (!docPath || !onInternalDocLink) return
                    event.preventDefault()
                    onInternalDocLink(docPath)
                  }}
                  className="underline underline-offset-2 hover:opacity-85"
                >
                  {formatted}
                </a>
              </dd>
            ) : (
              <dd className="mt-1 text-xs whitespace-pre-wrap wrap-break-word text-foreground">
                {formatted}
              </dd>
            )}
          </div>
        )
      })}
    </dl>
  )
}

// ─── DocumentPropertiesPanel ──────────────────────────────────────────────────
// Collapsible aside panel that slides in from the right. Shown at any viewport
// width when propertiesOpen is true.

export function DocumentPropertiesPanel({
  entry,
  isOpen,
  onInternalDocLink,
  onCopyInternalLink,
}: {
  entry: KbSidebarEntry
  isOpen: boolean
  onInternalDocLink: (docPath: string) => void
  onCopyInternalLink: (entry: KbSidebarEntry) => void
}) {
  return (
    <aside
      className={`h-full shrink-0 border-l border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,opacity] duration-200 ease-linear flex flex-col ${
        isOpen ? "w-80 opacity-100" : "w-0 overflow-hidden border-l-0 opacity-0"
      }`}
      aria-hidden={!isOpen}
    >
      <div className="border-b border-sidebar-border bg-sidebar px-4 py-3 shrink-0">
        <h2 className="text-sm font-semibold">Document Properties</h2>
        <p className="mt-1 text-xs text-muted-foreground">Metadata and quick stats</p>
      </div>
      <div className="properties-selectable min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <PropertiesContent
          entry={entry}
          onInternalDocLink={onInternalDocLink}
          onCopyInternalLink={onCopyInternalLink}
        />
      </div>
    </aside>
  )
}

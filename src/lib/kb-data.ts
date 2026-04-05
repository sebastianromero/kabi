import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import matter from "gray-matter"

import type { KbEntryProperty, KbSidebarEntry } from "@/lib/kb-types"

async function* walkMarkdownFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(fullPath)
      continue
    }

    if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
      yield fullPath
    }
  }
}

function toEntryId(filePath: string, vaultRootPath: string): string {
  const relativePath = relative(vaultRootPath, filePath).replace(/\\/g, "/")
  const withoutExtension = relativePath.replace(/\.mdx?$/i, "")
  return withoutExtension
}

function normalizePreview(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim()
  if (collapsed.length <= 180) return collapsed
  return `${collapsed.slice(0, 180)}...`
}

function normalizeAuthor(author: unknown): string {
  if (typeof author === "string" && author.trim()) return author

  if (Array.isArray(author)) {
    const values = author.filter((value): value is string => typeof value === "string")
    if (values.length) return values.join(", ")
  }

  if (author && typeof author === "object" && "name" in author) {
    const name = (author as { name?: unknown }).name
    if (typeof name === "string" && name.trim()) return name
  }

  return "Unknown author"
}

function normalizePropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "-"
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string") return value || "-"
  if (typeof value === "number" || typeof value === "boolean") return String(value)

  if (Array.isArray(value)) {
    return value.map((item) => normalizePropertyValue(item)).join(", ") || "-"
  }

  try {
    const serialized = JSON.stringify(value)
    return serialized.length > 280 ? `${serialized.slice(0, 280)}...` : serialized
  } catch {
    return "[unserializable]"
  }
}

function buildProperties(
  id: string,
  folder: string,
  body: string,
  data: Record<string, unknown>
): KbEntryProperty[] {
  const properties: KbEntryProperty[] = [
    { key: "id", value: id },
    { key: "folder", value: folder },
    { key: "word_count", value: String((body.match(/\S+/g) ?? []).length) },
    { key: "char_count", value: String(body.length) },
  ]

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_")) continue
    properties.push({ key, value: normalizePropertyValue(value) })
  }

  return properties
}

export async function loadKbEntries(vaultRootPath: string): Promise<KbSidebarEntry[]> {
  const entries: KbSidebarEntry[] = []

  for await (const filePath of walkMarkdownFiles(vaultRootPath)) {
    const raw = await readFile(filePath, "utf-8")
    const { data, content } = matter(raw)
    const id = toEntryId(filePath, vaultRootPath)
    const folder = id.includes("/") ? id.split("/")[0] : "root"
    const primaryDate = data.updatedDate ?? data.pubDate

    entries.push({
      id,
      folder,
      title: typeof data.title === "string" && data.title.trim() ? data.title : id,
      author: normalizeAuthor(data.author),
      date: primaryDate instanceof Date ? primaryDate.toISOString() : primaryDate ? new Date(primaryDate as string).toISOString() : "",
      sourceFilePath: filePath,
      vaultRootPath,
      preview: normalizePreview(content),
      content,
      properties: buildProperties(id, folder, content, data),
    })
  }

  return entries.sort((left, right) => left.title.localeCompare(right.title))
}
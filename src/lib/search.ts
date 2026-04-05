import MiniSearch from "minisearch"

export type SearchDocument = {
  id: string
  title: string
  author: string
  folder: string
  date: string
  previewText: string
  contentText: string
}

export type SearchSourceEntry = {
  id: string
  title: string
  author: string
  folder: string
  date: string
  preview: string
  content: string
}

export const searchIndexOptions = {
  fields: ["title", "author", "previewText", "contentText"],
  storeFields: ["id", "title", "author", "folder", "date", "previewText", "contentText"],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    boost: {
      title: 5,
      author: 2,
      previewText: 2,
      contentText: 1,
    },
  },
} satisfies ConstructorParameters<typeof MiniSearch<SearchDocument>>[0]

export type SerializedSearchIndex = ReturnType<MiniSearch<SearchDocument>["toJSON"]>

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => {
      return alias || target
    })
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#-]+/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function buildSearchDocuments(entries: SearchSourceEntry[]): SearchDocument[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    author: entry.author || "",
    folder: entry.folder,
    date: entry.date,
    previewText: markdownToPlainText(entry.preview),
    contentText: markdownToPlainText(entry.content),
  }))
}

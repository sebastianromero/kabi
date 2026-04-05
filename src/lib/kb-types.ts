export type KbEntryProperty = {
  key: string
  value: string
}

export type KbSidebarEntry = {
  id: string
  folder: string
  title: string
  author: string
  date: string
  sourceFilePath: string
  vaultRootPath: string
  preview: string
  content: string
  properties: KbEntryProperty[]
}
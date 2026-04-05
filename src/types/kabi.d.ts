export {}

import type { KbSidebarEntry } from "@/lib/kb-types"

declare global {
  interface Window {
    kabi?: {
      version: string
      selectVault: () => Promise<boolean>
      getVaultPath: () => Promise<string>
      getEntries: () => Promise<KbSidebarEntry[]>
      openPreferencesWindow: () => Promise<void>
      showFolderContextMenu: () => Promise<"open" | null>
      onEntriesChanged: (callback: () => void) => () => void
      onVaultChanged: (callback: (vaultPath: string) => void) => () => void
    }
  }
}

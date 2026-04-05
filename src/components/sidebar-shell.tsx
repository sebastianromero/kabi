import * as React from "react"

import { AppSidebar } from "@/components/app-sidebar"
import type { KbSidebarEntry } from "@/lib/kb-types"
import type { SerializedSearchIndex } from "@/lib/search"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "sonner"

export function SidebarShell({
  entries,
  searchIndexJson: _searchIndexJson,
}: {
  entries: KbSidebarEntry[]
  searchIndexJson: SerializedSearchIndex
}) {
  return (
    <SidebarProvider className="h-full min-h-0 overflow-hidden">
      <TooltipProvider>
        <Toaster richColors position="bottom-right" closeButton />
        <AppSidebar entries={entries} />
      </TooltipProvider>
    </SidebarProvider>
  )
}

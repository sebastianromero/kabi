import * as React from "react"

import { Button } from "@/components/ui/button"

type PreferencesDialogProps = {
  open: boolean
  vaultPath: string
  isSelectingVault: boolean
  onClose: () => void
  onChooseFolder: () => void
}

export function PreferencesDialog({
  open,
  vaultPath,
  isSelectingVault,
  onClose,
  onChooseFolder,
}: PreferencesDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-background shadow-2xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Preferences</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose the vault folder for this workspace.</p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current vault</p>
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm break-all">
              {vaultPath || "No folder selected"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onChooseFolder} disabled={isSelectingVault}>
            {isSelectingVault ? "Opening..." : "Choose folder"}
          </Button>
        </div>
      </div>
    </div>
  )
}

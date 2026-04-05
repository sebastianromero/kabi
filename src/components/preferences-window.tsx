import * as React from "react"
import {
  CheckIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  Settings2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

type StatusTone = "idle" | "success" | "error"

export function PreferencesWindow() {
  const [vaultPath, setVaultPath] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSelectingVault, setIsSelectingVault] = React.useState(false)
  const [statusMessage, setStatusMessage] = React.useState("")
  const [statusTone, setStatusTone] = React.useState<StatusTone>("idle")

  const refreshVaultPath = React.useCallback(async () => {
    if (!window.kabi?.getVaultPath) {
      setVaultPath("")
      setIsLoading(false)
      return
    }

    try {
      const currentVaultPath = await window.kabi.getVaultPath()
      setVaultPath(currentVaultPath)
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshVaultPath()

    const dispose = window.kabi?.onVaultChanged?.((nextVaultPath) => {
      setVaultPath(nextVaultPath)
      setStatusMessage("Vault updated.")
      setStatusTone("success")
      setIsLoading(false)
    })

    return () => dispose?.()
  }, [refreshVaultPath])

  const handleChooseFolder = React.useCallback(async () => {
    if (!window.kabi?.selectVault) return

    setIsSelectingVault(true)
    setStatusMessage("Opening folder picker...")
    setStatusTone("idle")

    try {
      const selected = await window.kabi.selectVault()
      if (!selected) {
        setStatusMessage("Folder selection canceled.")
        setStatusTone("idle")
        return
      }

      await refreshVaultPath()
      setStatusMessage("Vault updated.")
      setStatusTone("success")
    } catch {
      setStatusMessage("Could not update vault.")
      setStatusTone("error")
    } finally {
      setIsSelectingVault(false)
    }
  }, [refreshVaultPath])

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-muted/25">
        <div className="px-3 py-4">
          <Button
            type="button"
            variant="default"
            className="h-auto w-full justify-start gap-3 rounded-2xl px-3 py-2.5 text-left"
            aria-current="page"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/18">
              <Settings2Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">General</div>
              <div className="truncate text-xs text-primary-foreground/80">Vault and local data</div>
            </div>
            <ChevronRightIcon className="size-4 opacity-70" />
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="px-7 pb-4 pt-6">
          <h1 className="text-[1.85rem] font-semibold tracking-tight">General</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the vault folder used by Kabi for local markdown notes.
          </p>
        </header>

        <div className="px-7 pb-7">
          <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Vault folder</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Kabi reads this folder to build your local note library.
                </p>
              </div>
              <div className="rounded-full border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Local only
              </div>
            </div>

            <Separator />

            <div className="space-y-4 px-5 py-4">
              <div className="space-y-2">
                <Label htmlFor="vault-path" className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Current vault
                </Label>
                <div className="flex items-center gap-3">
                  <div className="relative min-w-0 flex-1">
                    <FolderOpenIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="vault-path"
                      readOnly
                      value={isLoading ? "Loading vault path..." : vaultPath || "No folder selected"}
                      className="h-11 rounded-2xl border-border/70 bg-muted/20 pl-9 font-mono text-xs shadow-none"
                    />
                  </div>
                  <Button
                    onClick={handleChooseFolder}
                    disabled={isSelectingVault}
                    className="h-11 rounded-2xl bg-[#0a84ff] px-5 text-white hover:bg-[#0077ed] dark:bg-[#0a84ff] dark:hover:bg-[#2997ff]"
                  >
                    {isSelectingVault ? (
                      <>
                        <LoaderCircleIcon className="size-4 animate-spin" />
                        Opening...
                      </>
                    ) : (
                      <>
                        <FolderOpenIcon className="size-4" />
                        Choose folder
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="flex min-h-5 items-center gap-2 text-sm">
                {statusTone === "success" && <CheckIcon className="size-4 text-primary" />}
                <p
                  className={
                    statusTone === "error"
                      ? "text-destructive"
                      : statusTone === "success"
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }
                >
                  {statusMessage || "Your notes stay on disk. Kabi only reads from the selected folder."}
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
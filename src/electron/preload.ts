import { contextBridge, ipcRenderer } from 'electron';
import type { KbSidebarEntry } from '@/lib/kb-types';

contextBridge.exposeInMainWorld('kabi', {
  version: process.versions.electron,
  selectVault: () => ipcRenderer.invoke('kabi:select-vault') as Promise<boolean>,
  getVaultPath: () => ipcRenderer.invoke('kabi:get-vault-path') as Promise<string>,
  getEntries: () => ipcRenderer.invoke('kabi:get-entries') as Promise<KbSidebarEntry[]>,
  openPreferencesWindow: () => ipcRenderer.invoke('kabi:open-preferences-window') as Promise<void>,
  showFolderContextMenu: () =>
    ipcRenderer.invoke('kabi:show-folder-context-menu') as Promise<'open' | null>,
  onEntriesChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('kabi:entries-changed', listener);
    return () => ipcRenderer.removeListener('kabi:entries-changed', listener);
  },
  onVaultChanged: (callback: (vaultPath: string) => void) => {
    const listener = (_event: unknown, vaultPath: string) => callback(vaultPath);
    ipcRenderer.on('kabi:vault-changed', listener);
    return () => ipcRenderer.removeListener('kabi:vault-changed', listener);
  },
});

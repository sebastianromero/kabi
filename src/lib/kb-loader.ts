/**
 * Custom Astro content loader for the Obsidian kb vault.
 * Reads .md files directly with gray-matter, bypassing Astro's Vite
 * markdown pipeline (and vite-plugin-content-assets) so that relative
 * image references inside the notes don't cause build errors.
 */
import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import type { Loader } from 'astro/loaders';

function getKbRoot(): string {
  return process.env.KB_ROOT?.trim() || join(process.cwd(), 'kb');
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function* walkMd(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMd(full);
    } else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) {
      yield full;
    }
  }
}

function toEntryId(filePath: string, kbRoot: string): string {
  const relativePath = relative(kbRoot, filePath).replace(/\\/g, '/');
  const withoutExtension = relativePath.replace(/\.mdx?$/i, '');
  return withoutExtension;
}

export function kbLoader(): Loader {
  return {
    name: 'kb-loader',
    async load({ store, logger }) {
      const kbRoot = getKbRoot();
      store.clear();

      if (!(await directoryExists(kbRoot))) {
        logger.warn(`kb-loader: directory not found at ${kbRoot}; loading empty collection`);
        return;
      }

      let count = 0;
      for await (const filePath of walkMd(kbRoot)) {
        try {
          const raw = await readFile(filePath, 'utf-8');
          const { data, content } = matter(raw);
          const id = toEntryId(filePath, kbRoot);
          store.set({
            id,
            data: {
              ...data,
              _sourceFilePath: filePath,
              _vaultRootPath: kbRoot,
            },
            body: content,
          });
          count++;
        } catch (err) {
          logger.warn(`kb-loader: skipping ${filePath}: ${err}`);
        }
      }
      logger.info(`kb-loader: loaded ${count} entries`);
    },
  };
}

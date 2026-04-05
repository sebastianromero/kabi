// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from "@tailwindcss/vite";
import react from '@astrojs/react';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const kbRoot = process.env.KB_ROOT?.trim() || path.join(projectRoot, 'kb');

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    server: {
      fs: {
        allow: [projectRoot, kbRoot],
      },
    },
  },

  integrations: [react()],
});
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { kbLoader } from './lib/kb-loader';

const kb = defineCollection({
  loader: kbLoader(),
  schema: z.object({
    title: z.string(),
    author: z.any().optional(),
    description: z.any().optional(),
    pubDate: z.coerce.date().optional(),
    updatedDate: z.coerce.date().optional(),
    _sourceFilePath: z.string().optional(),
    _vaultRootPath: z.string().optional(),
  }),
});

export const collections = { kb };
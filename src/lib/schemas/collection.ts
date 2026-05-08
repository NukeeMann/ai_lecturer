import { z } from 'zod';

export const CollectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  courseSlugs: z.array(z.string().min(1)),
});

export type Collection = z.infer<typeof CollectionSchema>;

export const CollectionsFileSchema = z.object({
  collections: z.array(CollectionSchema),
});

export type CollectionsFile = z.infer<typeof CollectionsFileSchema>;

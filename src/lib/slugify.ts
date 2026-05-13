// US-180 — client-safe slugify util for the Extend wizard's direct-add flow.
// The existing src/lib/server/paths.ts slugify imports node:path, so it can't
// be used in client components. This is a smaller, browser-friendly version
// with the same shape: lowercase, replace non-alphanumerics with `-`,
// collapse repeats, trim leading/trailing dashes.
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

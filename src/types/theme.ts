import { z } from "zod";

export const ColorRule = z.object({
  match: z.object({
    wiki: z.string().optional(),
    type: z.string().optional(),
    tag: z.string().optional(),
    status: z.string().optional(),
    idGlob: z.string().optional(),
  }),
  color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
});
export type ColorRule = z.infer<typeof ColorRule>;

export const Theme = z.object({
  name: z.string().min(1),
  palette: z.string().default("default"),
  defaultBy: z.enum(["wiki", "type"]).default("wiki"),
  rules: z.array(ColorRule).default([]),
  perWiki: z.record(z.string(), z.array(ColorRule)).default({}),
});
export type Theme = z.infer<typeof Theme>;

export const ThemesFile = z.object({
  themes: z.array(Theme).default([]),
  active: z.string().optional(),
});
export type ThemesFile = z.infer<typeof ThemesFile>;

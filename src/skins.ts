/** Shell finishes. The three "Common" skins from the catalog ship built in. */
export interface Skin {
  color: string;
  roughness: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Soft-touch edge highlight. */
  sheen?: number;
  sheenColor?: string;
  /** Strength of the fine surface grain, 0…1. */
  grain?: number;
}

export const SKINS = {
  'deep-teal': { color: '#14666d', roughness: 0.6, sheen: 0.3, sheenColor: '#4fb5b3', grain: 1 },
  porcelain: { color: '#f1ebe1', roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.22, grain: 0 },
  graphite: { color: '#34383e', roughness: 0.68, sheen: 0.25, sheenColor: '#8b95a3', grain: 0.8 },
} satisfies Record<string, Skin>;

export type SkinName = keyof typeof SKINS;

export const EYE_COLORS = {
  'warm-white': '#fff1dc',
  'ice-blue': '#a8dcff',
  amber: '#ffc56e',
} as const;

export type EyeColorName = keyof typeof EYE_COLORS;

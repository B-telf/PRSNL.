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
  /** Edge glow that makes the shell read as soft and slightly translucent. */
  rim?: string;
}

export const SKINS = {
  'deep-teal': {
    color: '#0f6f78', roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.27,
    sheen: 0.45, sheenColor: '#58cfc9', grain: 0.5, rim: '#2fb9b4',
  },
  porcelain: {
    color: '#f3ede3', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, grain: 0, rim: '#fff3e2',
  },
  graphite: {
    color: '#2f333a', roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3,
    sheen: 0.35, sheenColor: '#9aa6b8', grain: 0.6, rim: '#6f7c8f',
  },
} satisfies Record<string, Skin>;

export type SkinName = keyof typeof SKINS;

export const EYE_COLORS = {
  'warm-white': '#fff1dc',
  'ice-blue': '#a8dcff',
  amber: '#ffc56e',
} as const;

export type EyeColorName = keyof typeof EYE_COLORS;

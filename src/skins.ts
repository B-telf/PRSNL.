/** Body materials. Each keeps the same silhouette; only the substance changes. */
export interface Skin {
  /** Surface colour. */
  color: string;
  /** Light that seems to come from inside the body. */
  inner: string;
  /** How strongly the body glows from within, 0…1. */
  innerStrength: number;
  /** Glow along the silhouette. */
  rim: string;
  /** Colour of the chest light. */
  core: string;
  roughness: number;
}

export const SKINS = {
  /** Frosted, translucent and softly luminous. */
  pearl: { color: '#dfe1ee', inner: '#b9c2ff', innerStrength: 0.26, rim: '#ffffff', core: '#dff4ff', roughness: 0.36 },
  /** Graphite with a cool inner light. */
  smoke: { color: '#4d5058', inner: '#7f93b8', innerStrength: 0.22, rim: '#c6d4ee', core: '#bfe3ff', roughness: 0.42 },
  /** Pale blue glass with restrained cyan highlights. */
  glacier: { color: '#c3deef', inner: '#7fc8f5', innerStrength: 0.24, rim: '#e6fbff', core: '#c9f6ff', roughness: 0.26 },
  /** Warm ivory with an amber centre. */
  ember: { color: '#efe7d8', inner: '#ffb060', innerStrength: 0.17, rim: '#fff3df', core: '#ffc978', roughness: 0.36 },
} satisfies Record<string, Skin>;

export type SkinName = keyof typeof SKINS;

export const EYE_COLORS = {
  onyx: '#16171c',
  ice: '#2d86c4',
  amber: '#c27a16',
} as const;

export type EyeColorName = keyof typeof EYE_COLORS;

/** Upper layers. `null` is the pure form. */
export const OUTFITS = {
  none: null,
  ink: { kind: 'tee', color: '#2b2b30' },
  ocean: { kind: 'tee', color: '#2f4d80' },
  moss: { kind: 'vest', color: '#5f6e44' },
} as const;

export type OutfitName = keyof typeof OUTFITS;

export const CHAINS = {
  none: null,
  silver: { color: '#d9dde3' },
  gold: { color: '#e6b655' },
} as const;

export type ChainName = keyof typeof CHAINS;

/**
 * Growth stages. "Light" is cumulative and decided by the host app's trusted
 * rules; Loop only renders the stage it is told.
 */
export const SOULFORMS = [
  { name: 'Quiet spark', from: 0, core: 0.75, rim: 0.85, trail: 0, orbit: false },
  { name: 'Finding rhythm', from: 30, core: 1, rim: 1, trail: 0.5, orbit: false },
  { name: 'Inner light', from: 90, core: 1.25, rim: 1.1, trail: 0.7, orbit: true },
  { name: 'Resonance', from: 180, core: 1.45, rim: 1.4, trail: 1, orbit: true },
] as const;

export function soulformFor(light: number): number {
  let stage = 0;
  SOULFORMS.forEach((s, i) => {
    if (light >= s.from) stage = i;
  });
  return stage;
}

// ============================================================================
// treelet.js - Measurement formatting
// ============================================================================

const thin = ' ';

function group(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, thin);
}

/** 850 m, 2.41 km, 12.4 km, 156 km. */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '–';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(2) : km < 100 ? km.toFixed(1) : group(km)} km`;
}

/** 850 m², 2.4 ha, 3.21 km². */
export function formatArea(m2: number): string {
  if (!Number.isFinite(m2)) return '–';
  if (m2 < 10_000) return `${group(m2)} m²`;
  if (m2 < 1_000_000) return `${(m2 / 10_000).toFixed(m2 < 100_000 ? 2 : 1)} ha`;
  const km2 = m2 / 1_000_000;
  return `${km2 < 10 ? km2.toFixed(2) : km2 < 100 ? km2.toFixed(1) : group(km2)} km²`;
}

/** 1 234 m. */
export function formatElevation(m: number | null): string {
  return m === null || !Number.isFinite(m) ? '–' : `${group(m)} m`;
}

import {
  ApplianceCounts,
  ApplianceId,
  ApplianceLoadingUnitSpec,
  DesignStandard,
} from '../types/hydraulics';

export const APPLIANCE_LOADING_UNITS: ApplianceLoadingUnitSpec[] = [
  { id: 'washbasin', name: 'Washbasin', bs6700Lu: 1.5, bsEn806Lu: 1 },
  { id: 'bidet', name: 'Bidet', bs6700Lu: 1.5, bsEn806Lu: 1 },
  { id: 'wc_cistern', name: 'WC-cistern', bs6700Lu: 2, bsEn806Lu: 1 },
  { id: 'shower_head', name: 'Shower head', bs6700Lu: 3, bsEn806Lu: 2 },
  { id: 'domestic_sink', name: 'Domestic sink', bs6700Lu: 3, bsEn806Lu: 2 },
  { id: 'washing_machine', name: 'Washing machine', bs6700Lu: 3, bsEn806Lu: 2 },
  { id: 'domestic_bath', name: 'Domestic bath', bs6700Lu: 10, bsEn806Lu: 4 },
  { id: 'taps_garden_garage', name: 'Taps/ garden/ garage', bs6700Lu: 10, bsEn806Lu: 5 },
  { id: 'urinal_flush_valve', name: 'Urinal-flush valve', bs6700Lu: 5, bsEn806Lu: 3 },
  { id: 'non_domestic_sink', name: 'Non domestic sink', bs6700Lu: 5, bsEn806Lu: 8 },
  { id: 'non_domestic_bath', name: 'Non domestic bath', bs6700Lu: 22, bsEn806Lu: 8 },
  { id: 'wc_flush_valve', name: 'WC-flush valve', bs6700Lu: 95, bsEn806Lu: 15 },
];

export const VALID_APPLIANCE_IDS = new Set<ApplianceId>(
  APPLIANCE_LOADING_UNITS.map((a) => a.id)
);

export function getStandardLabel(standard?: DesignStandard): string {
  return standard === DesignStandard.BS_EN_806_3 ? 'BS EN 806-3' : 'BS 6700';
}

export function getApplianceLu(
  appliance: ApplianceLoadingUnitSpec,
  standard?: DesignStandard
): number {
  return standard === DesignStandard.BS_EN_806_3
    ? appliance.bsEn806Lu
    : appliance.bs6700Lu;
}

export function calculateTotalLuFromAppliances(
  counts: ApplianceCounts | undefined,
  standard?: DesignStandard
): number {
  if (!counts) return 0;
  let total = 0;
  for (const app of APPLIANCE_LOADING_UNITS) {
    const qty = Number(counts[app.id] ?? 0);
    if (Number.isFinite(qty) && qty > 0) {
      total += qty * getApplianceLu(app, standard);
    }
  }
  return Math.round(total * 100) / 100;
}

export function normalizeApplianceCounts(
  counts: ApplianceCounts | undefined
): ApplianceCounts | undefined {
  if (!counts) return undefined;
  const cleaned: ApplianceCounts = {};
  for (const app of APPLIANCE_LOADING_UNITS) {
    const raw = Number(counts[app.id] ?? 0);
    if (Number.isFinite(raw) && raw > 0) {
      cleaned[app.id] = Math.round(raw * 100) / 100;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

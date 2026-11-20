import {
  FloorInputRow,
  PipeSpecId,
  PipeSpecificationTable,
  ZoningStrategy,
  DesignParameters,
} from '../types/hydraulics';
import { CASE_STUDY_1_DATA, CASE_STUDY_2_DATA } from './caseStudies';

/**
 * Exact Pipe Specification Lookup Tables mapped strictly from the engineering reference charts:
 * - PP-R: PN16 (S3.2) and PN20 (S2.5)
 * - uPVC: Class E and Class 7
 * - HDPE PE100: PN12.5 and PN16
 */
export const PIPE_SPEC_TABLES: Record<PipeSpecId, PipeSpecificationTable> = {
  [PipeSpecId.PPR_PN16]: {
    id: PipeSpecId.PPR_PN16,
    materialFamily: 'PP-R',
    className: 'PN16 (S3.2)',
    fullName: 'PP-R PN16 (S3.2)',
    pressureRatingBar: 16,
    sizes: [
      { nominalSize: 20, outerDiameter: 20, wallThickness: 2.8, innerDiameter: 14.4 },
      { nominalSize: 25, outerDiameter: 25, wallThickness: 3.5, innerDiameter: 18.0 },
      { nominalSize: 32, outerDiameter: 32, wallThickness: 4.4, innerDiameter: 23.2 },
      { nominalSize: 40, outerDiameter: 40, wallThickness: 5.5, innerDiameter: 29.0 },
      { nominalSize: 50, outerDiameter: 50, wallThickness: 6.9, innerDiameter: 36.2 },
      { nominalSize: 63, outerDiameter: 63, wallThickness: 8.6, innerDiameter: 45.8 },
      { nominalSize: 75, outerDiameter: 75, wallThickness: 10.3, innerDiameter: 54.4 },
      { nominalSize: 90, outerDiameter: 90, wallThickness: 12.3, innerDiameter: 65.4 },
      { nominalSize: 110, outerDiameter: 110, wallThickness: 15.1, innerDiameter: 79.8 },
      { nominalSize: 125, outerDiameter: 125, wallThickness: 17.1, innerDiameter: 90.8 },
      { nominalSize: 160, outerDiameter: 160, wallThickness: 21.9, innerDiameter: 116.2 },
    ],
  },
  [PipeSpecId.PPR_PN20]: {
    id: PipeSpecId.PPR_PN20,
    materialFamily: 'PP-R',
    className: 'PN20 (S2.5)',
    fullName: 'PP-R PN20 (S2.5)',
    pressureRatingBar: 20,
    sizes: [
      { nominalSize: 20, outerDiameter: 20, wallThickness: 3.4, innerDiameter: 13.2 },
      { nominalSize: 25, outerDiameter: 25, wallThickness: 4.2, innerDiameter: 16.6 },
      { nominalSize: 32, outerDiameter: 32, wallThickness: 5.4, innerDiameter: 21.2 },
      { nominalSize: 40, outerDiameter: 40, wallThickness: 6.7, innerDiameter: 26.6 },
      { nominalSize: 50, outerDiameter: 50, wallThickness: 8.3, innerDiameter: 33.4 },
      { nominalSize: 63, outerDiameter: 63, wallThickness: 10.5, innerDiameter: 42.0 },
      { nominalSize: 75, outerDiameter: 75, wallThickness: 12.5, innerDiameter: 50.0 },
      { nominalSize: 90, outerDiameter: 90, wallThickness: 15.0, innerDiameter: 60.0 },
      { nominalSize: 110, outerDiameter: 110, wallThickness: 18.3, innerDiameter: 73.4 },
      { nominalSize: 125, outerDiameter: 125, wallThickness: null, innerDiameter: null },
      { nominalSize: 160, outerDiameter: 160, wallThickness: null, innerDiameter: null },
    ],
  },
  [PipeSpecId.UPVC_CLASS_E]: {
    id: PipeSpecId.UPVC_CLASS_E,
    materialFamily: 'uPVC',
    className: 'Class E',
    fullName: 'uPVC Class E (PN15)',
    pressureRatingBar: 15,
    sizes: [
      { nominalSize: 15, outerDiameter: 21.5, wallThickness: 2.1, innerDiameter: 17.3 },
      { nominalSize: 20, outerDiameter: 26.9, wallThickness: 2.5, innerDiameter: 21.9 },
      { nominalSize: 25, outerDiameter: 33.7, wallThickness: 2.7, innerDiameter: 28.3 },
      { nominalSize: 32, outerDiameter: 42.4, wallThickness: 3.2, innerDiameter: 36.0 },
      { nominalSize: 40, outerDiameter: 48.4, wallThickness: 3.7, innerDiameter: 41.0 },
      { nominalSize: 50, outerDiameter: 60.5, wallThickness: 4.5, innerDiameter: 51.5 },
      { nominalSize: 65, outerDiameter: 75.3, wallThickness: 5.5, innerDiameter: 64.3 },
      { nominalSize: 80, outerDiameter: 89.1, wallThickness: 6.6, innerDiameter: 75.9 },
      { nominalSize: 100, outerDiameter: 114.5, wallThickness: 8.4, innerDiameter: 97.7 },
      { nominalSize: 125, outerDiameter: 140.4, wallThickness: 10.4, innerDiameter: 119.6 },
      { nominalSize: 155, outerDiameter: 168.5, wallThickness: 12.5, innerDiameter: 143.5 },
      { nominalSize: 200, outerDiameter: 219.4, wallThickness: 14.5, innerDiameter: 190.4 },
      { nominalSize: 250, outerDiameter: 273.4, wallThickness: 18.1, innerDiameter: 237.2 },
    ],
  },
  [PipeSpecId.UPVC_CLASS_7]: {
    id: PipeSpecId.UPVC_CLASS_7,
    materialFamily: 'uPVC',
    className: 'Class 7',
    fullName: 'uPVC Class 7',
    pressureRatingBar: 12,
    sizes: [
      { nominalSize: 15, outerDiameter: 21.5, wallThickness: 3.7, innerDiameter: 14.1 },
      { nominalSize: 20, outerDiameter: 26.9, wallThickness: 3.9, innerDiameter: 19.1 },
      { nominalSize: 25, outerDiameter: 33.7, wallThickness: 4.5, innerDiameter: 24.7 },
      { nominalSize: 32, outerDiameter: 42.4, wallThickness: 4.8, innerDiameter: 32.8 },
      { nominalSize: 40, outerDiameter: 48.4, wallThickness: 5.1, innerDiameter: 38.2 },
      { nominalSize: 50, outerDiameter: 60.5, wallThickness: 5.5, innerDiameter: 49.5 },
      { nominalSize: 65, outerDiameter: 75.3, wallThickness: null, innerDiameter: null },
      { nominalSize: 80, outerDiameter: 89.1, wallThickness: null, innerDiameter: null },
      { nominalSize: 100, outerDiameter: 114.5, wallThickness: null, innerDiameter: null },
      { nominalSize: 125, outerDiameter: 140.4, wallThickness: null, innerDiameter: null },
      { nominalSize: 155, outerDiameter: 168.5, wallThickness: null, innerDiameter: null },
      { nominalSize: 200, outerDiameter: 219.4, wallThickness: null, innerDiameter: null },
      { nominalSize: 250, outerDiameter: 273.4, wallThickness: null, innerDiameter: null },
    ],
  },
  [PipeSpecId.HDPE_PN12_5]: {
    id: PipeSpecId.HDPE_PN12_5,
    materialFamily: 'HDPE PE100',
    className: 'PN12.5',
    fullName: 'HDPE PE100 PN12.5',
    pressureRatingBar: 12.5,
    sizes: [
      { nominalSize: 20, outerDiameter: 20, wallThickness: null, innerDiameter: null },
      { nominalSize: 25, outerDiameter: 25, wallThickness: 2.3, innerDiameter: 20.4 },
      { nominalSize: 32, outerDiameter: 32, wallThickness: 2.4, innerDiameter: 27.2 },
      { nominalSize: 40, outerDiameter: 40, wallThickness: 3.0, innerDiameter: 34.0 },
      { nominalSize: 50, outerDiameter: 50, wallThickness: 3.7, innerDiameter: 42.6 },
      { nominalSize: 63, outerDiameter: 63, wallThickness: 4.7, innerDiameter: 53.6 },
      { nominalSize: 75, outerDiameter: 75, wallThickness: 5.6, innerDiameter: 63.8 },
      { nominalSize: 90, outerDiameter: 90, wallThickness: 6.7, innerDiameter: 76.6 },
      { nominalSize: 110, outerDiameter: 110, wallThickness: 8.1, innerDiameter: 93.8 },
      { nominalSize: 125, outerDiameter: 125, wallThickness: 9.2, innerDiameter: 106.6 },
      { nominalSize: 160, outerDiameter: 160, wallThickness: 11.8, innerDiameter: 136.4 },
      { nominalSize: 180, outerDiameter: 180, wallThickness: 13.3, innerDiameter: 153.4 },
      { nominalSize: 200, outerDiameter: 200, wallThickness: 14.7, innerDiameter: 170.6 },
    ],
  },
  [PipeSpecId.HDPE_PN16]: {
    id: PipeSpecId.HDPE_PN16,
    materialFamily: 'HDPE PE100',
    className: 'PN16',
    fullName: 'HDPE PE100 PN16',
    pressureRatingBar: 16,
    sizes: [
      { nominalSize: 20, outerDiameter: 20, wallThickness: 2.3, innerDiameter: 15.4 },
      { nominalSize: 25, outerDiameter: 25, wallThickness: 2.7, innerDiameter: 19.6 },
      { nominalSize: 32, outerDiameter: 32, wallThickness: 3.4, innerDiameter: 25.2 },
      { nominalSize: 40, outerDiameter: 40, wallThickness: 4.2, innerDiameter: 31.6 },
      { nominalSize: 50, outerDiameter: 50, wallThickness: 5.2, innerDiameter: 39.6 },
      { nominalSize: 63, outerDiameter: 63, wallThickness: 6.5, innerDiameter: 50.0 },
      { nominalSize: 75, outerDiameter: 75, wallThickness: 7.6, innerDiameter: 59.8 },
      { nominalSize: 90, outerDiameter: 90, wallThickness: 9.2, innerDiameter: 71.6 },
      { nominalSize: 110, outerDiameter: 110, wallThickness: 11.1, innerDiameter: 87.8 },
      { nominalSize: 125, outerDiameter: 125, wallThickness: 12.7, innerDiameter: 99.6 },
      { nominalSize: 160, outerDiameter: 160, wallThickness: 16.2, innerDiameter: 127.6 },
      { nominalSize: 180, outerDiameter: 180, wallThickness: 18.2, innerDiameter: 143.6 },
      { nominalSize: 200, outerDiameter: 200, wallThickness: 20.2, innerDiameter: 159.6 },
    ],
  },
  [PipeSpecId.MSCL]: {
    id: PipeSpecId.MSCL,
    materialFamily: 'MSCL',
    className: 'Mild Steel Cement Lined',
    fullName: 'MSCL Pipe',
    shortName: 'MSCL Pipe',
    dimDecimals: 1,
    pressureRatingBar: 16,
    sizes: [
      { nominalSize: 100, outerDiameter: 121.9, wallThickness: 14.1, innerDiameter: 93.7 },
      { nominalSize: 150, outerDiameter: 177.3, wallThickness: 14.1, innerDiameter: 149.1 },
      { nominalSize: 200, outerDiameter: 232.2, wallThickness: 14.1, innerDiameter: 204.0 },
      { nominalSize: 250, outerDiameter: 286.0, wallThickness: 14.1, innerDiameter: 257.8 },
      { nominalSize: 300, outerDiameter: 345.4, wallThickness: 15.8, innerDiameter: 313.8 },
      { nominalSize: 350, outerDiameter: 399.3, wallThickness: 18.8, innerDiameter: 361.7 },
      { nominalSize: 400, outerDiameter: 453.1, wallThickness: 18.8, innerDiameter: 415.5 },
      { nominalSize: 450, outerDiameter: 507.0, wallThickness: 18.8, innerDiameter: 469.4 },
      { nominalSize: 500, outerDiameter: 560.3, wallThickness: 18.8, innerDiameter: 522.7 },
      { nominalSize: 600, outerDiameter: 667.0, wallThickness: 19.5, innerDiameter: 628.0 },
      { nominalSize: 650, outerDiameter: 692.0, wallThickness: 20.4, innerDiameter: 651.2 },
      { nominalSize: 700, outerDiameter: 754.0, wallThickness: 26.4, innerDiameter: 701.2 },
      { nominalSize: 750, outerDiameter: 804.0, wallThickness: 26.4, innerDiameter: 751.2 },
      { nominalSize: 800, outerDiameter: 854.0, wallThickness: 26.4, innerDiameter: 801.2 },
    ],
  },
  [PipeSpecId.SS_10S]: {
    id: PipeSpecId.SS_10S,
    materialFamily: 'Stainless Steel',
    className: 'ASME B36.19 - 10S',
    fullName: 'Stainless Steel — ASME B36.19 - 10S',
    shortName: 'SS ASME B36.19 - 10S',
    dimDecimals: 2,
    pressureRatingBar: 16,
    sizes: [
      { nominalSize: 15, outerDiameter: 21.3, wallThickness: 2.11, innerDiameter: 17.08 },
      { nominalSize: 20, outerDiameter: 26.7, wallThickness: 2.11, innerDiameter: 22.48 },
      { nominalSize: 25, outerDiameter: 33.4, wallThickness: 2.77, innerDiameter: 27.86 },
      { nominalSize: 32, outerDiameter: 42.2, wallThickness: 2.77, innerDiameter: 36.66 },
      { nominalSize: 40, outerDiameter: 48.3, wallThickness: 2.77, innerDiameter: 42.76 },
      { nominalSize: 50, outerDiameter: 60.3, wallThickness: 2.77, innerDiameter: 54.76 },
      { nominalSize: 65, outerDiameter: 73.0, wallThickness: 3.05, innerDiameter: 66.90 },
      { nominalSize: 80, outerDiameter: 88.9, wallThickness: 3.05, innerDiameter: 82.80 },
      { nominalSize: 90, outerDiameter: 101.6, wallThickness: 3.05, innerDiameter: 95.50 },
      { nominalSize: 100, outerDiameter: 114.3, wallThickness: 3.05, innerDiameter: 108.20 },
      { nominalSize: 125, outerDiameter: 141.3, wallThickness: 3.40, innerDiameter: 134.50 },
      { nominalSize: 150, outerDiameter: 168.3, wallThickness: 3.40, innerDiameter: 161.50 },
      { nominalSize: 200, outerDiameter: 219.1, wallThickness: 3.76, innerDiameter: 211.58 },
      { nominalSize: 250, outerDiameter: 273.1, wallThickness: 4.19, innerDiameter: 264.72 },
      { nominalSize: 300, outerDiameter: 323.9, wallThickness: 4.57, innerDiameter: 314.76 },
      { nominalSize: 350, outerDiameter: 355.6, wallThickness: 4.78, innerDiameter: 346.04 },
      { nominalSize: 400, outerDiameter: 406.4, wallThickness: 4.78, innerDiameter: 396.84 },
      { nominalSize: 450, outerDiameter: 457.2, wallThickness: 4.78, innerDiameter: 447.64 },
      { nominalSize: 500, outerDiameter: 508.0, wallThickness: 5.54, innerDiameter: 496.92 },
      { nominalSize: 550, outerDiameter: 558.8, wallThickness: 5.54, innerDiameter: 547.72 },
      { nominalSize: 600, outerDiameter: 609.6, wallThickness: 6.35, innerDiameter: 596.90 },
    ],
  },
  [PipeSpecId.SS_40S]: {
    id: PipeSpecId.SS_40S,
    materialFamily: 'Stainless Steel',
    className: 'ASME B36.19 - 40S',
    fullName: 'Stainless Steel — ASME B36.19 - 40S',
    shortName: 'SS ASME B36.19 - 40S',
    dimDecimals: 2,
    pressureRatingBar: 40,
    sizes: [
      { nominalSize: 15, outerDiameter: 21.3, wallThickness: 2.77, innerDiameter: 15.76 },
      { nominalSize: 20, outerDiameter: 26.7, wallThickness: 2.87, innerDiameter: 20.96 },
      { nominalSize: 25, outerDiameter: 33.4, wallThickness: 3.38, innerDiameter: 26.64 },
      { nominalSize: 32, outerDiameter: 42.2, wallThickness: 3.56, innerDiameter: 35.08 },
      { nominalSize: 40, outerDiameter: 48.3, wallThickness: 3.68, innerDiameter: 40.94 },
      { nominalSize: 50, outerDiameter: 60.3, wallThickness: 3.91, innerDiameter: 52.48 },
      { nominalSize: 65, outerDiameter: 73.0, wallThickness: 5.16, innerDiameter: 62.68 },
      { nominalSize: 80, outerDiameter: 88.9, wallThickness: 5.49, innerDiameter: 77.92 },
      { nominalSize: 90, outerDiameter: 101.6, wallThickness: 5.74, innerDiameter: 90.12 },
      { nominalSize: 100, outerDiameter: 114.3, wallThickness: 6.02, innerDiameter: 102.26 },
      { nominalSize: 125, outerDiameter: 141.3, wallThickness: 6.55, innerDiameter: 128.20 },
      { nominalSize: 150, outerDiameter: 168.3, wallThickness: 7.11, innerDiameter: 154.08 },
      { nominalSize: 200, outerDiameter: 219.1, wallThickness: 8.18, innerDiameter: 202.74 },
      { nominalSize: 250, outerDiameter: 273.1, wallThickness: 9.27, innerDiameter: 254.56 },
      { nominalSize: 300, outerDiameter: 323.9, wallThickness: 9.53, innerDiameter: 304.84 },
      { nominalSize: 350, outerDiameter: 355.6, wallThickness: 9.53, innerDiameter: 336.54 },
      { nominalSize: 400, outerDiameter: 406.4, wallThickness: 9.53, innerDiameter: 387.34 },
      { nominalSize: 450, outerDiameter: 457.2, wallThickness: 9.53, innerDiameter: 438.14 },
      { nominalSize: 500, outerDiameter: 508.0, wallThickness: 9.53, innerDiameter: 488.94 },
      { nominalSize: 550, outerDiameter: 558.8, wallThickness: null, innerDiameter: null },
      { nominalSize: 600, outerDiameter: 609.6, wallThickness: 9.53, innerDiameter: 590.54 },
    ],
  },
};

/**
 * Format pipe wall thickness or internal diameter (mm) with material-appropriate decimal precision
 * (2 decimal places for ASME B36.19 Stainless Steel, 1 decimal place for PP-R/uPVC/HDPE/MSCL).
 */
export function formatPipeDim(
  valueMm: number | null | undefined,
  pipeSpec?: Pick<PipeSpecificationTable, 'dimDecimals'>
): string {
  if (valueMm === null || valueMm === undefined || !Number.isFinite(valueMm)) return '—';
  return valueMm.toFixed(pipeSpec?.dimDecimals ?? 1);
}

/**
 * Compact display tag for a pipe material/class (used for fallback badges, schematic callouts, and schedules).
 */
export function getPipeSpecBadgeLabel(specId: PipeSpecId): string {
  switch (specId) {
    case PipeSpecId.PPR_PN16:
      return 'PP-R PN16';
    case PipeSpecId.PPR_PN20:
      return 'PP-R PN20';
    case PipeSpecId.UPVC_CLASS_E:
      return 'uPVC Cl.E';
    case PipeSpecId.UPVC_CLASS_7:
      return 'uPVC Cl.7';
    case PipeSpecId.HDPE_PN12_5:
      return 'HDPE PN12.5';
    case PipeSpecId.HDPE_PN16:
      return 'HDPE PN16';
    case PipeSpecId.MSCL:
      return 'MSCL';
    case PipeSpecId.SS_10S:
      return 'SS 10S';
    case PipeSpecId.SS_40S:
      return 'SS 40S';
    default:
      return String(specId);
  }
}

/**
 * Standard commercial PRV valve nominal DN sizes (mm) for PRV station sizing
 */
export const STANDARD_PRV_DN_SIZES = [
  15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600,
];

export interface BuildingPreset {
  id: string;
  name: string;
  subtitle: string;
  parameters: DesignParameters;
  floors: FloorInputRow[];
}

/**
 * Preset 1 (Default): Blank Project (Clean Slate)
 */
function buildBlankProjectPreset(): BuildingPreset {
  return {
    id: 'preset-blank',
    name: 'Blank Project (Clean Slate)',
    subtitle: 'Empty floor stack · Add floors or generate tower in Floor Data Input',
    parameters: {
      projectName: 'Untitled Project',
      projectRef: 'KAC-001',
      pipeSpecId: PipeSpecId.PPR_PN16,
      optionalPipeSpecId: PipeSpecId.MSCL,
      maxVelocityMs: 1.5,
      maxStaticPressureBar: 3.5,
      prvSetPressureBar: 2.0,
      boosterPumpBoostBar: 2.0,
      zoningStrategy: ZoningStrategy.AUTO_ZONED_VERTICAL,
      desiredDropperCount: null,
    },
    floors: [],
  };
}

/**
 * Preset 2: Case Study 1 (KAC-0647)
 * 33-Storey (Roof + L32–L1 + G), 107.35 m head, Manual Zones D1–D3 + SD1/SD2
 */
function buildCaseStudy1Preset(): BuildingPreset {
  return {
    id: 'preset-case-study-1',
    name: 'Case Study 1',
    subtitle:
      'KAC-0647 · 107.35 m head · L32–L29 Booster · L28–G Gravity · D1–D3 + SD1/SD2 · PP-R PN16',
    parameters: CASE_STUDY_1_DATA.parameters,
    floors: CASE_STUDY_1_DATA.floors,
  };
}

/**
 * Preset 3: Case Study 2 (KAC-0876)
 * 31-Storey (Roof + L31–L1), 102.90 m head, Manual Zones D1–D5 + SD1–SD5
 */
function buildCaseStudy2Preset(): BuildingPreset {
  return {
    id: 'preset-case-study-2',
    name: 'Case Study 2',
    subtitle:
      'KAC-0876 · 102.90 m head · L31–L28 Booster · L27–L1 Gravity · D1–D5 + SD1–SD5 · PP-R PN16',
    parameters: CASE_STUDY_2_DATA.parameters,
    floors: CASE_STUDY_2_DATA.floors,
  };
}

export const BUILDING_PRESETS: BuildingPreset[] = [
  buildBlankProjectPreset(),
  buildCaseStudy1Preset(),
  buildCaseStudy2Preset(),
];


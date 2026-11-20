import * as XLSX from 'xlsx';
import {
  BUILDING_PRESETS,
  BuildingPreset,
  PIPE_SPEC_TABLES,
} from '../data/pipeSpecs';
import {
  ApplianceCounts,
  DesignParameters,
  DesignStandard,
  FloorInputRow,
  FloorRiserAllocation,
  FlowConversionFormula,
  PipeHeaderCustomSize,
  PipeSpecId,
  PrvOverrideMode,
  RiserTarget,
  SubDropperConfig,
  SupplyMode,
  SystemCalculationResult,
  ZoningStrategy,
} from '../types/hydraulics';
import { normalizeApplianceCounts, VALID_APPLIANCE_IDS } from '../data/appliances';
import {
  DEFAULT_CAVITATION_RATIO_LIMIT,
  DEFAULT_FLOW_COEFFICIENT,
  DEFAULT_FLOW_EXPONENT,
  DEFAULT_FLOW_EXPRESSION,
  formatFlowFormulaDisplay,
  getDefaultFlowFormulaForStandard,
  getEffectiveCavitationRatioLimit,
  getEffectiveFlowFormula,
  getEffectiveStandard,
  isDefaultCavitationRatioLimit,
  isDefaultFlowFormula,
  validateFlowExpression,
} from './calculations';
import { parseImportedFloorFile } from './exportReport';

export const CUSTOM_PRESET_ID = 'custom';

export interface ImportedProjectState {
  parameters: DesignParameters;
  floors: FloorInputRow[];
  sourceFormat: 'full-project' | 'json-template' | 'floor-list-fallback';
}

export function cloneFloorRow(f: FloorInputRow): FloorInputRow {
  return {
    ...f,
    dropperPrvOverrides: f.dropperPrvOverrides
      ? { ...f.dropperPrvOverrides }
      : undefined,
    dropperPrvSetPressures: f.dropperPrvSetPressures
      ? { ...f.dropperPrvSetPressures }
      : undefined,
    subDropperPrvOverrides: f.subDropperPrvOverrides
      ? { ...f.subDropperPrvOverrides }
      : undefined,
    subDropperPrvSetPressures: f.subDropperPrvSetPressures
      ? { ...f.subDropperPrvSetPressures }
      : undefined,
    loadSplits: f.loadSplits?.map((s) => ({
      target: { ...s.target },
      loadingUnits: s.loadingUnits,
    })),
    applianceCounts: f.applianceCounts ? normalizeApplianceCounts(f.applianceCounts) : undefined,
  };
}

export function cloneParameters(p: DesignParameters): DesignParameters {
  let clonedExcluded: Partial<Record<PipeSpecId, number[]>> | undefined;
  if (p.excludedPipeSizes) {
    const entries = Object.entries(p.excludedPipeSizes).filter(
      ([, arr]) => Array.isArray(arr) && arr.length > 0
    );
    if (entries.length > 0) {
      clonedExcluded = {};
      for (const [k, arr] of entries) {
        clonedExcluded[k as PipeSpecId] = [...(arr as number[])];
      }
    }
  }

  return {
    ...p,
    subDroppers: p.subDroppers?.map((sd) => ({ ...sd })),
    dropperBoosterOverrides: p.dropperBoosterOverrides
      ? { ...p.dropperBoosterOverrides }
      : undefined,
    dropperBoosterPressures: p.dropperBoosterPressures
      ? { ...p.dropperBoosterPressures }
      : undefined,
    pipeHeaderCustomSize: p.pipeHeaderCustomSize
      ? { ...p.pipeHeaderCustomSize }
      : p.pipeHeaderCustomSize ?? null,
    excludedPipeSizes: clonedExcluded,
    flowFormula: p.flowFormula ? { ...p.flowFormula } : undefined,
    cavitationRatioLimit: p.cavitationRatioLimit,
    standard: p.standard,
  };
}

function normalizeSortedRecord<T>(
  rec: Record<string | number, T> | undefined
): Array<[string, T]> {
  if (!rec) return [];
  return Object.entries(rec)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
}

function normalizeParametersForComparison(p: DesignParameters) {
  const excludedEntries = Object.entries(p.excludedPipeSizes ?? {})
    .filter(([, arr]) => Array.isArray(arr) && arr.length > 0)
    .map(([k, arr]) => [k, [...(arr as number[])].sort((a, b) => a - b)] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  return {
    projectName: p.projectName,
    projectRef: p.projectRef,
    pipeSpecId: p.pipeSpecId,
    optionalPipeSpecId: p.optionalPipeSpecId ?? null,
    maxVelocityMs: p.maxVelocityMs,
    maxStaticPressureBar: p.maxStaticPressureBar,
    prvSetPressureBar: p.prvSetPressureBar,
    boosterPumpBoostBar: p.boosterPumpBoostBar,
    zoningStrategy: p.zoningStrategy,
    desiredDropperCount: p.desiredDropperCount ?? null,
    subDroppers: (p.subDroppers ?? []).map((sd) => ({
      id: sd.id,
      label: sd.label,
      parentDropperIndex: sd.parentDropperIndex,
      branchFloorId: sd.branchFloorId,
      hasBoosterPump: Boolean(sd.hasBoosterPump),
      boosterBoostBar: sd.boosterBoostBar ?? null,
    })),
    dropperBoosterOverrides: normalizeSortedRecord(p.dropperBoosterOverrides),
    dropperBoosterPressures: normalizeSortedRecord(p.dropperBoosterPressures),
    pipeHeaderCustomSize: p.pipeHeaderCustomSize
      ? {
          nominalSize: p.pipeHeaderCustomSize.nominalSize,
          specId: p.pipeHeaderCustomSize.specId ?? p.pipeSpecId,
        }
      : null,
    excludedPipeSizes: excludedEntries,
    standard: getEffectiveStandard(p.standard),
    flowFormula: isDefaultFlowFormula(p.flowFormula, p.standard)
      ? null
      : getEffectiveFlowFormula(p.flowFormula, p.standard),
    cavitationRatioLimit: getEffectiveCavitationRatioLimit(p),
  };
}

function normalizeFloorForComparison(f: FloorInputRow) {
  return {
    id: f.id,
    floorLabel: f.floorLabel,
    floorHeightM: f.floorHeightM,
    supplyMode: f.supplyMode,
    loadingUnits: f.loadingUnits,
    prvOverride: f.prvOverride,
    manualDropperIndex: f.manualDropperIndex ?? null,
    subDropperId: f.subDropperId ?? null,
    dropperPrvOverrides: normalizeSortedRecord(f.dropperPrvOverrides),
    dropperPrvSetPressures: normalizeSortedRecord(f.dropperPrvSetPressures),
    subDropperPrvOverrides: normalizeSortedRecord(f.subDropperPrvOverrides),
    subDropperPrvSetPressures: normalizeSortedRecord(f.subDropperPrvSetPressures),
    loadSplits: (f.loadSplits ?? []).map((s) => ({
      target:
        s.target.kind === 'main'
          ? `main:${s.target.dropperIndex}`
          : `sub:${s.target.subDropperId}`,
      loadingUnits: s.loadingUnits,
    })),
    applianceCounts: normalizeSortedRecord(normalizeApplianceCounts(f.applianceCounts)),
  };
}

export function isProjectModifiedFromPreset(
  preset: BuildingPreset,
  parameters: DesignParameters,
  floors: FloorInputRow[]
): boolean {
  const normCurrentParams = normalizeParametersForComparison(parameters);
  const normPresetParams = normalizeParametersForComparison(preset.parameters);
  if (JSON.stringify(normCurrentParams) !== JSON.stringify(normPresetParams)) {
    return true;
  }

  if (floors.length !== preset.floors.length) {
    return true;
  }

  for (let i = 0; i < floors.length; i++) {
    const a = normalizeFloorForComparison(floors[i]);
    const b = normalizeFloorForComparison(preset.floors[i]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      return true;
    }
  }

  return false;
}

function serializeKeyValRecord(
  rec: Record<string | number, string | number> | undefined
): string {
  if (!rec) return '';
  const entries = Object.entries(rec).filter(
    ([, val]) => val !== undefined && val !== null && val !== ''
  );
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${v}`).join('; ');
}

function serializeLoadSplits(splits: FloorRiserAllocation[] | undefined): string {
  if (!splits || splits.length === 0) return '';
  return splits
    .map((s) => {
      const targetKey =
        s.target.kind === 'main'
          ? `main:${s.target.dropperIndex}`
          : `sub:${s.target.subDropperId}`;
      return `${targetKey}=${s.loadingUnits}`;
    })
    .join('; ');
}

function parsePrvOverrideModeValue(raw: string): PrvOverrideMode | null {
  const norm = raw.trim().toUpperCase();
  if (norm === PrvOverrideMode.AUTO || norm === 'AUTO') return PrvOverrideMode.AUTO;
  if (norm === PrvOverrideMode.FORCE_PRV || norm === 'FORCE' || norm === 'FORCE PRV') {
    return PrvOverrideMode.FORCE_PRV;
  }
  if (norm === PrvOverrideMode.NO_PRV || norm === 'SUPPRESS' || norm === 'NO PRV') {
    return PrvOverrideMode.NO_PRV;
  }
  return null;
}

function parseDropperPrvOverrides(
  raw: unknown
): Record<number, PrvOverrideMode> | undefined {
  const str = String(raw ?? '').trim();
  if (!str) return undefined;

  const result: Record<number, PrvOverrideMode> = {};
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        const dIdx = parseInt(k, 10);
        const mode = parsePrvOverrideModeValue(String(v ?? ''));
        if (Number.isFinite(dIdx) && dIdx >= 1 && mode) {
          result[dIdx] = mode;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    } catch {
      // Fall through to key=val parser
    }
  }

  for (const part of str.split(/[;,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    const sepIdx = eqIdx >= 0 ? eqIdx : trimmed.indexOf(':');
    if (sepIdx < 0) continue;
    const rawKey = trimmed.slice(0, sepIdx).trim().replace(/^D/i, '');
    const rawVal = trimmed.slice(sepIdx + 1).trim();
    const dIdx = parseInt(rawKey, 10);
    const mode = parsePrvOverrideModeValue(rawVal);
    if (Number.isFinite(dIdx) && dIdx >= 1 && mode) {
      result[dIdx] = mode;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseDropperNumberRecord(raw: unknown): Record<number, number> | undefined {
  const str = String(raw ?? '').trim();
  if (!str) return undefined;

  const result: Record<number, number> = {};
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        const dIdx = parseInt(k, 10);
        const num = Number(v);
        if (Number.isFinite(dIdx) && dIdx >= 1 && Number.isFinite(num) && num > 0) {
          result[dIdx] = num;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    } catch {
      // Fall through
    }
  }

  for (const part of str.split(/[;,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    const sepIdx = eqIdx >= 0 ? eqIdx : trimmed.indexOf(':');
    if (sepIdx < 0) continue;
    const rawKey = trimmed.slice(0, sepIdx).trim().replace(/^D/i, '');
    const rawVal = trimmed.slice(sepIdx + 1).trim();
    const dIdx = parseInt(rawKey, 10);
    const num = parseFloat(rawVal);
    if (Number.isFinite(dIdx) && dIdx >= 1 && Number.isFinite(num) && num > 0) {
      result[dIdx] = num;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseSubDropperPrvOverrides(
  raw: unknown
): Record<string, PrvOverrideMode> | undefined {
  const str = String(raw ?? '').trim();
  if (!str) return undefined;

  const result: Record<string, PrvOverrideMode> = {};
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        const mode = parsePrvOverrideModeValue(String(v ?? ''));
        if (k.trim() && mode) {
          result[k.trim()] = mode;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    } catch {
      // Fall through
    }
  }

  for (const part of str.split(/[;,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    const sepIdx = eqIdx >= 0 ? eqIdx : trimmed.indexOf(':');
    if (sepIdx < 0) continue;
    const key = trimmed.slice(0, sepIdx).trim();
    const mode = parsePrvOverrideModeValue(trimmed.slice(sepIdx + 1).trim());
    if (key && mode) {
      result[key] = mode;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseSubDropperNumberRecord(raw: unknown): Record<string, number> | undefined {
  const str = String(raw ?? '').trim();
  if (!str) return undefined;

  const result: Record<string, number> = {};
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        const num = Number(v);
        if (k.trim() && Number.isFinite(num) && num > 0) {
          result[k.trim()] = num;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    } catch {
      // Fall through
    }
  }

  for (const part of str.split(/[;,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    const sepIdx = eqIdx >= 0 ? eqIdx : trimmed.indexOf(':');
    if (sepIdx < 0) continue;
    const key = trimmed.slice(0, sepIdx).trim();
    const num = parseFloat(trimmed.slice(sepIdx + 1).trim());
    if (key && Number.isFinite(num) && num > 0) {
      result[key] = num;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseLoadSplits(raw: unknown): FloorRiserAllocation[] | undefined {
  const str = String(raw ?? '').trim();
  if (!str) return undefined;

  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str) as FloorRiserAllocation[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(
          (s) =>
            s &&
            s.target &&
            Number.isFinite(s.loadingUnits) &&
            s.loadingUnits >= 0
        );
      }
    } catch {
      // Fall through
    }
  }

  const allocations: FloorRiserAllocation[] = [];
  for (const part of str.split(/[;,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const targetRaw = trimmed.slice(0, eqIdx).trim();
    const lu = parseFloat(trimmed.slice(eqIdx + 1).trim());
    if (!Number.isFinite(lu) || lu < 0) continue;

    let target: RiserTarget | null = null;
    if (targetRaw.startsWith('main:')) {
      const dIdx = parseInt(targetRaw.slice(5), 10);
      if (Number.isFinite(dIdx) && dIdx >= 1) {
        target = { kind: 'main', dropperIndex: dIdx };
      }
    } else if (targetRaw.startsWith('sub:')) {
      const sdId = targetRaw.slice(4).trim();
      if (sdId) {
        target = { kind: 'sub', subDropperId: sdId };
      }
    } else if (/^D\d+$/i.test(targetRaw)) {
      const dIdx = parseInt(targetRaw.slice(1), 10);
      if (Number.isFinite(dIdx) && dIdx >= 1) {
        target = { kind: 'main', dropperIndex: dIdx };
      }
    }

    if (target) {
      allocations.push({ target, loadingUnits: lu });
    }
  }

  return allocations.length > 0 ? allocations : undefined;
}

function parseBooleanFlag(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'booster';
}

function parseSupplyMode(raw: unknown, floorLabel: string): SupplyMode {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === SupplyMode.ROOF_HEADER || s.includes('ROOF') || s.includes('HEADER')) {
    return SupplyMode.ROOF_HEADER;
  }
  if (s === SupplyMode.BOOSTER || s.includes('BOOST') || s.includes('PUMP')) {
    return SupplyMode.BOOSTER;
  }
  if (s === SupplyMode.GRAVITY || s.includes('GRAV')) {
    return SupplyMode.GRAVITY;
  }
  if (floorLabel.trim().toLowerCase().includes('roof')) {
    return SupplyMode.ROOF_HEADER;
  }
  return SupplyMode.GRAVITY;
}

function parseDesignStandard(raw: unknown): DesignStandard | undefined {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === DesignStandard.BS_EN_806_3 || s === 'BS EN 806-3' || s === 'BS_EN_806-3') {
    return DesignStandard.BS_EN_806_3;
  }
  if (s === DesignStandard.BS_6700 || s === 'BS 6700') {
    return DesignStandard.BS_6700;
  }
  return undefined;
}

function parseApplianceCounts(raw: unknown): ApplianceCounts | undefined {
  const str = String(raw ?? '').trim();
  if (!str) return undefined;
  const result: ApplianceCounts = {};
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        const key = k.trim();
        const num = Number(v);
        if (VALID_APPLIANCE_IDS.has(key as keyof ApplianceCounts) && Number.isFinite(num) && num > 0) {
          result[key as keyof ApplianceCounts] = num;
        }
      }
      return normalizeApplianceCounts(result);
    } catch {
      return undefined;
    }
  }
  for (const part of str.split(/[;,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const num = parseFloat(trimmed.slice(eqIdx + 1).trim());
    if (VALID_APPLIANCE_IDS.has(key as keyof ApplianceCounts) && Number.isFinite(num) && num > 0) {
      result[key as keyof ApplianceCounts] = num;
    }
  }
  return normalizeApplianceCounts(result);
}

/**
 * Build complete HydroDrop Calc project workbook (.xlsx)
 * suitable for lossless round-trip restoration via `importProjectFromExcel`.
 */
export function buildProjectWorkbook(
  parameters: DesignParameters,
  floors: FloorInputRow[],
  calcResult?: SystemCalculationResult
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // 1. Project Config sheet
  const configRows: Array<[string, string, string | number, string]> = [
    ['Parameter Key', 'Setting', 'Value', 'Notes'],
    ['exportFormatVersion', 'HydroDrop Project Format', '1.0', 'Full project round-trip schema'],
    ['projectName', 'Project Name', parameters.projectName, 'Project title'],
    ['projectRef', 'Job No.', parameters.projectRef, 'Project job number'],
    ['pipeSpecId', 'Primary Pipe Material Spec', parameters.pipeSpecId, 'PipeSpecId enum'],
    [
      'optionalPipeSpecId',
      'Optional Fallback Pipe Spec',
      parameters.optionalPipeSpecId ?? '',
      'Blank = None',
    ],
    ['maxVelocityMs', 'Max Flow Velocity (m/s)', parameters.maxVelocityMs, 'Global Vmax limit'],
    [
      'maxStaticPressureBar',
      'Max Static Pressure (bar)',
      parameters.maxStaticPressureBar,
      'PRV trigger threshold Pmax',
    ],
    [
      'prvSetPressureBar',
      'PRV Set Pressure (bar)',
      parameters.prvSetPressureBar,
      'Default PRV downstream P2',
    ],
    [
      'boosterPumpBoostBar',
      'Booster Pump Boost (bar)',
      parameters.boosterPumpBoostBar,
      'Default booster pump pressure boost',
    ],
    [
      'zoningStrategy',
      'Riser Zoning Strategy',
      parameters.zoningStrategy,
      'AUTO_ZONED_VERTICAL | AUTO_PARALLEL_SPLIT | SINGLE_GRAVITY | MANUAL_ZONES',
    ],
    [
      'desiredDropperCount',
      'Desired Dropper Count',
      parameters.desiredDropperCount ?? '',
      'Blank = Auto',
    ],
    [
      'pipeHeaderCustomNominalMm',
      'Custom Roof Header Nominal (mm)',
      parameters.pipeHeaderCustomSize?.nominalSize ?? '',
      'Blank = Auto sizing',
    ],
    [
      'pipeHeaderCustomSpecId',
      'Custom Roof Header Pipe Spec',
      parameters.pipeHeaderCustomSize?.specId ?? '',
      'Blank = Primary pipe spec',
    ],
    [
      'designStandard',
      'Loading Unit & Flow Standard',
      getEffectiveStandard(parameters.standard),
      'BS_6700 | BS_EN_806_3',
    ],
    [
      'flowFormulaMode',
      'Flow Conversion Formula Mode',
      getEffectiveFlowFormula(parameters.flowFormula, parameters.standard).mode,
      `power | expression (${formatFlowFormulaDisplay(parameters.flowFormula, parameters.standard)})`,
    ],
    [
      'flowFormulaCoefficient',
      'Flow Formula Coefficient (a)',
      getEffectiveFlowFormula(parameters.flowFormula, parameters.standard).coefficient,
      'BS 6700: 0.0485 | BS EN 806-3: 0.05794 in Q = a * LU^b',
    ],
    [
      'flowFormulaExponent',
      'Flow Formula Exponent (b)',
      getEffectiveFlowFormula(parameters.flowFormula, parameters.standard).exponent,
      'BS 6700: 0.7162 | BS EN 806-3: 0.5924 in Q = a * LU^b',
    ],
    [
      'flowFormulaExpression',
      'Flow Formula Custom Expression',
      getEffectiveFlowFormula(parameters.flowFormula, parameters.standard).mode === 'expression'
        ? getEffectiveFlowFormula(parameters.flowFormula, parameters.standard).expression ??
          DEFAULT_FLOW_EXPRESSION
        : '',
      'Used when flowFormulaMode = expression',
    ],
    [
      'cavitationRatioLimit',
      'Cavitation Check Max P1/P2 Ratio',
      getEffectiveCavitationRatioLimit(parameters),
      'Default 3.0 (P1/P2 <= limit)',
    ],
  ];
  const wsConfig = XLSX.utils.aoa_to_sheet(configRows);
  wsConfig['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 42 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, wsConfig, 'Project Config');

  // 2. Floor Stack sheet
  const floorHeader = [
    'Order',
    'Floor ID',
    'Floor Level',
    'Floor Height (m)',
    'Supply Mode',
    'Loading Units (LU)',
    'PRV Rule',
    'Manual Dropper #',
    'Sub-Dropper Tap-Off ID',
    'Dropper PRV Overrides',
    'Dropper PRV Set Pressures (bar)',
    'Sub-Dropper PRV Overrides',
    'Sub-Dropper PRV Set Pressures (bar)',
    'Load Splits',
    'Appliance Counts',
  ];
  const floorRows = floors.map((f, idx) => [
    idx + 1,
    f.id,
    f.floorLabel,
    f.floorHeightM,
    f.supplyMode,
    f.loadingUnits,
    f.prvOverride,
    f.manualDropperIndex ?? '',
    f.subDropperId ?? '',
    serializeKeyValRecord(f.dropperPrvOverrides),
    serializeKeyValRecord(f.dropperPrvSetPressures),
    serializeKeyValRecord(f.subDropperPrvOverrides),
    serializeKeyValRecord(f.subDropperPrvSetPressures),
    serializeLoadSplits(f.loadSplits),
    serializeKeyValRecord(f.applianceCounts as Record<string, number> | undefined),
  ]);
  const wsFloors = XLSX.utils.aoa_to_sheet([floorHeader, ...floorRows]);
  for (let r = 1; r <= floorRows.length; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 3 });
    if (wsFloors[ref]) {
      wsFloors[ref].z = '0.00';
    }
  }
  wsFloors['!cols'] = [
    { wch: 8 },
    { wch: 20 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
    { wch: 22 },
    { wch: 24 },
    { wch: 28 },
    { wch: 26 },
    { wch: 30 },
    { wch: 32 },
    { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, wsFloors, 'Floor Stack');

  // 3. Sub-Droppers sheet
  const floorLabelById = new Map(floors.map((f) => [f.id, f.floorLabel]));
  const subDropperHeader = [
    'Sub-Dropper ID',
    'Label',
    'Parent Main Dropper #',
    'Branch Floor ID',
    'Branch Floor Level',
    'Has Booster Pump',
    'Booster Pressure (bar)',
  ];
  const subDropperRows = (parameters.subDroppers ?? []).map((sd) => [
    sd.id,
    sd.label,
    sd.parentDropperIndex,
    sd.branchFloorId,
    floorLabelById.get(sd.branchFloorId) ?? '',
    sd.hasBoosterPump ? 'TRUE' : 'FALSE',
    sd.boosterBoostBar ?? '',
  ]);
  const wsSubDroppers = XLSX.utils.aoa_to_sheet([subDropperHeader, ...subDropperRows]);
  wsSubDroppers['!cols'] = [
    { wch: 20 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSubDroppers, 'Sub-Droppers');

  // 4. Booster Overrides sheet
  const boosterIndices = Array.from(
    new Set([
      ...Object.keys(parameters.dropperBoosterOverrides ?? {}).map(Number),
      ...Object.keys(parameters.dropperBoosterPressures ?? {}).map(Number),
    ])
  )
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);

  const boosterHeader = ['Dropper #', 'Booster Mode', 'Booster Pressure (bar)'];
  const boosterRows = boosterIndices.map((dIdx) => {
    const modeOverride = parameters.dropperBoosterOverrides?.[dIdx];
    const modeLabel =
      modeOverride === true ? 'BOOSTER' : modeOverride === false ? 'GRAVITY' : 'AUTO';
    return [dIdx, modeLabel, parameters.dropperBoosterPressures?.[dIdx] ?? ''];
  });
  const wsBoosters = XLSX.utils.aoa_to_sheet([boosterHeader, ...boosterRows]);
  wsBoosters['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, wsBoosters, 'Booster Overrides');

  // 5. Pipe Size Exclusions sheet
  const exclusionHeader = [
    'Pipe Spec ID',
    'Material & Class',
    'Excluded Nominal Sizes (mm)',
  ];
  const exclusionRows = Object.values(PipeSpecId).map((specId) => {
    const spec = PIPE_SPEC_TABLES[specId];
    const excluded = parameters.excludedPipeSizes?.[specId] ?? [];
    return [
      specId,
      spec?.fullName ?? specId,
      excluded.length > 0 ? excluded.join(', ') : '',
    ];
  });
  const wsExclusions = XLSX.utils.aoa_to_sheet([exclusionHeader, ...exclusionRows]);
  wsExclusions['!cols'] = [{ wch: 18 }, { wch: 36 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, wsExclusions, 'Pipe Size Exclusions');

  // 6. Optional Calculation Snapshot sheet (read-only engineering summary)
  if (calcResult) {
    const snapshotRows: (string | number)[][] = [
      ['CALCULATION SNAPSHOT (READ-ONLY REFERENCE)'],
      ['Total Building LU', Number(calcResult.totalBuildingLu.toFixed(1))],
      ['Peak System Flow (L/s)', Number(calcResult.peakSystemFlowLs.toFixed(2))],
      ['Total Building Height (m)', Number(calcResult.totalBuildingHeightM.toFixed(2))],
      ['Max Static Head (bar)', Number(calcResult.maxStaticHeadBar.toFixed(2))],
      ['Main Droppers', calcResult.totalPhysicalDropperPipes],
      ['Sub-Droppers', calcResult.totalSubDropperPipes],
      ['PRV Stations', calcResult.prvList.length],
      [
        'Roof Pipe Header (mm)',
        calcResult.pipeHeader.nominalMm ?? '-',
      ],
      [],
      ['Dropper', 'Zone Type', 'Served Floors', 'Zone LU', 'Peak Q (L/s)', 'Header OD (mm)', 'PRVs'],
      ...calcResult.dropperSummaries.map((d) => [
        d.label,
        d.hasBoosterPump ? 'Booster' : 'Gravity',
        d.servedFloorRange,
        Number(d.totalZoneLu.toFixed(1)),
        Number(d.peakFlowRateLs.toFixed(2)),
        d.headerNominalMm ?? '-',
        d.prvCount,
      ]),
    ];
    const wsSnapshot = XLSX.utils.aoa_to_sheet(snapshotRows);
    const heightSnapRef = XLSX.utils.encode_cell({ r: 3, c: 1 });
    if (wsSnapshot[heightSnapRef]) {
      wsSnapshot[heightSnapRef].z = '0.00';
    }
    wsSnapshot['!cols'] = [
      { wch: 28 },
      { wch: 18 },
      { wch: 20 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSnapshot, 'Calculation Snapshot');
  }

  return wb;
}

/**
 * Export complete HydroDrop Calc project state to a multi-sheet Excel (.xlsx) file
 * suitable for lossless round-trip restoration via `importProjectFromExcel`.
 */
export function exportProjectToExcel(
  parameters: DesignParameters,
  floors: FloorInputRow[],
  calcResult?: SystemCalculationResult
): void {
  const wb = buildProjectWorkbook(parameters, floors, calcResult);
  const safeSlug =
    parameters.projectRef.replace(/[^a-zA-Z0-9_-]/g, '_') || 'HydroDrop';
  XLSX.writeFile(wb, `${safeSlug}_HydroDrop_Project.xlsx`);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export complete lossless HydroDrop Calc project state to a JSON template (.json)
 */
export function exportProjectToJson(
  parameters: DesignParameters,
  floors: FloorInputRow[]
): void {
  const safeSlug =
    parameters.projectRef.replace(/[^a-zA-Z0-9_-]/g, '_') || 'HydroDrop';
  const payload = {
    exportFormatVersion: '1.0',
    app: 'HydroDrop Calc',
    exportedAt: new Date().toISOString(),
    parameters: cloneParameters(parameters),
    floors: floors.map(cloneFloorRow),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  triggerBlobDownload(blob, `${safeSlug}_HydroDrop_Template.json`);
}

/**
 * Export plain-text tabular floor & hydraulic schedule as CSV (.csv)
 */
export function exportProjectToCsv(
  parameters: DesignParameters,
  floors: FloorInputRow[],
  calcResult?: SystemCalculationResult
): void {
  const safeSlug =
    parameters.projectRef.replace(/[^a-zA-Z0-9_-]/g, '_') || 'HydroDrop';
  const rowsById = new Map(
    (calcResult?.rows ?? []).map((r) => [r.input.id, r])
  );

  const header = [
    'Floor Level',
    'Floor Height (m)',
    'Supply Mode',
    'Loading Units (LU)',
    'Manual Dropper',
    'PRV Rule',
    'Static Head (m)',
    'Static Pressure (bar)',
    'Cum. LU (Active)',
    'Flow Rate Q (L/s)',
    'Pipe OD (mm)',
    'Inner Dia di (mm)',
    'Velocity V (m/s)',
    'Working Pressure (bar)',
  ];

  const lines = [
    header.map(escapeCsvCell).join(','),
    ...floors.map((f) => {
      const calcRow = rowsById.get(f.id);
      const supplyLabel =
        f.supplyMode === SupplyMode.ROOF_HEADER
          ? 'Roof Header'
          : f.supplyMode === SupplyMode.BOOSTER
          ? 'Booster'
          : 'Gravity';
      const prvLabel =
        f.prvOverride === PrvOverrideMode.FORCE_PRV
          ? 'Force PRV'
          : f.prvOverride === PrvOverrideMode.NO_PRV
          ? 'No PRV'
          : 'Auto';
      return [
        f.floorLabel,
        f.floorHeightM.toFixed(2),
        supplyLabel,
        f.loadingUnits,
        f.manualDropperIndex ?? '',
        prvLabel,
        calcRow ? calcRow.cumulativeHeadM.toFixed(2) : '',
        calcRow ? calcRow.staticPressureBar.toFixed(2) : '',
        calcRow && calcRow.primaryCumulativeLu > 0
          ? calcRow.primaryCumulativeLu.toFixed(1)
          : '',
        calcRow && calcRow.primaryFlowRateLs !== null && calcRow.primaryFlowRateLs > 0
          ? calcRow.primaryFlowRateLs.toFixed(2)
          : '',
        calcRow?.primaryNominalMm ?? '',
        calcRow && calcRow.primaryInnerMm !== null
          ? calcRow.primaryInnerMm.toFixed(1)
          : '',
        calcRow && calcRow.primaryVelocityMs !== null
          ? calcRow.primaryVelocityMs.toFixed(2)
          : '',
        calcRow && calcRow.primaryWorkingPressureBar !== null
          ? calcRow.primaryWorkingPressureBar.toFixed(2)
          : '',
      ]
        .map(escapeCsvCell)
        .join(',');
    }),
  ];

  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  triggerBlobDownload(blob, `${safeSlug}_HydroDrop_Schedule.csv`);
}

function getRowField(
  row: Record<string, unknown>,
  candidates: string[]
): unknown {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const exact = keys.find(
      (k) => k.trim().toLowerCase() === candidate.toLowerCase()
    );
    if (exact !== undefined) return row[exact];
  }
  return undefined;
}

function parseJsonTemplateContent(
  text: string,
  fallbackParameters?: DesignParameters
): ImportedProjectState {
  let rawObj: unknown;
  try {
    rawObj = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON project template file.');
  }

  if (!rawObj || typeof rawObj !== 'object') {
    throw new Error('JSON project template must contain a project object.');
  }

  const record = rawObj as Record<string, unknown>;
  const rawParams = record.parameters as Record<string, unknown> | undefined;
  const rawFloors = record.floors;

  if (!rawParams || typeof rawParams !== 'object' || !Array.isArray(rawFloors)) {
    throw new Error(
      'JSON template is missing required "parameters" or "floors" fields.'
    );
  }

  const baseDefaults = cloneParameters(
    fallbackParameters ?? BUILDING_PRESETS[0].parameters
  );
  const validSpecIds = new Set<string>(Object.values(PipeSpecId));
  const validZoningStrategies = new Set<string>(Object.values(ZoningStrategy));
  const validSupplyModes = new Set<string>(Object.values(SupplyMode));
  const validPrvModes = new Set<string>(Object.values(PrvOverrideMode));

  const pipeSpecId =
    typeof rawParams.pipeSpecId === 'string' && validSpecIds.has(rawParams.pipeSpecId)
      ? (rawParams.pipeSpecId as PipeSpecId)
      : baseDefaults.pipeSpecId;

  const optionalPipeSpecId =
    typeof rawParams.optionalPipeSpecId === 'string' &&
    validSpecIds.has(rawParams.optionalPipeSpecId)
      ? (rawParams.optionalPipeSpecId as PipeSpecId)
      : null;

  const zoningStrategy =
    typeof rawParams.zoningStrategy === 'string' &&
    validZoningStrategies.has(rawParams.zoningStrategy)
      ? (rawParams.zoningStrategy as ZoningStrategy)
      : baseDefaults.zoningStrategy;

  const numOrDefault = (val: unknown, fallback: number, allowZero = false): number => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    if (allowZero ? n < 0 : n <= 0) return fallback;
    return n;
  };

  const parameters: DesignParameters = cloneParameters({
    ...baseDefaults,
    ...(rawParams as Partial<DesignParameters>),
    projectName:
      typeof rawParams.projectName === 'string' && rawParams.projectName.trim()
        ? rawParams.projectName.trim()
        : baseDefaults.projectName,
    projectRef:
      typeof rawParams.projectRef === 'string' && rawParams.projectRef.trim()
        ? rawParams.projectRef.trim()
        : baseDefaults.projectRef,
    pipeSpecId,
    optionalPipeSpecId,
    maxVelocityMs: numOrDefault(rawParams.maxVelocityMs, baseDefaults.maxVelocityMs),
    maxStaticPressureBar: numOrDefault(
      rawParams.maxStaticPressureBar,
      baseDefaults.maxStaticPressureBar
    ),
    prvSetPressureBar: numOrDefault(
      rawParams.prvSetPressureBar,
      baseDefaults.prvSetPressureBar
    ),
    boosterPumpBoostBar: numOrDefault(
      rawParams.boosterPumpBoostBar,
      baseDefaults.boosterPumpBoostBar,
      true
    ),
    zoningStrategy,
    desiredDropperCount:
      typeof rawParams.desiredDropperCount === 'number' &&
      Number.isFinite(rawParams.desiredDropperCount) &&
      rawParams.desiredDropperCount >= 1
        ? Math.max(1, Math.min(24, Math.round(rawParams.desiredDropperCount)))
        : null,
    standard: parseDesignStandard(rawParams.standard) ?? baseDefaults.standard,
  });

  const floors: FloorInputRow[] = rawFloors
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((f, idx) => {
      const floorLabel =
        typeof f.floorLabel === 'string' && f.floorLabel.trim()
          ? f.floorLabel.trim()
          : `L${rawFloors.length - idx}`;
      const supplyMode =
        typeof f.supplyMode === 'string' && validSupplyModes.has(f.supplyMode)
          ? (f.supplyMode as SupplyMode)
          : SupplyMode.GRAVITY;
      const prvOverride =
        typeof f.prvOverride === 'string' && validPrvModes.has(f.prvOverride)
          ? (f.prvOverride as PrvOverrideMode)
          : PrvOverrideMode.AUTO;
      const rawHeight = Number(f.floorHeightM);
      const rawLu = Number(f.loadingUnits);

      return cloneFloorRow({
        ...(f as unknown as FloorInputRow),
        id:
          typeof f.id === 'string' && f.id.trim()
            ? f.id.trim()
            : `imp-json-${idx + 1}`,
        floorLabel,
        floorHeightM: Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 3.2,
        supplyMode,
        loadingUnits:
          supplyMode === SupplyMode.ROOF_HEADER
            ? 0
            : Number.isFinite(rawLu) && rawLu >= 0
            ? rawLu
            : 0,
        prvOverride,
      });
    });

  return {
    parameters,
    floors,
    sourceFormat: 'json-template',
  };
}

/**
 * Import a HydroDrop Calc project file (.xlsx / .csv / .json) and restore configuration,
 * floor stack, sub-droppers, pipe size exclusions, PRV & booster overrides.
 * Falls back to general floor spreadsheet import if the file is a plain floor schedule.
 */
export async function importProjectFromExcel(
  file: File,
  fallbackParameters?: DesignParameters
): Promise<ImportedProjectState> {
  if (file.name.toLowerCase().endsWith('.json')) {
    const text = await file.text();
    return parseJsonTemplateContent(text, fallbackParameters);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const sheetNameLookup = new Map(
    workbook.SheetNames.map((name) => [name.trim().toLowerCase(), name])
  );
  const configSheetName = sheetNameLookup.get('project config');
  const floorSheetName = sheetNameLookup.get('floor stack');

  if (configSheetName && floorSheetName) {
    const baseDefaults = cloneParameters(
      fallbackParameters ?? BUILDING_PRESETS[0].parameters
    );

    // 1. Parse Project Config
    const configSheet = workbook.Sheets[configSheetName];
    const rawConfigRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      configSheet,
      { defval: '' }
    );
    const configMap = new Map<string, unknown>();
    for (const row of rawConfigRows) {
      const keyRaw = getRowField(row, ['Parameter Key', 'Key', 'Parameter']);
      const valRaw = getRowField(row, ['Value', 'Val']);
      const key = String(keyRaw ?? '').trim();
      if (key) {
        configMap.set(key, valRaw);
      }
    }

    const validSpecIds = new Set<string>(Object.values(PipeSpecId));
    const validZoningStrategies = new Set<string>(Object.values(ZoningStrategy));

    const rawPipeSpec = String(configMap.get('pipeSpecId') ?? '').trim();
    const pipeSpecId = validSpecIds.has(rawPipeSpec)
      ? (rawPipeSpec as PipeSpecId)
      : baseDefaults.pipeSpecId;

    const rawOptSpec = String(configMap.get('optionalPipeSpecId') ?? '').trim();
    const optionalPipeSpecId =
      rawOptSpec && validSpecIds.has(rawOptSpec)
        ? (rawOptSpec as PipeSpecId)
        : null;

    const parsedMaxVel = Number(configMap.get('maxVelocityMs'));
    const maxVelocityMs =
      Number.isFinite(parsedMaxVel) && parsedMaxVel > 0
        ? parsedMaxVel
        : baseDefaults.maxVelocityMs;

    const parsedMaxP = Number(configMap.get('maxStaticPressureBar'));
    const maxStaticPressureBar =
      Number.isFinite(parsedMaxP) && parsedMaxP > 0
        ? parsedMaxP
        : baseDefaults.maxStaticPressureBar;

    const parsedPrvP = Number(configMap.get('prvSetPressureBar'));
    const prvSetPressureBar =
      Number.isFinite(parsedPrvP) && parsedPrvP > 0
        ? parsedPrvP
        : baseDefaults.prvSetPressureBar;

    const rawBoostP = configMap.get('boosterPumpBoostBar');
    const parsedBoostP = Number(rawBoostP);
    const boosterPumpBoostBar =
      rawBoostP !== '' && Number.isFinite(parsedBoostP) && parsedBoostP >= 0
        ? parsedBoostP
        : baseDefaults.boosterPumpBoostBar;

    const rawZoning = String(configMap.get('zoningStrategy') ?? '').trim();
    const zoningStrategy = validZoningStrategies.has(rawZoning)
      ? (rawZoning as ZoningStrategy)
      : baseDefaults.zoningStrategy;

    const rawDesiredCount = String(
      configMap.get('desiredDropperCount') ?? ''
    ).trim();
    let desiredDropperCount: number | null = null;
    if (rawDesiredCount && rawDesiredCount.toLowerCase() !== 'auto') {
      const parsedCount = parseInt(rawDesiredCount, 10);
      if (Number.isFinite(parsedCount) && parsedCount >= 1) {
        desiredDropperCount = Math.max(1, Math.min(24, parsedCount));
      }
    }

    const rawHeaderNom = String(
      configMap.get('pipeHeaderCustomNominalMm') ?? ''
    ).trim();
    const rawHeaderSpec = String(
      configMap.get('pipeHeaderCustomSpecId') ?? ''
    ).trim();
    let pipeHeaderCustomSize: PipeHeaderCustomSize | null = null;
    if (rawHeaderNom && rawHeaderNom.toLowerCase() !== 'auto') {
      const nom = Number(rawHeaderNom);
      if (Number.isFinite(nom) && nom > 0) {
        pipeHeaderCustomSize = {
          nominalSize: nom,
          ...(rawHeaderSpec && validSpecIds.has(rawHeaderSpec)
            ? { specId: rawHeaderSpec as PipeSpecId }
            : {}),
        };
      }
    }

    const projectName =
      String(configMap.get('projectName') ?? '').trim() ||
      baseDefaults.projectName;
    const projectRef =
      String(configMap.get('projectRef') ?? configMap.get('jobNo') ?? '').trim() ||
      baseDefaults.projectRef;

    const parsedStandard = parseDesignStandard(configMap.get('designStandard'));
    const stdDefaultFormula = getDefaultFlowFormulaForStandard(parsedStandard);

    const rawFormulaMode = String(configMap.get('flowFormulaMode') ?? '')
      .trim()
      .toLowerCase();
    const parsedCoeff = Number(configMap.get('flowFormulaCoefficient'));
    const parsedExp = Number(configMap.get('flowFormulaExponent'));
    const rawFormulaExpr = String(configMap.get('flowFormulaExpression') ?? '').trim();

    let flowFormula: FlowConversionFormula | undefined;
    if (
      rawFormulaMode === 'expression' &&
      rawFormulaExpr &&
      validateFlowExpression(rawFormulaExpr).valid
    ) {
      flowFormula = {
        mode: 'expression',
        coefficient:
          Number.isFinite(parsedCoeff) && parsedCoeff > 0
            ? parsedCoeff
            : stdDefaultFormula.coefficient,
        exponent:
          Number.isFinite(parsedExp) && parsedExp > 0
            ? parsedExp
            : stdDefaultFormula.exponent,
        expression: rawFormulaExpr,
      };
    } else if (
      (Number.isFinite(parsedCoeff) && parsedCoeff > 0) ||
      (Number.isFinite(parsedExp) && parsedExp > 0)
    ) {
      const candidate: FlowConversionFormula = {
        mode: 'power',
        coefficient:
          Number.isFinite(parsedCoeff) && parsedCoeff > 0
            ? parsedCoeff
            : stdDefaultFormula.coefficient,
        exponent:
          Number.isFinite(parsedExp) && parsedExp > 0
            ? parsedExp
            : stdDefaultFormula.exponent,
      };
      if (!isDefaultFlowFormula(candidate, parsedStandard)) {
        flowFormula = candidate;
      }
    }

    const parsedCavLimit = Number(configMap.get('cavitationRatioLimit'));
    const cavitationRatioLimit =
      Number.isFinite(parsedCavLimit) && parsedCavLimit >= 1.0 && !isDefaultCavitationRatioLimit(parsedCavLimit)
        ? Math.round(parsedCavLimit * 100) / 100
        : undefined;

    // 2. Parse Floor Stack
    const floorSheet = workbook.Sheets[floorSheetName];
    const rawFloorRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      floorSheet,
      { defval: '' }
    );
    const floors: FloorInputRow[] = [];
    const seenIds = new Set<string>();

    rawFloorRows.forEach((raw, idx) => {
      const rawLabel = String(
        getRowField(raw, ['Floor Level', 'Level', 'Floor']) ?? ''
      ).trim();
      const rawId = String(getRowField(raw, ['Floor ID', 'ID']) ?? '').trim();
      if (!rawLabel && !rawId) return;

      let floorId = rawId || `imp-floor-${idx + 1}`;
      while (seenIds.has(floorId)) {
        floorId = `${floorId}-${idx + 1}`;
      }
      seenIds.add(floorId);

      const floorLabel = rawLabel || `L${rawFloorRows.length - idx}`;
      const rawHeight = Number(
        getRowField(raw, ['Floor Height (m)', 'Height (m)', 'Height'])
      );
      const floorHeightM =
        Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 3.2;

      const supplyMode = parseSupplyMode(
        getRowField(raw, ['Supply Mode', 'Mode']),
        floorLabel
      );

      const rawLu = Number(
        getRowField(raw, ['Loading Units (LU)', 'Loading Units', 'LU'])
      );
      const loadingUnits =
        supplyMode === SupplyMode.ROOF_HEADER
          ? 0
          : Number.isFinite(rawLu) && rawLu >= 0
          ? rawLu
          : 0;

      const rawPrvRule = String(
        getRowField(raw, ['PRV Rule', 'PRV Override']) ?? ''
      );
      const prvOverride =
        parsePrvOverrideModeValue(rawPrvRule) ?? PrvOverrideMode.AUTO;

      const rawManualDropper = String(
        getRowField(raw, ['Manual Dropper #', 'Manual Dropper']) ?? ''
      ).trim();
      const parsedManualDropper = rawManualDropper
        ? parseInt(rawManualDropper, 10)
        : NaN;
      const manualDropperIndex =
        Number.isFinite(parsedManualDropper) && parsedManualDropper >= 1
          ? parsedManualDropper
          : undefined;

      const rawSubDropperId = String(
        getRowField(raw, ['Sub-Dropper Tap-Off ID', 'Sub-Dropper ID']) ?? ''
      ).trim();

      const dropperPrvOverrides = parseDropperPrvOverrides(
        getRowField(raw, ['Dropper PRV Overrides'])
      );
      const dropperPrvSetPressures = parseDropperNumberRecord(
        getRowField(raw, ['Dropper PRV Set Pressures (bar)'])
      );
      const subDropperPrvOverrides = parseSubDropperPrvOverrides(
        getRowField(raw, ['Sub-Dropper PRV Overrides'])
      );
      const subDropperPrvSetPressures = parseSubDropperNumberRecord(
        getRowField(raw, ['Sub-Dropper PRV Set Pressures (bar)'])
      );
      const loadSplits = parseLoadSplits(getRowField(raw, ['Load Splits']));
      const applianceCounts = parseApplianceCounts(getRowField(raw, ['Appliance Counts']));

      const rowObj: FloorInputRow = {
        id: floorId,
        floorLabel,
        floorHeightM,
        supplyMode,
        loadingUnits,
        prvOverride,
        ...(manualDropperIndex !== undefined ? { manualDropperIndex } : {}),
        ...(rawSubDropperId ? { subDropperId: rawSubDropperId } : {}),
        ...(dropperPrvOverrides ? { dropperPrvOverrides } : {}),
        ...(dropperPrvSetPressures ? { dropperPrvSetPressures } : {}),
        ...(subDropperPrvOverrides ? { subDropperPrvOverrides } : {}),
        ...(subDropperPrvSetPressures ? { subDropperPrvSetPressures } : {}),
        ...(loadSplits ? { loadSplits } : {}),
        ...(applianceCounts ? { applianceCounts } : {}),
      };
      floors.push(rowObj);
    });

    // 3. Parse Sub-Droppers sheet
    const subDroppersSheetName = sheetNameLookup.get('sub-droppers');
    let subDroppers: SubDropperConfig[] | undefined;
    if (subDroppersSheetName) {
      const sdSheet = workbook.Sheets[subDroppersSheetName];
      const rawSdRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        sdSheet,
        { defval: '' }
      );
      const validFloorIds = new Set(floors.map((f) => f.id));
      const fallbackBranchFloorId =
        floors.find((f) => f.supplyMode !== SupplyMode.ROOF_HEADER)?.id ??
        floors[0]?.id ??
        '';
      const parsedSds: SubDropperConfig[] = [];

      for (const raw of rawSdRows) {
        const id = String(
          getRowField(raw, ['Sub-Dropper ID', 'ID']) ?? ''
        ).trim();
        const label = String(getRowField(raw, ['Label']) ?? '').trim();
        if (!id || !label) continue;

        const parentNum = parseInt(
          String(
            getRowField(raw, ['Parent Main Dropper #', 'Parent Dropper']) ?? '1'
          ),
          10
        );
        const parentDropperIndex =
          Number.isFinite(parentNum) && parentNum >= 1 ? parentNum : 1;

        const rawBranchId = String(
          getRowField(raw, ['Branch Floor ID']) ?? ''
        ).trim();
        const branchFloorId = validFloorIds.has(rawBranchId)
          ? rawBranchId
          : fallbackBranchFloorId;

        const hasBoosterPump = parseBooleanFlag(
          getRowField(raw, ['Has Booster Pump'])
        );
        const rawBoostBar = String(
          getRowField(raw, ['Booster Pressure (bar)']) ?? ''
        ).trim();
        const parsedBoostBar = rawBoostBar ? parseFloat(rawBoostBar) : NaN;

        const sd: SubDropperConfig = {
          id,
          label,
          parentDropperIndex,
          branchFloorId,
          ...(hasBoosterPump ? { hasBoosterPump: true } : {}),
          ...(hasBoosterPump &&
          Number.isFinite(parsedBoostBar) &&
          parsedBoostBar > 0
            ? { boosterBoostBar: parsedBoostBar }
            : {}),
        };
        parsedSds.push(sd);
      }

      if (parsedSds.length > 0) {
        subDroppers = parsedSds;
      }
    }

    // 4. Parse Booster Overrides sheet
    const boosterSheetName = sheetNameLookup.get('booster overrides');
    let dropperBoosterOverrides: Record<number, boolean> | undefined;
    let dropperBoosterPressures: Record<number, number> | undefined;
    if (boosterSheetName) {
      const bSheet = workbook.Sheets[boosterSheetName];
      const rawBoosterRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        bSheet,
        { defval: '' }
      );
      const ovMap: Record<number, boolean> = {};
      const pMap: Record<number, number> = {};

      for (const raw of rawBoosterRows) {
        const dIdx = parseInt(
          String(getRowField(raw, ['Dropper #', 'Dropper']) ?? ''),
          10
        );
        if (!Number.isFinite(dIdx) || dIdx < 1) continue;

        const modeStr = String(
          getRowField(raw, ['Booster Mode', 'Mode']) ?? ''
        )
          .trim()
          .toUpperCase();
        if (modeStr === 'BOOSTER' || modeStr === 'TRUE') {
          ovMap[dIdx] = true;
        } else if (modeStr === 'GRAVITY' || modeStr === 'FALSE') {
          ovMap[dIdx] = false;
        }

        const rawPressure = String(
          getRowField(raw, ['Booster Pressure (bar)']) ?? ''
        ).trim();
        const parsedPressure = rawPressure ? parseFloat(rawPressure) : NaN;
        if (Number.isFinite(parsedPressure) && parsedPressure > 0) {
          pMap[dIdx] = parsedPressure;
        }
      }

      if (Object.keys(ovMap).length > 0) {
        dropperBoosterOverrides = ovMap;
      }
      if (Object.keys(pMap).length > 0) {
        dropperBoosterPressures = pMap;
      }
    }

    // 5. Parse Pipe Size Exclusions sheet
    const exclusionsSheetName = sheetNameLookup.get('pipe size exclusions');
    let excludedPipeSizes: Partial<Record<PipeSpecId, number[]>> | undefined;
    if (exclusionsSheetName) {
      const exSheet = workbook.Sheets[exclusionsSheetName];
      const rawExRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        exSheet,
        { defval: '' }
      );
      const exMap: Partial<Record<PipeSpecId, number[]>> = {};

      for (const raw of rawExRows) {
        const specIdStr = String(
          getRowField(raw, ['Pipe Spec ID', 'Spec ID']) ?? ''
        ).trim();
        if (!validSpecIds.has(specIdStr)) continue;
        const specId = specIdStr as PipeSpecId;
        const rawSizes = getRowField(raw, [
          'Excluded Nominal Sizes (mm)',
          'Excluded Sizes',
        ]);

        let nums: number[] = [];
        if (typeof rawSizes === 'number') {
          if (Number.isFinite(rawSizes) && rawSizes > 0) nums = [rawSizes];
        } else {
          const str = String(rawSizes ?? '').trim();
          if (str) {
            nums = str
              .split(/[,;\s]+/)
              .map((token) => Number(token.trim()))
              .filter((n) => Number.isFinite(n) && n > 0);
          }
        }

        if (nums.length > 0) {
          exMap[specId] = Array.from(new Set(nums)).sort((a, b) => a - b);
        }
      }

      if (Object.keys(exMap).length > 0) {
        excludedPipeSizes = exMap;
      }
    }

    const parameters: DesignParameters = {
      projectName,
      projectRef,
      pipeSpecId,
      optionalPipeSpecId,
      maxVelocityMs,
      maxStaticPressureBar,
      prvSetPressureBar,
      boosterPumpBoostBar,
      zoningStrategy,
      desiredDropperCount,
      ...(subDroppers ? { subDroppers } : {}),
      ...(dropperBoosterOverrides ? { dropperBoosterOverrides } : {}),
      ...(dropperBoosterPressures ? { dropperBoosterPressures } : {}),
      pipeHeaderCustomSize,
      ...(excludedPipeSizes ? { excludedPipeSizes } : {}),
      ...(flowFormula ? { flowFormula } : {}),
      ...(cavitationRatioLimit !== undefined ? { cavitationRatioLimit } : {}),
      ...(parsedStandard && parsedStandard !== DesignStandard.BS_6700
        ? { standard: parsedStandard }
        : {}),
    };

    return {
      parameters,
      floors,
      sourceFormat: 'full-project',
    };
  }

  // Fallback: Parse as a plain floor spreadsheet (.xlsx / .xls / .csv)
  const importedFloors = await parseImportedFloorFile(file);
  const baseParams = cloneParameters(
    fallbackParameters ?? BUILDING_PRESETS[0].parameters
  );
  // Clear preset-specific sub-dropper/booster overrides when importing an external floor-only table
  delete baseParams.subDroppers;
  delete baseParams.dropperBoosterOverrides;
  delete baseParams.dropperBoosterPressures;
  baseParams.pipeHeaderCustomSize = null;

  return {
    parameters: baseParams,
    floors: importedFloors,
    sourceFormat: 'floor-list-fallback',
  };
}

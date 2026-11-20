export enum PipeSpecId {
  PPR_PN16 = 'PPR_PN16',
  PPR_PN20 = 'PPR_PN20',
  UPVC_CLASS_E = 'UPVC_CLASS_E',
  UPVC_CLASS_7 = 'UPVC_CLASS_7',
  HDPE_PN12_5 = 'HDPE_PN12_5',
  HDPE_PN16 = 'HDPE_PN16',
  MSCL = 'MSCL',
  SS_10S = 'SS_10S',
  SS_40S = 'SS_40S',
}

export enum SupplyMode {
  ROOF_HEADER = 'ROOF_HEADER',
  BOOSTER = 'BOOSTER',
  GRAVITY = 'GRAVITY',
}

export enum ZoningStrategy {
  AUTO_ZONED_VERTICAL = 'AUTO_ZONED_VERTICAL',
  AUTO_PARALLEL_SPLIT = 'AUTO_PARALLEL_SPLIT',
  SINGLE_GRAVITY = 'SINGLE_GRAVITY',
  MANUAL_ZONES = 'MANUAL_ZONES',
}

export enum PrvOverrideMode {
  AUTO = 'AUTO',
  FORCE_PRV = 'FORCE_PRV',
  NO_PRV = 'NO_PRV',
}

export enum DesignStandard {
  BS_6700 = 'BS_6700',
  BS_EN_806_3 = 'BS_EN_806_3',
}

export type ApplianceId =
  | 'washbasin'
  | 'bidet'
  | 'wc_cistern'
  | 'shower_head'
  | 'domestic_sink'
  | 'washing_machine'
  | 'domestic_bath'
  | 'taps_garden_garage'
  | 'urinal_flush_valve'
  | 'non_domestic_sink'
  | 'non_domestic_bath'
  | 'wc_flush_valve';

export type ApplianceCounts = Partial<Record<ApplianceId, number>>;

export interface ApplianceLoadingUnitSpec {
  id: ApplianceId;
  name: string;
  bs6700Lu: number;
  bsEn806Lu: number;
}

export interface PipeSizeEntry {
  nominalSize: number;
  outerDiameter: number;
  wallThickness: number | null;
  innerDiameter: number | null;
}

export interface PipeSpecificationTable {
  id: PipeSpecId;
  materialFamily: 'PP-R' | 'uPVC' | 'HDPE PE100' | 'MSCL' | 'Stainless Steel';
  className: string;
  fullName: string;
  shortName?: string;
  dimDecimals?: 1 | 2;
  pressureRatingBar: number;
  sizes: PipeSizeEntry[];
}

export interface SubDropperConfig {
  id: string;
  label: string; // e.g. "SD1"
  parentDropperIndex: number; // 1-based main dropper feeding this sub-dropper
  branchFloorId: string; // Floor ID where this sub-dropper branches off the main dropper
  hasBoosterPump?: boolean; // Optional inline booster pump installed at the sub-dropper branch takeoff
  boosterBoostBar?: number; // Optional per-sub-dropper booster pressure override (bar); defaults to global boosterPumpBoostBar
}

export type RiserTarget =
  | { kind: 'main'; dropperIndex: number }
  | { kind: 'sub'; subDropperId: string };

export interface FloorRiserAllocation {
  target: RiserTarget;
  loadingUnits: number;
}

export interface FloorRiserAllocationResult {
  target: RiserTarget;
  riserLabel: string; // e.g., "D2" or "SD1"
  assignedLu: number;
  loadFraction: number; // 0..1
  cumulativeLu: number;
  flowRateLs: number;
  nominalMm: number | null;
  innerMm: number | null;
  specId: PipeSpecId;
  isFallbackMaterial: boolean;
  velocityMs: number | null;
  workingPressureBar: number | null;
  hasPrv: boolean;
}

export interface FloorInputRow {
  id: string;
  floorLabel: string;
  floorHeightM: number;
  supplyMode: SupplyMode;
  loadingUnits: number;
  prvOverride: PrvOverrideMode;
  manualDropperIndex?: number; // 1-based dropper assignment when using MANUAL_ZONES
  dropperPrvOverrides?: Record<number, PrvOverrideMode>; // Per-dropper PRV override keyed by 1-based dropperIndex (supports express pass-through PRVs)
  dropperPrvSetPressures?: Record<number, number>; // Per-dropper PRV downstream set pressure P2 (bar) keyed by 1-based dropperIndex
  subDropperId?: string | null; // Optional redirection of this floor's supply tap-off to a sub-dropper
  subDropperPrvOverrides?: Record<string, PrvOverrideMode>; // Per-sub-dropper PRV override keyed by SubDropperConfig.id
  subDropperPrvSetPressures?: Record<string, number>; // Per-sub-dropper PRV downstream set pressure P2 (bar) keyed by SubDropperConfig.id
  loadSplits?: FloorRiserAllocation[]; // Optional multi-riser load distribution overriding single-riser assignment
  applianceCounts?: ApplianceCounts; // Optional appliance fixture quantities used to compute loadingUnits for active standard
}

export interface FlowConversionFormula {
  mode: 'power' | 'expression';
  coefficient: number; // Default 0.0485 (Q = coefficient * LU^exponent)
  exponent: number; // Default 0.7162
  expression?: string; // Custom mathematical expression in LU when mode === 'expression'
}

export interface PipeHeaderCustomSize {
  nominalSize: number;
  specId?: PipeSpecId; // Defaults to active primary pipeSpecId; may also target optionalPipeSpecId
}

export interface DesignParameters {
  projectName: string;
  projectRef: string;
  pipeSpecId: PipeSpecId;
  optionalPipeSpecId?: PipeSpecId | null;
  maxVelocityMs: number;
  maxStaticPressureBar: number;
  prvSetPressureBar: number;
  boosterPumpBoostBar: number;
  zoningStrategy: ZoningStrategy;
  desiredDropperCount?: number | null;
  subDroppers?: SubDropperConfig[];
  dropperBoosterOverrides?: Record<number, boolean>; // Per-main-dropper booster pump assignment (true = Booster, false = Gravity) keyed by 1-based dropperIndex
  dropperBoosterPressures?: Record<number, number>; // Per-main-dropper booster pressure override (bar) keyed by 1-based dropperIndex; defaults to global boosterPumpBoostBar
  pipeHeaderCustomSize?: PipeHeaderCustomSize | null; // Optional manual nominal pipe size override for the common Roof Pipe Header
  excludedPipeSizes?: Partial<Record<PipeSpecId, number[]>>; // Per-spec list of excluded nominal pipe sizes (mm) omitted from project sizing
  flowFormula?: FlowConversionFormula; // Optional custom LU -> Q (L/s) conversion formula; defaults to active standard formula
  cavitationRatioLimit?: number; // Max allowable P1/P2 ratio before cavitation warning; defaults to 3.0
  standard?: DesignStandard; // Active loading unit & flow conversion standard (defaults to BS_6700)
}

export interface PrvInstallationDetail {
  floorId: string;
  floorLabel: string;
  dropperIndex: number; // Main dropper index (or parent dropper index for sub-dropper PRVs)
  subDropperId?: string; // Present when PRV is installed on a sub-dropper
  dropperName: string;
  upstreamPressureBar: number; // P1
  downstreamPressureBar: number; // P2
  deltaPressureBar: number; // P2 - P1 (negative)
  pressureRatio: number; // P1 / P2
  cavitationWarning: boolean; // P1 / P2 > 3.0
  flowRateLs: number;
  recommendedValveDn: number;
  isManualOverride: boolean;
  isCustomSetPressure: boolean;
}

export interface DropperCellResult {
  dropperIndex: number; // 1-based (1st, 2nd, 3rd, 4th...)
  isServed: boolean; // True if this floor's fixtures draw from this dropper
  isExpressPassThrough: boolean; // True if pipe passes unbranched from roof down to lower zone
  assignedFloorLu: number; // Floor loading units drawn directly from this dropper at this level
  loadFraction: number; // 1.0 for full tap-off, (0 < f < 1) for split/fractional tap-off, 0 if unserved
  isSplitLoad: boolean; // True when this floor's load is divided across multiple risers
  workingPressureBar: number | null; // Working pressure on served floors (or header)
  pipePressureBar?: number | null; // Actual hydraulic pressure inside riser at this elevation (served or pass-through)
  unreducedPressureBar: number | null; // Pressure immediately before PRV if PRV installed here
  cumulativeLu: number; // Per-pipe cumulative LU at this elevation
  flowRateLs: number; // Per-pipe Q (L/s) at this elevation
  selectedNominalMm: number | null;
  selectedOuterMm: number | null;
  selectedInnerMm: number | null;
  selectedSpecId: PipeSpecId;
  isFallbackMaterial: boolean;
  requiredInnerDiaMm: number | null;
  velocityMs: number | null;
  exceedsMaxPipeCapacity: boolean;
  hasPrv: boolean;
  prvDetail?: PrvInstallationDetail;
  subDropperBranchCount?: number; // Number of sub-droppers tapping off at this row
}

export interface SubDropperCellResult {
  subDropperId: string;
  parentDropperIndex: number;
  isServed: boolean;
  isBranchJunction: boolean; // True at the branchFloorId row where sub-dropper taps off main dropper
  isExpressPassThrough: boolean; // True on unserved intermediate/junction segments of the sub-dropper
  assignedFloorLu: number; // Floor loading units drawn directly from this sub-dropper at this level
  loadFraction: number; // 1.0 for full tap-off, (0 < f < 1) for split/fractional tap-off, 0 if unserved
  isSplitLoad: boolean; // True when this floor's load is divided across multiple risers
  flowDirection: 'up' | 'down' | 'junction';
  workingPressureBar: number | null;
  pipePressureBar?: number | null; // Actual hydraulic pressure inside sub-dropper at this elevation
  parentBranchArrivalBar?: number | null; // Parent riser pressure arriving at branch junction before pump/PRV
  unreducedPressureBar: number | null;
  cumulativeLu: number;
  flowRateLs: number;
  selectedNominalMm: number | null;
  selectedOuterMm: number | null;
  selectedInnerMm: number | null;
  selectedSpecId: PipeSpecId;
  isFallbackMaterial: boolean;
  requiredInnerDiaMm: number | null;
  velocityMs: number | null;
  exceedsMaxPipeCapacity: boolean;
  hasPrv: boolean;
  prvDetail?: PrvInstallationDetail;
}

export interface CalculatedFloorRow {
  input: FloorInputRow;
  rowIndex: number;
  cumulativeHeadM: number;
  staticPressureBar: number;
  equipmentTag: 'Pump' | 'Gravity' | 'PRV' | '';
  boostedRiserLabels?: string[];
  boostedRiserDetails?: Array<{ label: string; boostBar: number; isCustom: boolean }>;
  primaryDropperIndex: number | null;
  primarySubDropperId: string | null;
  primaryFlowRateLs: number | null;
  primaryDeltaPBar: number | null;
  primaryPrvRatio: number | null;
  primaryCumulativeLu: number;
  primaryNominalMm: number | null;
  primaryInnerMm: number | null;
  primarySpecId: PipeSpecId;
  primaryIsFallbackMaterial: boolean;
  primaryVelocityMs: number | null;
  primaryWorkingPressureBar: number | null;
  isSplitFloor: boolean;
  servedRiserCount: number;
  riserAllocations: FloorRiserAllocationResult[];
  dropperCells: Record<number, DropperCellResult>;
  subDropperCells: Record<string, SubDropperCellResult>;
}

export interface DropperZoneSummary {
  dropperIndex: number;
  label: string; // e.g., "D1"
  zoneType: 'Booster' | 'Gravity';
  hasBoosterPump: boolean;
  boosterPressureBar: number | null;
  isCustomBoosterPressure: boolean;
  parallelCount: number; // >1 if parallel split risers represent N identical pipes
  servedFloorRange: string; // e.g., "L31 – L28"
  servedFloorCount: number;
  splitFloorCount: number; // Number of served floors with fractional/split tap-offs
  totalZoneLu: number; // Per single riser pipe (including attached sub-droppers)
  peakFlowRateLs: number; // Per single riser pipe
  headerNominalMm: number | null;
  headerInnerMm: number | null;
  headerSpecId: PipeSpecId;
  headerIsFallbackMaterial: boolean;
  usesFallbackMaterial: boolean;
  maxRequiredInnerDiaMm: number | null;
  minNominalMm: number | null;
  peakVelocityMs: number | null;
  minWorkingPressureBar: number | null;
  maxWorkingPressureBar: number | null;
  prvCount: number;
  exceedsCapacity: boolean;
  cavitationRiskCount: number;
  attachedSubDropperIds: string[];
}

export interface SubDropperSummary {
  id: string;
  label: string;
  parentDropperIndex: number;
  parentDropperLabel: string;
  branchFloorId: string;
  branchFloorLabel: string;
  branchRowIdx: number;
  zoneType: 'Booster' | 'Gravity';
  hasBoosterPump: boolean;
  boosterPressureBar: number | null;
  isCustomBoosterPressure: boolean;
  flowOrientation: 'Up-Feed' | 'Down-Feed' | 'Bidirectional' | 'Single-Floor' | 'Unassigned';
  servedFloorRange: string;
  servedFloorCount: number;
  splitFloorCount: number;
  totalZoneLu: number;
  peakFlowRateLs: number;
  baseNominalMm: number | null;
  baseInnerMm: number | null;
  baseSpecId: PipeSpecId;
  baseIsFallbackMaterial: boolean;
  usesFallbackMaterial: boolean;
  maxRequiredInnerDiaMm: number | null;
  terminalNominalMm: number | null;
  peakVelocityMs: number | null;
  minWorkingPressureBar: number | null;
  maxWorkingPressureBar: number | null;
  prvCount: number;
  exceedsCapacity: boolean;
  cavitationRiskCount: number;
}

export interface PipeHeaderSummary {
  totalLu: number;
  flowRateLs: number;
  maxVelocityMs: number; // Pipe Header velocity limit = max(0.1, V_global,max - 0.5 m/s)
  nominalMm: number | null;
  outerMm: number | null;
  innerMm: number | null;
  specId: PipeSpecId;
  isFallbackMaterial: boolean;
  requiredInnerDiaMm: number | null;
  velocityMs: number | null;
  exceedsMaxCapacity: boolean;
  isCustomSize: boolean;
  autoNominalMm: number | null;
  autoSpecId: PipeSpecId;
  autoIsFallbackMaterial: boolean;
  autoVelocityMs: number | null;
  connectedDropperCount: number;
}

export interface SystemCalculationResult {
  parameters: DesignParameters;
  pipeSpec: PipeSpecificationTable;
  optionalPipeSpec: PipeSpecificationTable | null;
  maxSinglePipeCapacityLs: number;
  maxSinglePipeCapacityLu: number;
  maxOptionalPipeCapacityLs: number | null;
  maxOptionalPipeCapacityLu: number | null;
  usesFallbackMaterial: boolean;
  rows: CalculatedFloorRow[];
  dropperSummaries: DropperZoneSummary[];
  subDropperSummaries: SubDropperSummary[];
  prvList: PrvInstallationDetail[];
  pipeHeader: PipeHeaderSummary;
  totalPhysicalDropperPipes: number;
  totalSubDropperPipes: number;
  boosterDropperPipes: number;
  boosterSubDropperPipes: number;
  gravityDropperPipes: number;
  splitFloorCount: number;
  totalBuildingLu: number; // Excluding roof header display-only sum
  peakSystemFlowLs: number;
  overallMaxVelocityMs: number;
  overallMaxWorkingPressureBar: number;
  totalBuildingHeightM: number;
  maxStaticHeadBar: number;
  warnings: string[];
}


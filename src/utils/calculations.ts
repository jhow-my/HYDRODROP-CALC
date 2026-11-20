import {
  formatPipeDim,
  getPipeSpecBadgeLabel,
  PIPE_SPEC_TABLES,
  STANDARD_PRV_DN_SIZES,
} from '../data/pipeSpecs';
import {
  ApplianceCounts,
  CalculatedFloorRow,
  DesignParameters,
  DesignStandard,
  DropperCellResult,
  DropperZoneSummary,
  FloorInputRow,
  FloorRiserAllocation,
  FloorRiserAllocationResult,
  FlowConversionFormula,
  PipeHeaderSummary,
  PipeSizeEntry,
  PipeSpecId,
  PipeSpecificationTable,
  PrvInstallationDetail,
  PrvOverrideMode,
  RiserTarget,
  SubDropperCellResult,
  SubDropperConfig,
  SubDropperSummary,
  SupplyMode,
  SystemCalculationResult,
  ZoningStrategy,
} from '../types/hydraulics';

export const GRAVITY_BAR_PER_METER = 0.0981;
export const PIPE_HEADER_VELOCITY_OFFSET_MS = 0.5;

export const BS_6700_FLOW_COEFFICIENT = 0.0485;
export const BS_6700_FLOW_EXPONENT = 0.7162;
export const BS_6700_FLOW_EXPRESSION = '0.0485 * LU^0.7162';

export const BS_EN_806_3_FLOW_COEFFICIENT = 0.05794;
export const BS_EN_806_3_FLOW_EXPONENT = 0.5924;
export const BS_EN_806_3_FLOW_EXPRESSION = '0.05794 * LU^0.5924';

export const DEFAULT_FLOW_COEFFICIENT = BS_6700_FLOW_COEFFICIENT;
export const DEFAULT_FLOW_EXPONENT = BS_6700_FLOW_EXPONENT;
export const DEFAULT_FLOW_EXPRESSION = BS_6700_FLOW_EXPRESSION;
export const DEFAULT_CAVITATION_RATIO_LIMIT = 3.0;

export function getEffectiveStandard(standard?: DesignStandard): DesignStandard {
  return standard === DesignStandard.BS_EN_806_3
    ? DesignStandard.BS_EN_806_3
    : DesignStandard.BS_6700;
}

export function getDefaultFlowFormulaForStandard(standard?: DesignStandard): {
  mode: 'power';
  coefficient: number;
  exponent: number;
  expression: string;
} {
  if (getEffectiveStandard(standard) === DesignStandard.BS_EN_806_3) {
    return {
      mode: 'power',
      coefficient: BS_EN_806_3_FLOW_COEFFICIENT,
      exponent: BS_EN_806_3_FLOW_EXPONENT,
      expression: BS_EN_806_3_FLOW_EXPRESSION,
    };
  }
  return {
    mode: 'power',
    coefficient: BS_6700_FLOW_COEFFICIENT,
    exponent: BS_6700_FLOW_EXPONENT,
    expression: BS_6700_FLOW_EXPRESSION,
  };
}

/**
 * Pipe Header design velocity ceiling: 0.5 m/s lower than the global maximum velocity
 * (clamped to a 0.1 m/s floor for numerical safety).
 */
export function getHeaderMaxVelocityMs(globalMaxVelocityMs: number): number {
  return Math.max(
    0.1,
    Math.round((globalMaxVelocityMs - PIPE_HEADER_VELOCITY_OFFSET_MS) * 100) / 100
  );
}

export function getEffectiveCavitationRatioLimit(
  parameters?: Pick<DesignParameters, 'cavitationRatioLimit'>
): number {
  const val = parameters?.cavitationRatioLimit;
  if (val !== undefined && Number.isFinite(val) && val >= 1.0) {
    return val;
  }
  return DEFAULT_CAVITATION_RATIO_LIMIT;
}

export function isDefaultCavitationRatioLimit(limit?: number): boolean {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) return true;
  return Math.abs(limit - DEFAULT_CAVITATION_RATIO_LIMIT) < 1e-6;
}

export function formatCavitationRatio(limit?: number): string {
  const effective = getEffectiveCavitationRatioLimit({ cavitationRatioLimit: limit });
  const rounded = Math.round(effective * 100) / 100;
  return Number.isInteger(rounded) || Math.round(rounded * 10) === rounded * 10
    ? rounded.toFixed(1)
    : rounded.toFixed(2);
}

export function getEffectiveFlowFormula(
  formula?: FlowConversionFormula,
  standard?: DesignStandard
): FlowConversionFormula {
  const stdDefault = getDefaultFlowFormulaForStandard(standard);
  if (!formula) {
    return {
      mode: 'power',
      coefficient: stdDefault.coefficient,
      exponent: stdDefault.exponent,
    };
  }
  if (formula.mode === 'expression') {
    return {
      mode: 'expression',
      coefficient:
        Number.isFinite(formula.coefficient) && formula.coefficient > 0
          ? formula.coefficient
          : stdDefault.coefficient,
      exponent:
        Number.isFinite(formula.exponent) && formula.exponent > 0
          ? formula.exponent
          : stdDefault.exponent,
      expression: formula.expression ?? stdDefault.expression,
    };
  }
  return {
    mode: 'power',
    coefficient:
      Number.isFinite(formula.coefficient) && formula.coefficient > 0
        ? formula.coefficient
        : stdDefault.coefficient,
    exponent:
      Number.isFinite(formula.exponent) && formula.exponent > 0
        ? formula.exponent
        : stdDefault.exponent,
  };
}

export function isDefaultFlowFormula(
  formula?: FlowConversionFormula,
  standard?: DesignStandard
): boolean {
  if (!formula) return true;
  if (formula.mode !== 'power') return false;
  const stdDefault = getDefaultFlowFormulaForStandard(standard);
  return (
    Math.abs(formula.coefficient - stdDefault.coefficient) < 1e-9 &&
    Math.abs(formula.exponent - stdDefault.exponent) < 1e-9
  );
}

function formatFormulaNumber(val: number): string {
  if (!Number.isFinite(val)) return '0';
  return String(Number(val.toPrecision(8)));
}

export function formatFlowFormulaDisplay(
  formula?: FlowConversionFormula,
  standard?: DesignStandard
): string {
  const eff = getEffectiveFlowFormula(formula, standard);
  const stdDefault = getDefaultFlowFormulaForStandard(standard);
  if (eff.mode === 'expression') {
    const expr = (eff.expression ?? stdDefault.expression).trim() || stdDefault.expression;
    return `Q = ${expr} L/s`;
  }
  return `Q = ${formatFormulaNumber(eff.coefficient)} × LU^${formatFormulaNumber(eff.exponent)} L/s`;
}

type ExprToken =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

function tokenizeFlowExpression(rawExpr: string): ExprToken[] {
  const normalized = rawExpr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .trim();

  const tokens: ExprToken[] = [];
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const rest = normalized.slice(i);
      const match = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!match) {
        throw new Error(`Invalid number near "${rest.slice(0, 8)}"`);
      }
      const val = Number(match[0]);
      if (!Number.isFinite(val)) {
        throw new Error(`Invalid numeric value "${match[0]}"`);
      }
      tokens.push({ type: 'num', value: val });
      i += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const rest = normalized.slice(i);
      const match = rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      if (!match) {
        throw new Error(`Invalid identifier near "${rest.slice(0, 8)}"`);
      }
      tokens.push({ type: 'id', value: match[0] });
      i += match[0].length;
      continue;
    }
    throw new Error(`Unsupported character "${ch}"`);
  }

  return tokens;
}

function parseAndEvalTokens(tokens: ExprToken[], luValue: number): number {
  let pos = 0;

  const peek = (): ExprToken | undefined => tokens[pos];
  const consume = (): ExprToken | undefined => tokens[pos++];

  const parseExpression = (): number => parseAddSub();

  const parseAddSub = (): number => {
    let left = parseMulDiv();
    while (true) {
      const t = peek();
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        consume();
        const right = parseMulDiv();
        left = t.value === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };

  const parseMulDiv = (): number => {
    let left = parsePower();
    while (true) {
      const t = peek();
      if (t?.type === 'op' && (t.value === '*' || t.value === '/')) {
        consume();
        const right = parsePower();
        if (t.value === '/') {
          if (right === 0) throw new Error('Division by zero');
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    const t = peek();
    if (t?.type === 'op' && t.value === '^') {
      consume();
      const exp = parsePower(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  };

  const parseUnary = (): number => {
    const t = peek();
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      consume();
      const val = parseUnary();
      return t.value === '-' ? -val : val;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const t = consume();
    if (!t) {
      throw new Error('Unexpected end of expression');
    }
    if (t.type === 'num') {
      return t.value;
    }
    if (t.type === 'lparen') {
      const val = parseExpression();
      const close = consume();
      if (close?.type !== 'rparen') {
        throw new Error('Missing closing parenthesis ")"');
      }
      return val;
    }
    if (t.type === 'id') {
      const name = t.value.toLowerCase();
      if (peek()?.type === 'lparen') {
        consume(); // '('
        const args: number[] = [];
        if (peek()?.type !== 'rparen') {
          args.push(parseExpression());
          while (peek()?.type === 'comma') {
            consume();
            args.push(parseExpression());
          }
        }
        const close = consume();
        if (close?.type !== 'rparen') {
          throw new Error(`Missing ")" after ${t.value}(...)`);
        }
        switch (name) {
          case 'sqrt':
            if (args.length !== 1) throw new Error('sqrt() expects 1 argument');
            return Math.sqrt(args[0]);
          case 'abs':
            if (args.length !== 1) throw new Error('abs() expects 1 argument');
            return Math.abs(args[0]);
          case 'log':
          case 'log10':
            if (args.length !== 1) throw new Error(`${t.value}() expects 1 argument`);
            return Math.log10(args[0]);
          case 'ln':
            if (args.length !== 1) throw new Error('ln() expects 1 argument');
            return Math.log(args[0]);
          case 'exp':
            if (args.length !== 1) throw new Error('exp() expects 1 argument');
            return Math.exp(args[0]);
          case 'pow':
            if (args.length !== 2) throw new Error('pow() expects 2 arguments');
            return Math.pow(args[0], args[1]);
          case 'min':
            if (args.length < 1) throw new Error('min() expects at least 1 argument');
            return Math.min(...args);
          case 'max':
            if (args.length < 1) throw new Error('max() expects at least 1 argument');
            return Math.max(...args);
          default:
            throw new Error(`Unknown function "${t.value}"`);
        }
      }
      if (name === 'lu') {
        return luValue;
      }
      if (name === 'pi') {
        return Math.PI;
      }
      if (name === 'e') {
        return Math.E;
      }
      throw new Error(`Unknown variable "${t.value}" (use LU)`);
    }
    throw new Error('Unexpected token in expression');
  };

  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error('Unexpected trailing input in expression');
  }
  return result;
}

export function evaluateFlowExpression(expression: string, cumulativeLu: number): number {
  const tokens = tokenizeFlowExpression(expression);
  if (tokens.length === 0) {
    throw new Error('Expression cannot be empty');
  }
  return parseAndEvalTokens(tokens, cumulativeLu);
}

export function validateFlowExpression(expression: string): {
  valid: boolean;
  error?: string;
  sample260?: number;
} {
  try {
    const tokens = tokenizeFlowExpression(expression);
    if (tokens.length === 0) {
      return { valid: false, error: 'Enter a mathematical expression using LU.' };
    }
    const q1 = parseAndEvalTokens(tokens, 1);
    const q260 = parseAndEvalTokens(tokens, 260);
    const q1000 = parseAndEvalTokens(tokens, 1000);
    if (!Number.isFinite(q1) || !Number.isFinite(q260) || !Number.isFinite(q1000)) {
      return { valid: false, error: 'Expression evaluates to a non-finite value.' };
    }
    if (q1 < 0 || q260 <= 0 || q1000 <= 0) {
      return { valid: false, error: 'Expression must yield positive flow Q > 0 for LU > 0.' };
    }
    return { valid: true, sample260: q260 };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid expression',
    };
  }
}

/**
 * Empirical conversion from Cumulative Loading Units (LU) to Design Flow Rate Q (L/s):
 * BS 6700 default: Q = 0.0485 * (LU)^0.7162
 * BS EN 806-3 default: Q = 0.05794 * (LU)^0.5924
 */
export function calculateFlowRateFromLu(
  cumulativeLu: number,
  formula?: FlowConversionFormula,
  standard?: DesignStandard
): number {
  if (cumulativeLu <= 0) return 0;
  const eff = getEffectiveFlowFormula(formula, standard);
  if (eff.mode === 'expression' && eff.expression) {
    try {
      const q = evaluateFlowExpression(eff.expression, cumulativeLu);
      return Number.isFinite(q) && q >= 0 ? q : 0;
    } catch {
      const stdDefault = getDefaultFlowFormulaForStandard(standard);
      return stdDefault.coefficient * Math.pow(cumulativeLu, stdDefault.exponent);
    }
  }
  return eff.coefficient * Math.pow(cumulativeLu, eff.exponent);
}

/**
 * Inverse formula: Max Loading Units supported for a target flow rate Q (L/s)
 */
export function calculateMaxLuFromFlowRate(
  flowRateLs: number,
  formula?: FlowConversionFormula,
  standard?: DesignStandard
): number {
  if (flowRateLs <= 0) return 0;
  const eff = getEffectiveFlowFormula(formula, standard);
  if (eff.mode === 'expression' && eff.expression) {
    let low = 0;
    let high = 1e8;
    const qHigh = calculateFlowRateFromLu(high, eff, standard);
    if (qHigh <= flowRateLs) return high;
    for (let iter = 0; iter < 60; iter++) {
      const mid = (low + high) / 2;
      const qMid = calculateFlowRateFromLu(mid, eff, standard);
      if (qMid <= flowRateLs) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return low;
  }
  return Math.pow(flowRateLs / eff.coefficient, 1 / eff.exponent);
}

/**
 * Internal cross-sectional pipe area A (m^2) from inner diameter d_i (mm)
 */
export function calculatePipeAreaM2(innerDiameterMm: number): number {
  if (innerDiameterMm <= 0) return 0;
  const diMeters = innerDiameterMm / 1000;
  return (Math.PI * diMeters * diMeters) / 4;
}

/**
 * Flow velocity V (m/s) given flow rate Q (L/s) and inner diameter d_i (mm)
 */
export function calculateVelocityMs(flowRateLs: number, innerDiameterMm: number): number {
  if (flowRateLs <= 0 || innerDiameterMm <= 0) return 0;
  const areaM2 = calculatePipeAreaM2(innerDiameterMm);
  return flowRateLs / 1000 / areaM2;
}

/**
 * Minimum required internal pipe diameter d_i (mm) to keep velocity V <= V_max at flow Q (L/s)
 */
export function calculateRequiredInnerDiaMm(flowRateLs: number, maxVelocityMs: number): number {
  if (flowRateLs <= 0 || maxVelocityMs <= 0) return 0;
  const requiredAreaM2 = flowRateLs / 1000 / maxVelocityMs;
  return Math.sqrt((4 * requiredAreaM2) / Math.PI) * 1000;
}

export interface PipeSelectionResult {
  selected: PipeSizeEntry | null;
  velocityMs: number | null;
  exceedsMaxCapacity: boolean;
  specId: PipeSpecId;
  spec: PipeSpecificationTable;
  isFallbackMaterial: boolean;
  requiredInnerDiaMm: number | null;
}

export function isPipeSizeIncluded(
  specId: PipeSpecId,
  nominalSize: number,
  excludedPipeSizes?: Partial<Record<PipeSpecId, number[]>>
): boolean {
  const excluded = excludedPipeSizes?.[specId];
  if (!excluded || excluded.length === 0) return true;
  return !excluded.includes(nominalSize);
}

export function getAvailablePipeSizes(
  pipeSpec: PipeSpecificationTable,
  excludedPipeSizes?: Partial<Record<PipeSpecId, number[]>>
): Array<PipeSizeEntry & { innerDiameter: number }> {
  const excluded = excludedPipeSizes?.[pipeSpec.id];
  const excludedSet = excluded && excluded.length > 0 ? new Set(excluded) : null;
  return pipeSpec.sizes.filter(
    (s): s is PipeSizeEntry & { innerDiameter: number } =>
      s.innerDiameter !== null &&
      s.innerDiameter > 0 &&
      (!excludedSet || !excludedSet.has(s.nominalSize))
  );
}

/**
 * Select smallest nominal pipe size whose actual velocity V <= V_max:
 * 1. Always evaluate the Primary pipe material first (using only active/included sizes).
 * 2. Only when no primary size satisfies V <= V_max, evaluate the Optional fallback material (if specified).
 * 3. If neither material satisfies the requirement, return the largest available Primary pipe size and flag exceedance.
 */
export function selectPipeSizeByVelocity(
  flowRateLs: number,
  pipeSpec: PipeSpecificationTable,
  maxVelocityMs: number,
  optionalPipeSpec?: PipeSpecificationTable | null,
  excludedPipeSizes?: Partial<Record<PipeSpecId, number[]>>
): PipeSelectionResult {
  if (flowRateLs <= 0) {
    return {
      selected: null,
      velocityMs: null,
      exceedsMaxCapacity: false,
      specId: pipeSpec.id,
      spec: pipeSpec,
      isFallbackMaterial: false,
      requiredInnerDiaMm: null,
    };
  }

  const requiredInnerDiaMm = calculateRequiredInnerDiaMm(flowRateLs, maxVelocityMs);

  const primaryAvailableSizes = getAvailablePipeSizes(pipeSpec, excludedPipeSizes);

  // Step 1: Primary Material Priority — always check primary material first
  for (const size of primaryAvailableSizes) {
    const v = calculateVelocityMs(flowRateLs, size.innerDiameter);
    if (v <= maxVelocityMs + 1e-9) {
      return {
        selected: size,
        velocityMs: v,
        exceedsMaxCapacity: false,
        specId: pipeSpec.id,
        spec: pipeSpec,
        isFallbackMaterial: false,
        requiredInnerDiaMm,
      };
    }
  }

  // Step 2: Conditional Optional Material Evaluation — only if primary cannot satisfy requirement
  if (optionalPipeSpec && optionalPipeSpec.id !== pipeSpec.id) {
    const optionalAvailableSizes = getAvailablePipeSizes(optionalPipeSpec, excludedPipeSizes);
    for (const size of optionalAvailableSizes) {
      const v = calculateVelocityMs(flowRateLs, size.innerDiameter);
      if (v <= maxVelocityMs + 1e-9) {
        return {
          selected: size,
          velocityMs: v,
          exceedsMaxCapacity: false,
          specId: optionalPipeSpec.id,
          spec: optionalPipeSpec,
          isFallbackMaterial: true,
          requiredInnerDiaMm,
        };
      }
    }
  }

  // Step 3: Neither primary nor optional material can meet requirement — display largest primary size and flag alert
  if (primaryAvailableSizes.length === 0) {
    return {
      selected: null,
      velocityMs: null,
      exceedsMaxCapacity: true,
      specId: pipeSpec.id,
      spec: pipeSpec,
      isFallbackMaterial: false,
      requiredInnerDiaMm,
    };
  }

  const largestPrimary = primaryAvailableSizes[primaryAvailableSizes.length - 1];
  const vMaxPipe = calculateVelocityMs(flowRateLs, largestPrimary.innerDiameter);
  return {
    selected: largestPrimary,
    velocityMs: vMaxPipe,
    exceedsMaxCapacity: true,
    specId: pipeSpec.id,
    spec: pipeSpec,
    isFallbackMaterial: false,
    requiredInnerDiaMm,
  };
}

/**
 * Select recommended commercial PRV valve nominal bore (DN) based on flow rate
 */
export function selectPrvValveDn(flowRateLs: number, maxVelocityMs: number): number {
  if (flowRateLs <= 0) return STANDARD_PRV_DN_SIZES[0];
  const targetVel = Math.max(maxVelocityMs, 2.0);
  for (const dn of STANDARD_PRV_DN_SIZES) {
    const v = calculateVelocityMs(flowRateLs, dn);
    if (v <= targetVel + 0.05) {
      return dn;
    }
  }
  return STANDARD_PRV_DN_SIZES[STANDARD_PRV_DN_SIZES.length - 1];
}

export function formatOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatLuDisplay(lu: number): string {
  if (!Number.isFinite(lu)) return '0';
  const rounded = Math.round(lu * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1);
}

export function formatRowEquipmentDisplay(
  row: CalculatedFloorRow,
  riserColumnsCount: number,
  subDropperLabelMap: Map<string, string>,
  mode: 'ui' | 'pdf' | 'excel' = 'ui'
): string {
  const isRoof = row.input.supplyMode === SupplyMode.ROOF_HEADER;
  if (isRoof) {
    if (row.equipmentTag === 'Pump') {
      if (row.boostedRiserDetails && row.boostedRiserDetails.length > 0) {
        return `Pump (${row.boostedRiserDetails
          .map((d) => `${d.label}${d.isCustom ? '*' : ''}`)
          .join(', ')})`;
      }
      if (row.boostedRiserLabels?.length) {
        return `Pump (${row.boostedRiserLabels.join(', ')})`;
      }
      return 'Pump';
    }
    return row.equipmentTag || 'Tank';
  }

  const mainPrvs = Object.values(row.dropperCells).filter((c) => c.hasPrv && c.prvDetail);
  const subPrvs = Object.values(row.subDropperCells).filter((c) => c.hasPrv && c.prvDetail);
  const prvTags: string[] = [];

  for (const sc of subPrvs) {
    if (!sc.prvDetail) continue;
    const sdLabel = subDropperLabelMap.get(sc.subDropperId) ?? 'SD';
    const pin = sc.prvDetail.isManualOverride ? ' [Pin]' : '';
    const custom = sc.prvDetail.isCustomSetPressure ? '*' : '';
    prvTags.push(`${sdLabel} PRV (DN${sc.prvDetail.recommendedValveDn})${pin}${custom}`);
  }
  for (const c of mainPrvs) {
    if (!c.prvDetail) continue;
    const prefix = riserColumnsCount > 1 || !c.isServed ? `D${c.dropperIndex} ` : '';
    const pin = c.prvDetail.isManualOverride ? ' [Pin]' : '';
    const custom = c.prvDetail.isCustomSetPressure ? '*' : '';
    prvTags.push(`${prefix}PRV (DN${c.prvDetail.recommendedValveDn})${pin}${custom}`);
  }

  let baseTag = '';
  if (prvTags.length > 0) {
    baseTag = prvTags.join(', ');
  } else if (row.equipmentTag === 'Gravity') {
    baseTag = 'Gravity';
  } else if (row.equipmentTag === 'Pump') {
    if (row.boostedRiserDetails && row.boostedRiserDetails.length > 0) {
      baseTag = `Pump (${row.boostedRiserDetails
        .map((d) => `${d.label}${d.isCustom ? '*' : ''}`)
        .join(', ')})`;
    } else if (row.boostedRiserLabels?.length) {
      baseTag = `Pump (${row.boostedRiserLabels.join(', ')})`;
    } else {
      baseTag = 'Pump';
    }
  } else {
    const effectiveOverride = row.primarySubDropperId
      ? row.input.subDropperPrvOverrides?.[row.primarySubDropperId] ?? row.input.prvOverride
      : row.input.prvOverride;
    if (effectiveOverride === PrvOverrideMode.NO_PRV) {
      baseTag = 'No PRV';
    }
  }

  if (row.isSplitFloor) {
    const splitPrefix = mode === 'pdf' ? 'Split' : '◐ Split';
    const splitSummary = `${splitPrefix} (${row.riserAllocations
      .map((a) => `${a.riserLabel}:${formatLuDisplay(a.assignedLu)}`)
      .join('+')})`;
    const sep = mode === 'excel' ? ' | ' : ' · ';
    return baseTag ? `${baseTag}${sep}${splitSummary}` : splitSummary;
  }

  if (!baseTag && row.primarySubDropperId) {
    return subDropperLabelMap.get(row.primarySubDropperId) ?? '';
  }

  return baseTag;
}

export function formatRowDeltaPDisplay(row: CalculatedFloorRow): string {
  if (row.primaryDeltaPBar === null) return '';
  if (
    row.primaryDeltaPBar > 0 &&
    row.boostedRiserDetails &&
    row.boostedRiserDetails.length > 1
  ) {
    const vals = row.boostedRiserDetails.map((d) => d.boostBar);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    if (Math.abs(maxV - minV) > 0.005) {
      return `+${minV.toFixed(1)}–${maxV.toFixed(1)}*`;
    }
  }
  const hasCustom =
    row.primaryDeltaPBar > 0 && Boolean(row.boostedRiserDetails?.some((d) => d.isCustom));
  return `${row.primaryDeltaPBar > 0 ? '+' : ''}${row.primaryDeltaPBar.toFixed(2)}${
    hasCustom ? '*' : ''
  }`;
}

/**
 * Normalize Unicode symbols that are not supported by standard PDF WinAnsi/Helvetica encoding.
 */
export function toPdfSafeText(text: string): string {
  return text
    .replace(/Δ/g, 'd')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/↳/g, '|->')
    .replace(/◐/g, '[Split]')
    .replace(/┆/g, '|')
    .replace(/−/g, '-');
}

export function isSameRiserTarget(a: RiserTarget | null, b: RiserTarget | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'main'
    ? a.dropperIndex === (b as { kind: 'main'; dropperIndex: number }).dropperIndex
    : a.subDropperId === (b as { kind: 'sub'; subDropperId: string }).subDropperId;
}

export function riserTargetKey(target: RiserTarget): string {
  return target.kind === 'main' ? `main-${target.dropperIndex}` : `sub-${target.subDropperId}`;
}

/**
 * Sanitize and merge duplicate riser targets in a floor's explicit loadSplits list.
 * Returns normalized allocations with loadingUnits > 0, or null if no active explicit split exists.
 */
export function getEffectiveFloorSplits(
  floor: FloorInputRow,
  validSubDropperIds?: Set<string>
): FloorRiserAllocation[] | null {
  if (floor.supplyMode === SupplyMode.ROOF_HEADER) return null;
  if (!floor.loadSplits || floor.loadSplits.length === 0) return null;

  const merged = new Map<string, FloorRiserAllocation>();
  for (const alloc of floor.loadSplits) {
    const lu = Math.max(0, Number(alloc.loadingUnits) || 0);
    if (lu <= 0) continue;
    if (alloc.target.kind === 'sub') {
      if (validSubDropperIds && !validSubDropperIds.has(alloc.target.subDropperId)) {
        continue;
      }
      const key = `sub-${alloc.target.subDropperId}`;
      const existing = merged.get(key);
      if (existing) {
        existing.loadingUnits += lu;
      } else {
        merged.set(key, {
          target: { kind: 'sub', subDropperId: alloc.target.subDropperId },
          loadingUnits: lu,
        });
      }
    } else {
      const dIdx = Math.max(1, Math.round(Number(alloc.target.dropperIndex) || 1));
      const key = `main-${dIdx}`;
      const existing = merged.get(key);
      if (existing) {
        existing.loadingUnits += lu;
      } else {
        merged.set(key, {
          target: { kind: 'main', dropperIndex: dIdx },
          loadingUnits: lu,
        });
      }
    }
  }

  const list = Array.from(merged.values());
  return list.length > 0 ? list : null;
}

interface InternalDropperDefinition {
  dropperIndex: number;
  sourceKey?: number;
  label: string;
  zoneType: 'Booster' | 'Gravity';
  servedRowIndices: number[]; // Ascending row indices (top to bottom)
  luShareDivisor: number; // 1 for dedicated/zoned riser, N for parallel split risers
}

/**
 * Partition contiguous floor rowIndices into K balanced vertical zones (1 <= K <= M)
 * using exact DP to minimize the peak LU per dropper (with floor-count balance tie-breaker).
 * If K > M, each floor becomes a zone and excess risers parallel-split the highest-LU floors.
 */
function partitionVerticalZonesBalanced(
  rowIndices: number[],
  floors: FloorInputRow[],
  targetZones: number
): Array<{ rowIndices: number[]; luShareDivisor: number }> {
  const m = rowIndices.length;
  if (m === 0 || targetZones <= 0) return [];
  if (targetZones === 1) {
    return [{ rowIndices: [...rowIndices], luShareDivisor: 1 }];
  }

  if (targetZones <= m) {
    const kMax = targetZones;
    const prefLu = new Array<number>(m + 1).fill(0);
    for (let i = 0; i < m; i++) {
      prefLu[i + 1] = prefLu[i] + Math.max(0, floors[rowIndices[i]].loadingUnits);
    }

    type Cost = { lu: number; count: number };
    const INF: Cost = { lu: Infinity, count: Infinity };
    const isBetter = (a: Cost, b: Cost) => {
      if (Math.abs(a.lu - b.lu) > 1e-6) return a.lu < b.lu;
      return a.count < b.count;
    };

    const dp: Cost[][] = Array.from({ length: kMax + 1 }, () =>
      Array.from({ length: m + 1 }, () => INF)
    );
    const split: number[][] = Array.from({ length: kMax + 1 }, () =>
      new Array<number>(m + 1).fill(0)
    );

    for (let i = 1; i <= m; i++) {
      dp[1][i] = { lu: prefLu[i], count: i };
    }

    for (let k = 2; k <= kMax; k++) {
      for (let i = k; i <= m; i++) {
        for (let j = k - 1; j < i; j++) {
          const prev = dp[k - 1][j];
          const segLu = prefLu[i] - prefLu[j];
          const segCount = i - j;
          const cand: Cost = {
            lu: Math.max(prev.lu, segLu),
            count: Math.max(prev.count, segCount),
          };
          if (isBetter(cand, dp[k][i])) {
            dp[k][i] = cand;
            split[k][i] = j;
          }
        }
      }
    }

    const slices: number[][] = [];
    let currI = m;
    for (let k = kMax; k >= 1; k--) {
      const prevJ = k === 1 ? 0 : split[k][currI];
      slices.unshift(rowIndices.slice(prevJ, currI));
      currI = prevJ;
    }

    return slices.map((slice) => ({ rowIndices: slice, luShareDivisor: 1 }));
  }

  // targetZones > m: assign 1 riser per floor, then parallel-split highest-LU floors
  const parallelCounts = new Array<number>(m).fill(1);
  const floorLus = rowIndices.map((rIdx) => Math.max(0, floors[rIdx].loadingUnits));
  const hasAnyLu = floorLus.some((lu) => lu > 0);

  for (let extra = targetZones - m; extra > 0; extra--) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < m; i++) {
      const score = hasAnyLu
        ? floorLus[i] / parallelCounts[i]
        : 1 / parallelCounts[i];
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    parallelCounts[bestIdx] += 1;
  }

  const result: Array<{ rowIndices: number[]; luShareDivisor: number }> = [];
  for (let i = 0; i < m; i++) {
    const count = parallelCounts[i];
    for (let p = 0; p < count; p++) {
      result.push({ rowIndices: [rowIndices[i]], luShareDivisor: count });
    }
  }
  return result;
}

/**
 * Full High-Rise DCW Dropper Sizing & Static Pressure Calculation Engine
 */
export function runHydraulicCalculations(
  floors: FloorInputRow[],
  parameters: DesignParameters
): SystemCalculationResult {
  const pipeSpec = PIPE_SPEC_TABLES[parameters.pipeSpecId] ?? PIPE_SPEC_TABLES.PPR_PN16;
  const optionalPipeSpec =
    parameters.optionalPipeSpecId && PIPE_SPEC_TABLES[parameters.optionalPipeSpecId]
      ? PIPE_SPEC_TABLES[parameters.optionalPipeSpecId]
      : null;

  const cavitationLimit = getEffectiveCavitationRatioLimit(parameters);
  const cavitationLimitLabel = formatCavitationRatio(cavitationLimit);

  // Determine maximum single-pipe flow rate and LU capacity for the Primary pipe table (respecting excluded sizes)
  const validSizes = getAvailablePipeSizes(pipeSpec, parameters.excludedPipeSizes);
  const largestSize = validSizes.length > 0 ? validSizes[validSizes.length - 1] : null;
  const maxSinglePipeCapacityLs = largestSize
    ? parameters.maxVelocityMs * calculatePipeAreaM2(largestSize.innerDiameter) * 1000
    : 0;
  const maxSinglePipeCapacityLu = calculateMaxLuFromFlowRate(
    maxSinglePipeCapacityLs,
    parameters.flowFormula,
    parameters.standard
  );

  const optionalValidSizes = optionalPipeSpec
    ? getAvailablePipeSizes(optionalPipeSpec, parameters.excludedPipeSizes)
    : [];
  const largestOptionalSize =
    optionalValidSizes.length > 0 ? optionalValidSizes[optionalValidSizes.length - 1] : null;
  const maxOptionalPipeCapacityLs = largestOptionalSize
    ? parameters.maxVelocityMs * calculatePipeAreaM2(largestOptionalSize.innerDiameter) * 1000
    : null;
  const maxOptionalPipeCapacityLu =
    maxOptionalPipeCapacityLs !== null
      ? calculateMaxLuFromFlowRate(
          maxOptionalPipeCapacityLs,
          parameters.flowFormula,
          parameters.standard
        )
      : null;

  const buildSizingShortfallWarning = (
    subjectLabel: string,
    flowLs: number,
    requiredDiMm: number,
    velocityLimitMs: number = parameters.maxVelocityMs
  ): string => {
    const primaryLabel = getPipeSpecBadgeLabel(pipeSpec.id);
    const primaryCapLs = largestSize
      ? velocityLimitMs * calculatePipeAreaM2(largestSize.innerDiameter) * 1000
      : 0;
    const primaryLimitDesc = largestSize
      ? `${primaryLabel} max ${largestSize.nominalSize} mm (di ${formatPipeDim(
          largestSize.innerDiameter,
          pipeSpec
        )} mm, ${primaryCapLs.toFixed(1)} L/s)`
      : `${primaryLabel} (no active pipe sizes enabled)`;

    const optionalCapLs = largestOptionalSize
      ? velocityLimitMs * calculatePipeAreaM2(largestOptionalSize.innerDiameter) * 1000
      : null;

    if (
      optionalPipeSpec &&
      optionalPipeSpec.id !== pipeSpec.id &&
      largestOptionalSize &&
      optionalCapLs !== null
    ) {
      const optLabel = getPipeSpecBadgeLabel(optionalPipeSpec.id);
      return `${subjectLabel}: Sizing shortfall — requires di ≥ ${requiredDiMm.toFixed(
        1
      )} mm (${flowLs.toFixed(2)} L/s at V ≤ ${velocityLimitMs.toFixed(
        1
      )} m/s). Neither Primary ${primaryLimitDesc} nor Optional ${optLabel} max ${
        largestOptionalSize.nominalSize
      } mm (di ${formatPipeDim(
        largestOptionalSize.innerDiameter,
        optionalPipeSpec
      )} mm, ${optionalCapLs.toFixed(
        1
      )} L/s) satisfies requirement.${
        largestSize
          ? ` Displaying largest primary size: ${primaryLabel} (${largestSize.nominalSize} mm).`
          : ' Re-enable pipe sizes in Specs or choose another material.'
      }`;
    }

    return `${subjectLabel}: Sizing shortfall — requires di ≥ ${requiredDiMm.toFixed(
      1
    )} mm (${flowLs.toFixed(2)} L/s at V ≤ ${velocityLimitMs.toFixed(
      1
    )} m/s), exceeding Primary ${primaryLimitDesc}.${
      largestSize
        ? ` Displaying ${primaryLabel} (${largestSize.nominalSize} mm); select an Optional fallback material, enable larger sizes in Specs, or split risers.`
        : ' Enable pipe sizes in Specs or select an Optional fallback material.'
    }`;
  };

  // Step 1A: Compute cumulative static head (m and bar) top-down
  let runningHeadM = 0;
  const cumulativeHeadsM: number[] = [];
  const staticPressuresBar: number[] = [];

  floors.forEach((f) => {
    runningHeadM += Math.max(0, Number(f.floorHeightM) || 0);
    cumulativeHeadsM.push(runningHeadM);
    staticPressuresBar.push(runningHeadM * GRAVITY_BAR_PER_METER);
  });

  const configuredSubDropperIds = new Set((parameters.subDroppers ?? []).map((sd) => sd.id));
  const effectiveSplitsByRow = new Map<number, FloorRiserAllocation[]>();
  floors.forEach((f, idx) => {
    const splits = getEffectiveFloorSplits(f, configuredSubDropperIds);
    if (splits && splits.length > 0) {
      effectiveSplitsByRow.set(idx, splits);
    }
  });

  // Identify Booster and Gravity floor row indices (excluding ROOF_HEADER)
  // Floors with explicit loadSplits are excluded from single-riser auto-packing and routed directly
  // to their explicit split risers (with any referenced main dropper ensured below).
  const boosterRowIndices: number[] = [];
  const gravityRowIndices: number[] = [];
  const allBoosterRowIndices: number[] = [];
  const allGravityRowIndices: number[] = [];

  floors.forEach((f, idx) => {
    const hasExplicitSplits = effectiveSplitsByRow.has(idx);
    if (f.supplyMode === SupplyMode.BOOSTER) {
      allBoosterRowIndices.push(idx);
      if (!hasExplicitSplits) boosterRowIndices.push(idx);
    } else if (f.supplyMode === SupplyMode.GRAVITY) {
      allGravityRowIndices.push(idx);
      if (!hasExplicitSplits) gravityRowIndices.push(idx);
    }
  });

  // Build Main Dropper definitions according to ZoningStrategy and optional desiredDropperCount
  const droppers: InternalDropperDefinition[] = [];
  let nextDropperIdx = 1;
  const manualKeyToNormalizedIdx = new Map<number, number>();

  const desiredCountRaw = parameters.desiredDropperCount;
  const hasCustomDropperCount =
    desiredCountRaw !== null &&
    desiredCountRaw !== undefined &&
    Number.isFinite(desiredCountRaw) &&
    desiredCountRaw >= 1 &&
    parameters.zoningStrategy !== ZoningStrategy.MANUAL_ZONES;

  if (parameters.zoningStrategy === ZoningStrategy.MANUAL_ZONES) {
    const grouped = new Map<number, { indices: number[]; isBooster: boolean }>();
    floors.forEach((f, idx) => {
      if (f.supplyMode === SupplyMode.ROOF_HEADER) return;
      const splits = effectiveSplitsByRow.get(idx);
      if (splits) {
        for (const alloc of splits) {
          if (alloc.target.kind !== 'main') continue;
          const dIdx = alloc.target.dropperIndex;
          const existing = grouped.get(dIdx);
          if (!existing) {
            grouped.set(dIdx, {
              indices: [],
              isBooster: f.supplyMode === SupplyMode.BOOSTER,
            });
          }
        }
        return;
      }
      const dIdx = Math.max(1, Math.round(f.manualDropperIndex || (f.supplyMode === SupplyMode.BOOSTER ? 1 : 2)));
      const existing = grouped.get(dIdx);
      if (!existing) {
        grouped.set(dIdx, {
          indices: [idx],
          isBooster: f.supplyMode === SupplyMode.BOOSTER,
        });
      } else {
        existing.indices.push(idx);
      }
    });

    const sortedKeys = Array.from(grouped.keys()).sort((a, b) => a - b);
    sortedKeys.forEach((origKey, i) => {
      const entry = grouped.get(origKey)!;
      const normalizedIdx = i + 1;
      manualKeyToNormalizedIdx.set(origKey, normalizedIdx);
      droppers.push({
        dropperIndex: normalizedIdx,
        sourceKey: origKey,
        label: `D${normalizedIdx}`,
        zoneType: entry.isBooster ? 'Booster' : 'Gravity',
        servedRowIndices: entry.indices,
        luShareDivisor: 1,
      });
    });
  } else if (hasCustomDropperCount) {
    const targetTotal = Math.max(1, Math.min(24, Math.round(desiredCountRaw)));
    const hasBooster = boosterRowIndices.length > 0;
    const hasGravity = gravityRowIndices.length > 0;
    const totalBoosterLu = boosterRowIndices.reduce(
      (acc, idx) => acc + Math.max(0, floors[idx].loadingUnits),
      0
    );
    const totalGravityLu = gravityRowIndices.reduce(
      (acc, idx) => acc + Math.max(0, floors[idx].loadingUnits),
      0
    );

    if (hasBooster && hasGravity && targetTotal === 1) {
      // Single combined dropper serving all building floors (boosted from top header)
      const combinedIndices = [...boosterRowIndices, ...gravityRowIndices].sort((a, b) => a - b);
      const idx = nextDropperIdx++;
      droppers.push({
        dropperIndex: idx,
        label: `D${idx}`,
        zoneType: 'Booster',
        servedRowIndices: combinedIndices,
        luShareDivisor: 1,
      });
    } else if (hasBooster || hasGravity) {
      let nBooster = hasBooster ? 1 : 0;
      let nGravity = hasGravity ? 1 : 0;
      const useParallel = parameters.zoningStrategy === ZoningStrategy.AUTO_PARALLEL_SPLIT;

      if (hasBooster && hasGravity) {
        for (let rem = targetTotal - 2; rem > 0; rem--) {
          const canPreferVerticalB = !useParallel && nBooster < boosterRowIndices.length;
          const canPreferVerticalG = !useParallel && nGravity < gravityRowIndices.length;

          if (!useParallel && canPreferVerticalG && !canPreferVerticalB) {
            nGravity += 1;
            continue;
          }
          if (!useParallel && canPreferVerticalB && !canPreferVerticalG) {
            nBooster += 1;
            continue;
          }

          const hasAnyLu = totalBoosterLu > 0 || totalGravityLu > 0;
          const scoreB = hasAnyLu
            ? totalBoosterLu / nBooster
            : boosterRowIndices.length / nBooster;
          const scoreG = hasAnyLu
            ? totalGravityLu / nGravity
            : gravityRowIndices.length / nGravity;

          if (scoreG >= scoreB) {
            nGravity += 1;
          } else {
            nBooster += 1;
          }
        }
      } else if (hasBooster) {
        nBooster = targetTotal;
      } else {
        nGravity = targetTotal;
      }

      if (nBooster > 0) {
        if (useParallel) {
          for (let p = 0; p < nBooster; p++) {
            const idx = nextDropperIdx++;
            droppers.push({
              dropperIndex: idx,
              label: `D${idx}`,
              zoneType: 'Booster',
              servedRowIndices: [...boosterRowIndices],
              luShareDivisor: nBooster,
            });
          }
        } else {
          const partitions = partitionVerticalZonesBalanced(boosterRowIndices, floors, nBooster);
          for (const part of partitions) {
            const idx = nextDropperIdx++;
            droppers.push({
              dropperIndex: idx,
              label: `D${idx}`,
              zoneType: 'Booster',
              servedRowIndices: part.rowIndices,
              luShareDivisor: part.luShareDivisor,
            });
          }
        }
      }

      if (nGravity > 0) {
        if (useParallel) {
          for (let p = 0; p < nGravity; p++) {
            const idx = nextDropperIdx++;
            droppers.push({
              dropperIndex: idx,
              label: `D${idx}`,
              zoneType: 'Gravity',
              servedRowIndices: [...gravityRowIndices],
              luShareDivisor: nGravity,
            });
          }
        } else {
          const partitions = partitionVerticalZonesBalanced(gravityRowIndices, floors, nGravity);
          for (const part of partitions) {
            const idx = nextDropperIdx++;
            droppers.push({
              dropperIndex: idx,
              label: `D${idx}`,
              zoneType: 'Gravity',
              servedRowIndices: part.rowIndices,
              luShareDivisor: part.luShareDivisor,
            });
          }
        }
      }
    }
  } else {
    // 1. Booster Zone Dropper(s)
    if (boosterRowIndices.length > 0) {
      const totalBoosterLu = boosterRowIndices.reduce(
        (acc, idx) => acc + Math.max(0, floors[idx].loadingUnits),
        0
      );

      if (
        parameters.zoningStrategy === ZoningStrategy.AUTO_PARALLEL_SPLIT &&
        maxSinglePipeCapacityLu > 0 &&
        totalBoosterLu > maxSinglePipeCapacityLu
      ) {
        const nParallel = Math.min(8, Math.ceil(totalBoosterLu / maxSinglePipeCapacityLu));
        for (let p = 0; p < nParallel; p++) {
          const idx = nextDropperIdx++;
          droppers.push({
            dropperIndex: idx,
            label: `D${idx}`,
            zoneType: 'Booster',
            servedRowIndices: [...boosterRowIndices],
            luShareDivisor: nParallel,
          });
        }
      } else if (
        parameters.zoningStrategy === ZoningStrategy.AUTO_ZONED_VERTICAL &&
        maxSinglePipeCapacityLu > 0 &&
        totalBoosterLu > maxSinglePipeCapacityLu
      ) {
        let currentSlice: number[] = [];
        let currentLu = 0;
        for (const rIdx of boosterRowIndices) {
          const floorLu = Math.max(0, floors[rIdx].loadingUnits);
          if (currentSlice.length > 0 && currentLu + floorLu > maxSinglePipeCapacityLu) {
            const idx = nextDropperIdx++;
            droppers.push({
              dropperIndex: idx,
              label: `D${idx}`,
              zoneType: 'Booster',
              servedRowIndices: currentSlice,
              luShareDivisor: 1,
            });
            currentSlice = [rIdx];
            currentLu = floorLu;
          } else {
            currentSlice.push(rIdx);
            currentLu += floorLu;
          }
        }
        if (currentSlice.length > 0) {
          const idx = nextDropperIdx++;
          droppers.push({
            dropperIndex: idx,
            label: `D${idx}`,
            zoneType: 'Booster',
            servedRowIndices: currentSlice,
            luShareDivisor: 1,
          });
        }
      } else {
        const idx = nextDropperIdx++;
        droppers.push({
          dropperIndex: idx,
          label: `D${idx}`,
          zoneType: 'Booster',
          servedRowIndices: [...boosterRowIndices],
          luShareDivisor: 1,
        });
      }
    }

    // 2. Gravity Zone Dropper(s)
    if (gravityRowIndices.length > 0) {
      const totalGravityLu = gravityRowIndices.reduce(
        (acc, idx) => acc + Math.max(0, floors[idx].loadingUnits),
        0
      );

      if (parameters.zoningStrategy === ZoningStrategy.SINGLE_GRAVITY) {
        const idx = nextDropperIdx++;
        droppers.push({
          dropperIndex: idx,
          label: `D${idx}`,
          zoneType: 'Gravity',
          servedRowIndices: [...gravityRowIndices],
          luShareDivisor: 1,
        });
      } else if (parameters.zoningStrategy === ZoningStrategy.AUTO_PARALLEL_SPLIT) {
        const nParallel =
          maxSinglePipeCapacityLu > 0
            ? Math.max(1, Math.min(10, Math.ceil(totalGravityLu / maxSinglePipeCapacityLu)))
            : 1;
        for (let p = 0; p < nParallel; p++) {
          const idx = nextDropperIdx++;
          droppers.push({
            dropperIndex: idx,
            label: `D${idx}`,
            zoneType: 'Gravity',
            servedRowIndices: [...gravityRowIndices],
            luShareDivisor: nParallel,
          });
        }
      } else {
        // AUTO_ZONED_VERTICAL: Partition gravity floors into vertical express zones <= maxSinglePipeCapacityLu
        let currentSlice: number[] = [];
        let currentLu = 0;
        for (const rIdx of gravityRowIndices) {
          const floorLu = Math.max(0, floors[rIdx].loadingUnits);
          if (
            currentSlice.length > 0 &&
            maxSinglePipeCapacityLu > 0 &&
            currentLu + floorLu > maxSinglePipeCapacityLu
          ) {
            const idx = nextDropperIdx++;
            droppers.push({
              dropperIndex: idx,
              label: `D${idx}`,
              zoneType: 'Gravity',
              servedRowIndices: currentSlice,
              luShareDivisor: 1,
            });
            currentSlice = [rIdx];
            currentLu = floorLu;
          } else {
            currentSlice.push(rIdx);
            currentLu += floorLu;
          }
        }
        if (currentSlice.length > 0) {
          const idx = nextDropperIdx++;
          droppers.push({
            dropperIndex: idx,
            label: `D${idx}`,
            zoneType: 'Gravity',
            servedRowIndices: currentSlice,
            luShareDivisor: 1,
          });
        }
      }
    }
  }

  // Ensure every main dropper referenced by explicit floor loadSplits exists in `droppers`
  if (parameters.zoningStrategy !== ZoningStrategy.MANUAL_ZONES) {
    const existingDropperSet = new Set(droppers.map((d) => d.dropperIndex));
    const missingMainMeta = new Map<number, 'Booster' | 'Gravity'>();
    effectiveSplitsByRow.forEach((splits, rIdx) => {
      const zoneType =
        floors[rIdx]?.supplyMode === SupplyMode.BOOSTER ? 'Booster' : 'Gravity';
      for (const alloc of splits) {
        if (alloc.target.kind === 'main' && !existingDropperSet.has(alloc.target.dropperIndex)) {
          if (!missingMainMeta.has(alloc.target.dropperIndex)) {
            missingMainMeta.set(alloc.target.dropperIndex, zoneType);
          }
        }
      }
    });
    if (missingMainMeta.size > 0) {
      const sortedMissing = Array.from(missingMainMeta.keys()).sort((a, b) => a - b);
      for (const dIdx of sortedMissing) {
        droppers.push({
          dropperIndex: dIdx,
          label: `D${dIdx}`,
          zoneType: missingMainMeta.get(dIdx) ?? 'Gravity',
          servedRowIndices: [],
          luShareDivisor: 1,
        });
      }
      droppers.sort((a, b) => a.dropperIndex - b.dropperIndex);
    }
  }

  // Apply explicit per-main-dropper booster pump overrides (add/remove booster pump on any dropper riser)
  const boosterOverrides = parameters.dropperBoosterOverrides;
  if (boosterOverrides) {
    for (const dropper of droppers) {
      const override =
        boosterOverrides[dropper.dropperIndex] ??
        (dropper.sourceKey !== undefined ? boosterOverrides[dropper.sourceKey] : undefined);
      if (override !== undefined) {
        dropper.zoneType = override ? 'Booster' : 'Gravity';
      }
    }
  }

  // Resolve configured Sub-Droppers and map floor-to-riser LU allocations (supporting single, parallel, and explicit splits)
  const floorRowIndexById = new Map<string, number>();
  floors.forEach((f, idx) => floorRowIndexById.set(f.id, idx));

  const configuredSubDroppers = parameters.subDroppers ?? [];
  const validDropperIndices = new Set(droppers.map((d) => d.dropperIndex));
  const fallbackDropperIdx = droppers.length > 0 ? droppers[droppers.length - 1].dropperIndex : 1;

  interface ResolvedSubDropper {
    config: SubDropperConfig;
    resolvedParentDropperIndex: number;
    branchRowIdx: number;
    servedRowIndices: number[];
    totalLu: number;
  }

  const resolvedSubDroppers: ResolvedSubDropper[] = [];
  const subDropperById = new Map<string, ResolvedSubDropper>();

  for (const sd of configuredSubDroppers) {
    let bIdx = floorRowIndexById.get(sd.branchFloorId);
    if (bIdx === undefined || floors[bIdx]?.supplyMode === SupplyMode.ROOF_HEADER) {
      const firstNonRoof = floors.findIndex((f) => f.supplyMode !== SupplyMode.ROOF_HEADER);
      if (firstNonRoof < 0) continue;
      bIdx = firstNonRoof;
    }
    const mappedParent =
      parameters.zoningStrategy === ZoningStrategy.MANUAL_ZONES
        ? manualKeyToNormalizedIdx.get(sd.parentDropperIndex) ?? sd.parentDropperIndex
        : sd.parentDropperIndex;
    const resolvedParent = validDropperIndices.has(mappedParent)
      ? mappedParent
      : fallbackDropperIdx;

    const item: ResolvedSubDropper = {
      config: sd,
      resolvedParentDropperIndex: resolvedParent,
      branchRowIdx: bIdx,
      servedRowIndices: [],
      totalLu: 0,
    };
    resolvedSubDroppers.push(item);
    subDropperById.set(sd.id, item);
  }

  // Build exact per-riser floor LU allocation maps
  const directMainLuByDropperRow = new Map<number, Map<number, number>>();
  for (const d of droppers) {
    directMainLuByDropperRow.set(d.dropperIndex, new Map<number, number>());
  }
  const subLuByIdRow = new Map<string, Map<number, number>>();
  for (const sd of resolvedSubDroppers) {
    subLuByIdRow.set(sd.config.id, new Map<number, number>());
  }

  const servedCountByRow = new Map<number, number>();
  const totalAssignedLuByRow = new Map<number, number>();

  // Pre-index strategy-assigned droppers per row for non-split floors
  const strategyDroppersByRow = new Map<number, InternalDropperDefinition[]>();
  for (const dropper of droppers) {
    for (const rIdx of dropper.servedRowIndices) {
      const list = strategyDroppersByRow.get(rIdx) ?? [];
      list.push(dropper);
      strategyDroppersByRow.set(rIdx, list);
    }
  }

  floors.forEach((f, rIdx) => {
    if (f.supplyMode === SupplyMode.ROOF_HEADER) return;
    const splits = effectiveSplitsByRow.get(rIdx);
    let servedRisers = 0;
    let totalRowLu = 0;

    if (splits && splits.length > 0) {
      for (const alloc of splits) {
        if (alloc.target.kind === 'main') {
          const resolvedIdx =
            parameters.zoningStrategy === ZoningStrategy.MANUAL_ZONES
              ? manualKeyToNormalizedIdx.get(alloc.target.dropperIndex) ?? alloc.target.dropperIndex
              : alloc.target.dropperIndex;
          const map = directMainLuByDropperRow.get(resolvedIdx);
          if (map) {
            const prev = map.get(rIdx);
            if (prev === undefined) servedRisers += 1;
            map.set(rIdx, (prev ?? 0) + alloc.loadingUnits);
            totalRowLu += alloc.loadingUnits;
          }
        } else {
          const map = subLuByIdRow.get(alloc.target.subDropperId);
          if (map) {
            const prev = map.get(rIdx);
            if (prev === undefined) servedRisers += 1;
            map.set(rIdx, (prev ?? 0) + alloc.loadingUnits);
            totalRowLu += alloc.loadingUnits;
          }
        }
      }
    } else if (f.subDropperId && subDropperById.has(f.subDropperId)) {
      const lu = Math.max(0, f.loadingUnits);
      const map = subLuByIdRow.get(f.subDropperId)!;
      map.set(rIdx, lu);
      servedRisers = 1;
      totalRowLu = lu;
    } else {
      const assignedDroppers = strategyDroppersByRow.get(rIdx) ?? [];
      const floorLu = Math.max(0, f.loadingUnits);
      for (const dropper of assignedDroppers) {
        const shareLu = floorLu / dropper.luShareDivisor;
        const map = directMainLuByDropperRow.get(dropper.dropperIndex)!;
        map.set(rIdx, (map.get(rIdx) ?? 0) + shareLu);
        servedRisers += 1;
        totalRowLu += shareLu;
      }
    }

    servedCountByRow.set(rIdx, servedRisers);
    totalAssignedLuByRow.set(rIdx, totalRowLu);
  });

  // Populate resolved sub-dropper served rows and exact totalLu from subLuByIdRow
  for (const sd of resolvedSubDroppers) {
    const map = subLuByIdRow.get(sd.config.id)!;
    sd.servedRowIndices = Array.from(map.keys()).sort((a, b) => a - b);
    let total = 0;
    map.forEach((lu) => {
      total += lu;
    });
    sd.totalLu = total;
  }

  // Group resolved sub-droppers by parent main dropper
  const subDroppersByParent = new Map<number, ResolvedSubDropper[]>();
  for (const sd of resolvedSubDroppers) {
    const list = subDroppersByParent.get(sd.resolvedParentDropperIndex) ?? [];
    list.push(sd);
    subDroppersByParent.set(sd.resolvedParentDropperIndex, list);
  }

  // Initialize per-row cell maps
  const rowDropperCells: Record<number, DropperCellResult>[] = floors.map(() => ({}));
  const rowSubDropperCells: Record<string, SubDropperCellResult>[] = floors.map(() => ({}));
  const prvList: PrvInstallationDetail[] = [];
  const dropperSummaries: DropperZoneSummary[] = [];
  const subDropperSummaries: SubDropperSummary[] = [];
  const warnings: string[] = [];

  // Track outlet working pressure on each main dropper at every row so sub-droppers receive exact branch pressure
  const parentOutletPressureByDropperRow = new Map<number, Map<number, number>>();

  // Process each Main Dropper independently
  for (const dropper of droppers) {
    const attachedSds = subDroppersByParent.get(dropper.dropperIndex) ?? [];
    const directServedMap =
      directMainLuByDropperRow.get(dropper.dropperIndex) ?? new Map<number, number>();
    const directServedRowIndices = Array.from(directServedMap.keys()).sort((a, b) => a - b);

    if (directServedRowIndices.length === 0 && attachedSds.length === 0) continue;

    const directServedSet = new Set(directServedRowIndices);
    const maxDirectRow =
      directServedRowIndices.length > 0
        ? directServedRowIndices[directServedRowIndices.length - 1]
        : 0;
    const maxBranchRow =
      attachedSds.length > 0
        ? Math.max(...attachedSds.map((sd) => sd.branchRowIdx))
        : 0;
    const bottomReachRow = Math.max(maxDirectRow, maxBranchRow);

    // Map branch LU contributions per row for sub-droppers tapping off this main dropper
    const branchLuByRow = new Map<number, number>();
    const branchCountByRow = new Map<number, number>();
    for (const sd of attachedSds) {
      branchLuByRow.set(
        sd.branchRowIdx,
        (branchLuByRow.get(sd.branchRowIdx) ?? 0) + sd.totalLu
      );
      branchCountByRow.set(
        sd.branchRowIdx,
        (branchCountByRow.get(sd.branchRowIdx) ?? 0) + 1
      );
    }

    // Bottom-up cumulative LU per main riser (using exact assigned split/full floor LU + sub-dropper branch demand)
    let cumLu = 0;
    const cumLuAtRow = new Map<number, number>();
    for (let r = bottomReachRow; r >= 0; r--) {
      if (directServedSet.has(r)) {
        cumLu += directServedMap.get(r) ?? 0;
      }
      const branchLu = branchLuByRow.get(r) ?? 0;
      if (branchLu > 0) {
        cumLu += branchLu;
      }
      cumLuAtRow.set(r, cumLu);
    }

    // Top-down working pressure & PRV calculation along main dropper down to bottomReachRow
    let prevWorkingPressureBar: number | null = null;
    let prevRowIdx: number | null = null;
    const outletPressureMap = new Map<number, number>();
    parentOutletPressureByDropperRow.set(dropper.dropperIndex, outletPressureMap);

    let minWorkBar = Infinity;
    let maxWorkBar = -Infinity;
    let peakVelocity = 0;
    let headerNomMm: number | null = null;
    let headerInnerMm: number | null = null;
    let headerSpecId: PipeSpecId = pipeSpec.id;
    let headerIsFallbackMaterial = false;
    let dropperUsesFallback = false;
    let dropperMaxReqDiMm: number | null = null;
    let minNomMm: number | null = null;
    let dropperPrvCount = 0;
    let dropperExceedsCap = false;
    let dropperCavitationCount = 0;
    let dropperSplitFloorCount = 0;

    const rawCustomMainBoost =
      parameters.dropperBoosterPressures?.[dropper.dropperIndex] ??
      (dropper.sourceKey !== undefined
        ? parameters.dropperBoosterPressures?.[dropper.sourceKey]
        : undefined);
    const hasCustomBoosterPressure =
      dropper.zoneType === 'Booster' &&
      rawCustomMainBoost !== undefined &&
      Number.isFinite(rawCustomMainBoost) &&
      rawCustomMainBoost > 0;
    const effectiveDropperBoostBar =
      dropper.zoneType === 'Booster'
        ? hasCustomBoosterPressure
          ? rawCustomMainBoost!
          : parameters.boosterPumpBoostBar
        : 0;

    for (let r = 0; r <= bottomReachRow; r++) {
      const isServed = directServedSet.has(r);
      const isPassThrough = !isServed;
      const floorInput = floors[r];
      const isRoofHeader = floorInput.supplyMode === SupplyMode.ROOF_HEADER;

      const assignedFloorLu = isServed ? directServedMap.get(r) ?? 0 : 0;
      const rowServedCount = servedCountByRow.get(r) ?? 1;
      const rowTotalAssignedLu = totalAssignedLuByRow.get(r) ?? 0;
      const isSplitLoad = isServed && rowServedCount > 1;
      const loadFraction = isServed
        ? isSplitLoad
          ? rowTotalAssignedLu > 0
            ? assignedFloorLu / rowTotalAssignedLu
            : 1 / rowServedCount
          : 1
        : 0;
      if (isSplitLoad) {
        dropperSplitFloorCount += 1;
      }

      const rowCumLu = cumLuAtRow.get(r) ?? 0;
      const qLs = calculateFlowRateFromLu(rowCumLu, parameters.flowFormula, parameters.standard);
      const pipeSelection = selectPipeSizeByVelocity(
        qLs,
        pipeSpec,
        parameters.maxVelocityMs,
        optionalPipeSpec,
        parameters.excludedPipeSizes
      );

      if (pipeSelection.exceedsMaxCapacity) {
        dropperExceedsCap = true;
      }
      if (pipeSelection.isFallbackMaterial) {
        dropperUsesFallback = true;
      }
      if (
        pipeSelection.requiredInnerDiaMm !== null &&
        (dropperMaxReqDiMm === null || pipeSelection.requiredInnerDiaMm > dropperMaxReqDiMm)
      ) {
        dropperMaxReqDiMm = pipeSelection.requiredInnerDiaMm;
      }
      if (pipeSelection.velocityMs !== null && pipeSelection.velocityMs > peakVelocity) {
        peakVelocity = pipeSelection.velocityMs;
      }
      if (pipeSelection.selected) {
        const selInner = pipeSelection.selected.innerDiameter ?? 0;
        if (headerInnerMm === null || selInner > headerInnerMm) {
          headerNomMm = pipeSelection.selected.nominalSize;
          headerInnerMm = pipeSelection.selected.innerDiameter;
          headerSpecId = pipeSelection.specId;
          headerIsFallbackMaterial = pipeSelection.isFallbackMaterial;
        }
        if (minNomMm === null || pipeSelection.selected.nominalSize < minNomMm) {
          minNomMm = pipeSelection.selected.nominalSize;
        }
      }

      if (isRoofHeader && !isServed) {
        rowDropperCells[r][dropper.dropperIndex] = {
          dropperIndex: dropper.dropperIndex,
          isServed: false,
          isExpressPassThrough: true,
          assignedFloorLu: 0,
          loadFraction: 0,
          isSplitLoad: false,
          workingPressureBar: null,
          pipePressureBar: null,
          unreducedPressureBar: null,
          cumulativeLu: rowCumLu,
          flowRateLs: qLs,
          selectedNominalMm: pipeSelection.selected?.nominalSize ?? null,
          selectedOuterMm: pipeSelection.selected?.outerDiameter ?? null,
          selectedInnerMm: pipeSelection.selected?.innerDiameter ?? null,
          selectedSpecId: pipeSelection.specId,
          isFallbackMaterial: pipeSelection.isFallbackMaterial,
          requiredInnerDiaMm: pipeSelection.requiredInnerDiaMm,
          velocityMs: pipeSelection.velocityMs,
          exceedsMaxPipeCapacity: pipeSelection.exceedsMaxCapacity,
          hasPrv: false,
          subDropperBranchCount: branchCountByRow.get(r) ?? 0,
        };
        continue;
      }

      // Compute arrival static/boosted pressure along this dropper (including pass-throughs)
      let arrivalPressureBar: number;
      if (prevWorkingPressureBar === null || prevRowIdx === null) {
        arrivalPressureBar = staticPressuresBar[r] + effectiveDropperBoostBar;
      } else {
        const deltaHeadM = cumulativeHeadsM[r] - cumulativeHeadsM[prevRowIdx];
        arrivalPressureBar = prevWorkingPressureBar + deltaHeadM * GRAVITY_BAR_PER_METER;
      }

      const dropperSpecificOverride =
        floorInput.dropperPrvOverrides?.[dropper.dropperIndex] ??
        (dropper.sourceKey !== undefined
          ? floorInput.dropperPrvOverrides?.[dropper.sourceKey]
          : undefined);

      const effectiveOverride =
        dropperSpecificOverride ?? (isServed ? floorInput.prvOverride : PrvOverrideMode.NO_PRV);

      let installPrv = false;
      if (effectiveOverride === PrvOverrideMode.FORCE_PRV) {
        installPrv = true;
      } else if (effectiveOverride === PrvOverrideMode.NO_PRV) {
        installPrv = false;
      } else {
        installPrv = isServed && arrivalPressureBar > parameters.maxStaticPressureBar + 1e-6;
      }

      const dropperSpecificSetPressure =
        floorInput.dropperPrvSetPressures?.[dropper.dropperIndex] ??
        (dropper.sourceKey !== undefined
          ? floorInput.dropperPrvSetPressures?.[dropper.sourceKey]
          : undefined);

      let workingPressureBar = arrivalPressureBar;
      let prvDetail: PrvInstallationDetail | undefined;

      if (installPrv) {
        const p1 = arrivalPressureBar;
        const customP2 =
          dropperSpecificSetPressure !== undefined &&
          Number.isFinite(dropperSpecificSetPressure) &&
          dropperSpecificSetPressure > 0
            ? dropperSpecificSetPressure
            : null;
        const p2 = customP2 ?? parameters.prvSetPressureBar;
        const deltaP = p2 - p1;
        const ratio = p2 > 0 ? p1 / p2 : 99.9;
        const cavitationWarning = ratio > cavitationLimit + 1e-9;
        const recDn = selectPrvValveDn(qLs, parameters.maxVelocityMs);

        workingPressureBar = p2;
        dropperPrvCount += 1;
        if (cavitationWarning) {
          dropperCavitationCount += 1;
        }

        prvDetail = {
          floorId: floorInput.id,
          floorLabel: floorInput.floorLabel,
          dropperIndex: dropper.dropperIndex,
          dropperName: dropper.label,
          upstreamPressureBar: p1,
          downstreamPressureBar: p2,
          deltaPressureBar: deltaP,
          pressureRatio: ratio,
          cavitationWarning,
          flowRateLs: qLs,
          recommendedValveDn: recDn,
          isManualOverride: effectiveOverride === PrvOverrideMode.FORCE_PRV,
          isCustomSetPressure: customP2 !== null,
        };
        prvList.push(prvDetail);
      }

      prevWorkingPressureBar = workingPressureBar;
      prevRowIdx = r;
      outletPressureMap.set(r, workingPressureBar);

      if (isServed) {
        if (workingPressureBar < minWorkBar) minWorkBar = workingPressureBar;
        if (workingPressureBar > maxWorkBar) maxWorkBar = workingPressureBar;
      }

      rowDropperCells[r][dropper.dropperIndex] = {
        dropperIndex: dropper.dropperIndex,
        isServed,
        isExpressPassThrough: isPassThrough,
        assignedFloorLu,
        loadFraction,
        isSplitLoad,
        workingPressureBar: isServed ? workingPressureBar : null,
        pipePressureBar: workingPressureBar,
        unreducedPressureBar: installPrv ? arrivalPressureBar : null,
        cumulativeLu: rowCumLu,
        flowRateLs: qLs,
        selectedNominalMm: pipeSelection.selected?.nominalSize ?? null,
        selectedOuterMm: pipeSelection.selected?.outerDiameter ?? null,
        selectedInnerMm: pipeSelection.selected?.innerDiameter ?? null,
        selectedSpecId: pipeSelection.specId,
        isFallbackMaterial: pipeSelection.isFallbackMaterial,
        requiredInnerDiaMm: pipeSelection.requiredInnerDiaMm,
        velocityMs: pipeSelection.velocityMs,
        exceedsMaxPipeCapacity: pipeSelection.exceedsMaxCapacity,
        hasPrv: installPrv,
        prvDetail,
        subDropperBranchCount: branchCountByRow.get(r) ?? 0,
      };
    }

    const totalZoneLu = cumLuAtRow.get(0) ?? 0;
    const peakFlowLs = calculateFlowRateFromLu(totalZoneLu, parameters.flowFormula, parameters.standard);

    let servedFloorRange = 'Express Feeder';
    if (directServedRowIndices.length > 0) {
      const topLabel = floors[directServedRowIndices[0]].floorLabel;
      const botLabel = floors[directServedRowIndices[directServedRowIndices.length - 1]].floorLabel;
      servedFloorRange = topLabel === botLabel ? topLabel : `${topLabel} – ${botLabel}`;
    } else if (attachedSds.length > 0) {
      servedFloorRange = `→ ${attachedSds.map((s) => s.config.label).join(', ')}`;
    }

    dropperSummaries.push({
      dropperIndex: dropper.dropperIndex,
      label: dropper.label,
      zoneType: dropper.zoneType,
      hasBoosterPump: dropper.zoneType === 'Booster',
      boosterPressureBar:
        dropper.zoneType === 'Booster' ? effectiveDropperBoostBar : null,
      isCustomBoosterPressure: hasCustomBoosterPressure,
      parallelCount: 1,
      servedFloorRange,
      servedFloorCount: directServedRowIndices.length,
      splitFloorCount: dropperSplitFloorCount,
      totalZoneLu,
      peakFlowRateLs: peakFlowLs,
      headerNominalMm: headerNomMm,
      headerInnerMm: headerInnerMm,
      headerSpecId,
      headerIsFallbackMaterial,
      usesFallbackMaterial: dropperUsesFallback,
      maxRequiredInnerDiaMm: dropperMaxReqDiMm,
      minNominalMm: minNomMm,
      peakVelocityMs: peakVelocity > 0 ? peakVelocity : null,
      minWorkingPressureBar: minWorkBar !== Infinity ? minWorkBar : null,
      maxWorkingPressureBar: maxWorkBar !== -Infinity ? maxWorkBar : null,
      prvCount: dropperPrvCount,
      exceedsCapacity: dropperExceedsCap,
      cavitationRiskCount: dropperCavitationCount,
      attachedSubDropperIds: attachedSds.map((s) => s.config.id),
    });

    if (dropperExceedsCap) {
      const reqDi = dropperMaxReqDiMm ?? calculateRequiredInnerDiaMm(peakFlowLs, parameters.maxVelocityMs);
      warnings.push(
        buildSizingShortfallWarning(
          `${dropper.label} (${servedFloorRange})`,
          peakFlowLs,
          reqDi
        )
      );
    }
  }

  // Process each Sub-Dropper (tapping off parent main dropper at branchRowIdx)
  for (const sd of resolvedSubDroppers) {
    const parentSummary = dropperSummaries.find(
      (d) => d.dropperIndex === sd.resolvedParentDropperIndex
    );
    const parentZoneType = parentSummary?.zoneType ?? 'Gravity';
    const bIdx = sd.branchRowIdx;
    const servedSet = new Set(sd.servedRowIndices);
    const hasServed = sd.servedRowIndices.length > 0;
    const topServedRow = hasServed ? sd.servedRowIndices[0] : bIdx;
    const bottomServedRow = hasServed ? sd.servedRowIndices[sd.servedRowIndices.length - 1] : bIdx;
    const minRow = Math.min(bIdx, topServedRow);
    const maxRow = Math.max(bIdx, bottomServedRow);

    let flowOrientation: SubDropperSummary['flowOrientation'] = 'Unassigned';
    if (hasServed) {
      const hasAbove = topServedRow < bIdx;
      const hasBelow = bottomServedRow > bIdx;
      if (hasAbove && hasBelow) flowOrientation = 'Bidirectional';
      else if (hasAbove) flowOrientation = 'Up-Feed';
      else if (hasBelow) flowOrientation = 'Down-Feed';
      else flowOrientation = 'Single-Floor';
    }

    const subServedMap = subLuByIdRow.get(sd.config.id) ?? new Map<number, number>();

    // Compute cumulative LU along the sub-dropper away from the branch junction bIdx
    const cumLuAtRow = new Map<number, number>();
    // At branch junction bIdx: total LU entering the sub-dropper
    cumLuAtRow.set(bIdx, sd.totalLu);

    // Up-feed arm (r < bIdx): cumulative LU increases moving down from topServedRow toward bIdx
    let upCumLu = 0;
    for (let r = minRow; r < bIdx; r++) {
      if (servedSet.has(r)) {
        upCumLu += subServedMap.get(r) ?? 0;
      }
      cumLuAtRow.set(r, upCumLu);
    }

    // Down-feed arm (r > bIdx): cumulative LU increases moving up from bottomServedRow toward bIdx
    let downCumLu = 0;
    for (let r = maxRow; r > bIdx; r--) {
      if (servedSet.has(r)) {
        downCumLu += subServedMap.get(r) ?? 0;
      }
      cumLuAtRow.set(r, downCumLu);
    }

    // Arrival pressure at bIdx from parent main dropper outlet pressure + optional sub-dropper inline booster pump
    const parentOutletMap = parentOutletPressureByDropperRow.get(sd.resolvedParentDropperIndex);
    const baseInletArrivalBar =
      parentOutletMap?.get(bIdx) ??
      staticPressuresBar[bIdx] + (parentSummary?.boosterPressureBar ?? 0);
    const hasOwnBoosterPump = Boolean(sd.config.hasBoosterPump);
    const hasCustomSubBoost =
      hasOwnBoosterPump &&
      sd.config.boosterBoostBar !== undefined &&
      Number.isFinite(sd.config.boosterBoostBar) &&
      sd.config.boosterBoostBar > 0;
    const effectiveSubBoostBar = hasOwnBoosterPump
      ? hasCustomSubBoost
        ? sd.config.boosterBoostBar!
        : parameters.boosterPumpBoostBar
      : 0;
    const inletArrivalBar = baseInletArrivalBar + effectiveSubBoostBar;

    let minWorkBar = Infinity;
    let maxWorkBar = -Infinity;
    let peakVelocity = 0;
    let baseNomMm: number | null = null;
    let baseInnerMm: number | null = null;
    let baseSpecId: PipeSpecId = pipeSpec.id;
    let baseIsFallbackMaterial = false;
    let sdUsesFallback = false;
    let sdMaxReqDiMm: number | null = null;
    let terminalNomMm: number | null = null;
    let sdPrvCount = 0;
    let sdExceedsCap = false;
    let sdCavitationCount = 0;
    let sdInsufficientHead = false;
    let sdSplitFloorCount = 0;

    const evaluateRow = (
      r: number,
      arrivalPressureBar: number,
      flowDirection: 'up' | 'down' | 'junction'
    ): number => {
      const floorInput = floors[r];
      const isServed = servedSet.has(r);
      const isBranchJunction = r === bIdx;
      const isExpressPassThrough = !isServed;
      const assignedFloorLu = isServed ? subServedMap.get(r) ?? 0 : 0;
      const rowServedCount = servedCountByRow.get(r) ?? 1;
      const rowTotalAssignedLu = totalAssignedLuByRow.get(r) ?? 0;
      const isSplitLoad = isServed && rowServedCount > 1;
      const loadFraction = isServed
        ? isSplitLoad
          ? rowTotalAssignedLu > 0
            ? assignedFloorLu / rowTotalAssignedLu
            : 1 / rowServedCount
          : 1
        : 0;
      if (isSplitLoad) {
        sdSplitFloorCount += 1;
      }
      const rowCumLu = cumLuAtRow.get(r) ?? 0;
      const qLs = calculateFlowRateFromLu(rowCumLu, parameters.flowFormula, parameters.standard);
      const pipeSelection = selectPipeSizeByVelocity(
        qLs,
        pipeSpec,
        parameters.maxVelocityMs,
        optionalPipeSpec,
        parameters.excludedPipeSizes
      );

      if (pipeSelection.exceedsMaxCapacity) sdExceedsCap = true;
      if (pipeSelection.isFallbackMaterial) sdUsesFallback = true;
      if (
        pipeSelection.requiredInnerDiaMm !== null &&
        (sdMaxReqDiMm === null || pipeSelection.requiredInnerDiaMm > sdMaxReqDiMm)
      ) {
        sdMaxReqDiMm = pipeSelection.requiredInnerDiaMm;
      }
      if (pipeSelection.velocityMs !== null && pipeSelection.velocityMs > peakVelocity) {
        peakVelocity = pipeSelection.velocityMs;
      }
      if (pipeSelection.selected) {
        if (isBranchJunction) {
          baseNomMm = pipeSelection.selected.nominalSize;
          baseInnerMm = pipeSelection.selected.innerDiameter;
          baseSpecId = pipeSelection.specId;
          baseIsFallbackMaterial = pipeSelection.isFallbackMaterial;
        }
        if (isServed && (terminalNomMm === null || pipeSelection.selected.nominalSize < terminalNomMm)) {
          terminalNomMm = pipeSelection.selected.nominalSize;
        }
      }

      const sdSpecificOverride = floorInput.subDropperPrvOverrides?.[sd.config.id];
      const effectiveOverride =
        sdSpecificOverride ?? (isServed ? floorInput.prvOverride : PrvOverrideMode.NO_PRV);

      let installPrv = false;
      if (effectiveOverride === PrvOverrideMode.FORCE_PRV) {
        installPrv = true;
      } else if (effectiveOverride === PrvOverrideMode.NO_PRV) {
        installPrv = false;
      } else {
        installPrv = isServed && arrivalPressureBar > parameters.maxStaticPressureBar + 1e-6;
      }

      const sdCustomSetPressure = floorInput.subDropperPrvSetPressures?.[sd.config.id];
      let workingPressureBar = arrivalPressureBar;
      let prvDetail: PrvInstallationDetail | undefined;

      if (installPrv) {
        const p1 = arrivalPressureBar;
        const customP2 =
          sdCustomSetPressure !== undefined &&
          Number.isFinite(sdCustomSetPressure) &&
          sdCustomSetPressure > 0
            ? sdCustomSetPressure
            : null;
        const p2 = customP2 ?? parameters.prvSetPressureBar;
        const deltaP = p2 - p1;
        const ratio = p2 > 0 ? p1 / p2 : 99.9;
        const cavitationWarning = ratio > cavitationLimit + 1e-9;
        const recDn = selectPrvValveDn(qLs, parameters.maxVelocityMs);

        workingPressureBar = p2;
        sdPrvCount += 1;
        if (cavitationWarning) sdCavitationCount += 1;

        prvDetail = {
          floorId: floorInput.id,
          floorLabel: floorInput.floorLabel,
          dropperIndex: sd.resolvedParentDropperIndex,
          subDropperId: sd.config.id,
          dropperName: `${sd.config.label} (← D${sd.resolvedParentDropperIndex} @ ${floors[bIdx].floorLabel})`,
          upstreamPressureBar: p1,
          downstreamPressureBar: p2,
          deltaPressureBar: deltaP,
          pressureRatio: ratio,
          cavitationWarning,
          flowRateLs: qLs,
          recommendedValveDn: recDn,
          isManualOverride: effectiveOverride === PrvOverrideMode.FORCE_PRV,
          isCustomSetPressure: customP2 !== null,
        };
        prvList.push(prvDetail);
      }

      if (isServed) {
        if (workingPressureBar < minWorkBar) minWorkBar = workingPressureBar;
        if (workingPressureBar > maxWorkBar) maxWorkBar = workingPressureBar;
        if (workingPressureBar <= 0.1) sdInsufficientHead = true;
      }

      rowSubDropperCells[r][sd.config.id] = {
        subDropperId: sd.config.id,
        parentDropperIndex: sd.resolvedParentDropperIndex,
        isServed,
        isBranchJunction,
        isExpressPassThrough,
        assignedFloorLu,
        loadFraction,
        isSplitLoad,
        flowDirection,
        workingPressureBar: isServed ? workingPressureBar : null,
        pipePressureBar: workingPressureBar,
        parentBranchArrivalBar: isBranchJunction ? baseInletArrivalBar : null,
        unreducedPressureBar: installPrv ? arrivalPressureBar : null,
        cumulativeLu: rowCumLu,
        flowRateLs: qLs,
        selectedNominalMm: pipeSelection.selected?.nominalSize ?? null,
        selectedOuterMm: pipeSelection.selected?.outerDiameter ?? null,
        selectedInnerMm: pipeSelection.selected?.innerDiameter ?? null,
        selectedSpecId: pipeSelection.specId,
        isFallbackMaterial: pipeSelection.isFallbackMaterial,
        requiredInnerDiaMm: pipeSelection.requiredInnerDiaMm,
        velocityMs: pipeSelection.velocityMs,
        exceedsMaxPipeCapacity: pipeSelection.exceedsMaxCapacity,
        hasPrv: installPrv,
        prvDetail,
      };

      return workingPressureBar;
    };

    // 1. Evaluate branch junction row bIdx first
    const branchOutletBar = evaluateRow(bIdx, inletArrivalBar, 'junction');

    // 2. Propagate UPWARD from bIdx - 1 up to minRow (pressure decreases by 0.0981 bar/m)
    let upPrevBar = branchOutletBar;
    let upPrevRow = bIdx;
    for (let r = bIdx - 1; r >= minRow; r--) {
      if (floors[r].supplyMode === SupplyMode.ROOF_HEADER) continue;
      const deltaHeadM = cumulativeHeadsM[r] - cumulativeHeadsM[upPrevRow]; // Negative going up
      const arrivalBar = upPrevBar + deltaHeadM * GRAVITY_BAR_PER_METER;
      upPrevBar = evaluateRow(r, arrivalBar, 'up');
      upPrevRow = r;
    }

    // 3. Propagate DOWNWARD from bIdx + 1 down to maxRow (pressure increases by 0.0981 bar/m)
    let downPrevBar = branchOutletBar;
    let downPrevRow = bIdx;
    for (let r = bIdx + 1; r <= maxRow; r++) {
      if (floors[r].supplyMode === SupplyMode.ROOF_HEADER) continue;
      const deltaHeadM = cumulativeHeadsM[r] - cumulativeHeadsM[downPrevRow]; // Positive going down
      const arrivalBar = downPrevBar + deltaHeadM * GRAVITY_BAR_PER_METER;
      downPrevBar = evaluateRow(r, arrivalBar, 'down');
      downPrevRow = r;
    }

    const peakFlowLs = calculateFlowRateFromLu(sd.totalLu, parameters.flowFormula, parameters.standard);
    const servedRange = hasServed
      ? topServedRow === bottomServedRow
        ? floors[topServedRow].floorLabel
        : `${floors[topServedRow].floorLabel} – ${floors[bottomServedRow].floorLabel}`
      : 'Unassigned';

    subDropperSummaries.push({
      id: sd.config.id,
      label: sd.config.label,
      parentDropperIndex: sd.resolvedParentDropperIndex,
      parentDropperLabel: `D${sd.resolvedParentDropperIndex}`,
      branchFloorId: floors[bIdx].id,
      branchFloorLabel: floors[bIdx].floorLabel,
      branchRowIdx: bIdx,
      zoneType: hasOwnBoosterPump || parentZoneType === 'Booster' ? 'Booster' : 'Gravity',
      hasBoosterPump: hasOwnBoosterPump,
      boosterPressureBar: hasOwnBoosterPump ? effectiveSubBoostBar : null,
      isCustomBoosterPressure: hasCustomSubBoost,
      flowOrientation,
      servedFloorRange: servedRange,
      servedFloorCount: sd.servedRowIndices.length,
      splitFloorCount: sdSplitFloorCount,
      totalZoneLu: sd.totalLu,
      peakFlowRateLs: peakFlowLs,
      baseNominalMm: baseNomMm,
      baseInnerMm: baseInnerMm,
      baseSpecId,
      baseIsFallbackMaterial,
      usesFallbackMaterial: sdUsesFallback,
      maxRequiredInnerDiaMm: sdMaxReqDiMm,
      terminalNominalMm: terminalNomMm,
      peakVelocityMs: peakVelocity > 0 ? peakVelocity : null,
      minWorkingPressureBar: minWorkBar !== Infinity ? minWorkBar : null,
      maxWorkingPressureBar: maxWorkBar !== -Infinity ? maxWorkBar : null,
      prvCount: sdPrvCount,
      exceedsCapacity: sdExceedsCap,
      cavitationRiskCount: sdCavitationCount,
    });

    if (sdExceedsCap) {
      const reqDi = sdMaxReqDiMm ?? calculateRequiredInnerDiaMm(peakFlowLs, parameters.maxVelocityMs);
      warnings.push(
        buildSizingShortfallWarning(
          `Sub-Dropper ${sd.config.label} (${servedRange})`,
          peakFlowLs,
          reqDi
        )
      );
    }
    if (sdInsufficientHead) {
      warnings.push(
        `Sub-Dropper ${sd.config.label} (${servedRange}): Minimum working pressure drops to ${minWorkBar.toFixed(2)} bar (≤ 0.10 bar). Increase upstream PRV P2 or move branch junction higher.`
      );
    }
  }

  for (const prv of prvList) {
    if (prv.cavitationWarning) {
      warnings.push(
        `Cavitation Risk at Floor ${prv.floorLabel} (${prv.dropperName}): P1/P2 ratio is ${prv.pressureRatio.toFixed(2)} (> ${cavitationLimitLabel} limit, P1 = ${prv.upstreamPressureBar.toFixed(2)} bar → P2 = ${prv.downstreamPressureBar.toFixed(2)} bar). Recommend two-stage series PRV station or intermediate pressure zone.`
      );
    }
  }

  // Assemble CalculatedFloorRow list with primary equipment/fitting tags matching the engineering schedule
  const boostedMainDropperSet = new Set(
    dropperSummaries.filter((d) => d.hasBoosterPump).map((d) => d.dropperIndex)
  );
  const gravityMainDropperSet = new Set(
    dropperSummaries.filter((d) => !d.hasBoosterPump).map((d) => d.dropperIndex)
  );
  let firstActualBoosterRowIdx = -1;
  let firstActualGravityRowIdx = -1;
  for (let rIdx = 0; rIdx < floors.length; rIdx++) {
    if (floors[rIdx].supplyMode === SupplyMode.ROOF_HEADER) continue;
    const servedMain = Object.values(rowDropperCells[rIdx]).filter((c) => c.isServed);
    if (
      firstActualBoosterRowIdx < 0 &&
      servedMain.some((c) => boostedMainDropperSet.has(c.dropperIndex))
    ) {
      firstActualBoosterRowIdx = rIdx;
    }
    if (
      firstActualGravityRowIdx < 0 &&
      servedMain.some((c) => gravityMainDropperSet.has(c.dropperIndex))
    ) {
      firstActualGravityRowIdx = rIdx;
    }
  }
  const subLabelById = new Map(subDropperSummaries.map((s) => [s.id, s.label]));

  let overallMaxVel = 0;
  let overallMaxWorkP = 0;
  let splitFloorCount = 0;

  const calculatedRows: CalculatedFloorRow[] = floors.map((floor, rIdx) => {
    const cells = rowDropperCells[rIdx];
    const subCells = rowSubDropperCells[rIdx];
    const servedMainCells = Object.values(cells)
      .filter((c) => c.isServed)
      .sort((a, b) => a.dropperIndex - b.dropperIndex);
    const servedSubCells = Object.values(subCells).filter((c) => c.isServed);

    // Build ordered per-riser allocation telemetry for this floor
    const riserAllocations: FloorRiserAllocationResult[] = [
      ...servedMainCells.map((c) => ({
        target: { kind: 'main' as const, dropperIndex: c.dropperIndex },
        riserLabel: `D${c.dropperIndex}`,
        assignedLu: c.assignedFloorLu,
        loadFraction: c.loadFraction,
        cumulativeLu: c.cumulativeLu,
        flowRateLs: c.flowRateLs,
        nominalMm: c.selectedNominalMm,
        innerMm: c.selectedInnerMm,
        specId: c.selectedSpecId,
        isFallbackMaterial: c.isFallbackMaterial,
        velocityMs: c.velocityMs,
        workingPressureBar: c.workingPressureBar,
        hasPrv: c.hasPrv,
      })),
      ...servedSubCells.map((sc) => ({
        target: { kind: 'sub' as const, subDropperId: sc.subDropperId },
        riserLabel: subLabelById.get(sc.subDropperId) ?? sc.subDropperId,
        assignedLu: sc.assignedFloorLu,
        loadFraction: sc.loadFraction,
        cumulativeLu: sc.cumulativeLu,
        flowRateLs: sc.flowRateLs,
        nominalMm: sc.selectedNominalMm,
        innerMm: sc.selectedInnerMm,
        specId: sc.selectedSpecId,
        isFallbackMaterial: sc.isFallbackMaterial,
        velocityMs: sc.velocityMs,
        workingPressureBar: sc.workingPressureBar,
        hasPrv: sc.hasPrv,
      })),
    ];

    const isSplitFloor = riserAllocations.length > 1;
    if (isSplitFloor) {
      splitFloorCount += 1;
    }

    const primarySubCell = servedSubCells[0] ?? null;
    const primaryMainCell = servedMainCells[0] ?? Object.values(cells)[0] ?? null;

    // For split floors, pick the governing served riser (highest velocity, tie-break highest flow)
    // so schedule velocity/OD summaries reflect the controlling branch.
    let primaryActiveCell: DropperCellResult | SubDropperCellResult | null =
      primarySubCell ?? primaryMainCell;
    if (isSplitFloor) {
      const allServed: Array<DropperCellResult | SubDropperCellResult> = [
        ...servedMainCells,
        ...servedSubCells,
      ];
      primaryActiveCell = allServed.reduce((best, curr) => {
        const bestVel = best.velocityMs ?? -1;
        const currVel = curr.velocityMs ?? -1;
        if (Math.abs(currVel - bestVel) > 1e-4) {
          return currVel > bestVel ? curr : best;
        }
        return curr.flowRateLs > best.flowRateLs ? curr : best;
      }, allServed[0]);
    }

    // Determine Equipment / Fitting tag for this row
    let equipmentTag: 'Pump' | 'Gravity' | 'PRV' | '' = '';
    let boostedRiserLabels: string[] | undefined;
    let boostedRiserDetails:
      | Array<{ label: string; boostBar: number; isCustom: boolean }>
      | undefined;
    let primaryFlowRateLs: number | null = null;
    let primaryDeltaPBar: number | null = null;
    let primaryPrvRatio: number | null = null;

    const allSubPrvCells = Object.values(subCells).filter((c) => c.hasPrv && c.prvDetail);
    const allMainPrvCells = Object.values(cells).filter((c) => c.hasPrv && c.prvDetail);
    const prvCell =
      servedSubCells.find((c) => c.hasPrv && c.prvDetail) ??
      servedMainCells.find((c) => c.hasPrv && c.prvDetail) ??
      allSubPrvCells[0] ??
      allMainPrvCells[0];

    const boostedSubsAtRow = subDropperSummaries.filter(
      (sd) => sd.hasBoosterPump && sd.branchRowIdx === rIdx
    );

    if (floor.supplyMode === SupplyMode.ROOF_HEADER) {
      const boostedMains = dropperSummaries.filter((d) => d.hasBoosterPump);
      if (boostedMains.length > 0) {
        equipmentTag = 'Pump';
        boostedRiserLabels = boostedMains.map((d) => `D${d.dropperIndex}`);
        boostedRiserDetails = boostedMains.map((d) => ({
          label: `D${d.dropperIndex}`,
          boostBar: d.boosterPressureBar ?? parameters.boosterPumpBoostBar,
          isCustom: d.isCustomBoosterPressure,
        }));
        primaryFlowRateLs = boostedMains.reduce((sum, d) => sum + d.peakFlowRateLs, 0);
        primaryDeltaPBar = Math.max(
          ...boostedRiserDetails.map((item) => item.boostBar)
        );
      }
    } else if (prvCell && prvCell.prvDetail) {
      equipmentTag = 'PRV';
      primaryFlowRateLs = prvCell.prvDetail.flowRateLs;
      primaryDeltaPBar = prvCell.prvDetail.deltaPressureBar;
      primaryPrvRatio = prvCell.prvDetail.pressureRatio;
      if (boostedSubsAtRow.length > 0) {
        boostedRiserLabels = boostedSubsAtRow.map((sd) => sd.label);
        boostedRiserDetails = boostedSubsAtRow.map((sd) => ({
          label: sd.label,
          boostBar: sd.boosterPressureBar ?? parameters.boosterPumpBoostBar,
          isCustom: sd.isCustomBoosterPressure,
        }));
      }
    } else if (boostedSubsAtRow.length > 0) {
      equipmentTag = 'Pump';
      boostedRiserLabels = boostedSubsAtRow.map((sd) => sd.label);
      boostedRiserDetails = boostedSubsAtRow.map((sd) => ({
        label: sd.label,
        boostBar: sd.boosterPressureBar ?? parameters.boosterPumpBoostBar,
        isCustom: sd.isCustomBoosterPressure,
      }));
      primaryFlowRateLs = boostedSubsAtRow.reduce((sum, sd) => sum + sd.peakFlowRateLs, 0);
      primaryDeltaPBar = Math.max(...boostedRiserDetails.map((item) => item.boostBar));
    } else if (
      rIdx === firstActualBoosterRowIdx &&
      !floors.some((f) => f.supplyMode === SupplyMode.ROOF_HEADER)
    ) {
      const boostedMains = dropperSummaries.filter((d) => d.hasBoosterPump);
      equipmentTag = 'Pump';
      boostedRiserLabels = boostedMains.map((d) => `D${d.dropperIndex}`);
      boostedRiserDetails = boostedMains.map((d) => ({
        label: `D${d.dropperIndex}`,
        boostBar: d.boosterPressureBar ?? parameters.boosterPumpBoostBar,
        isCustom: d.isCustomBoosterPressure,
      }));
      primaryFlowRateLs = primaryActiveCell?.flowRateLs ?? null;
      primaryDeltaPBar =
        boostedRiserDetails.length > 0
          ? Math.max(...boostedRiserDetails.map((item) => item.boostBar))
          : parameters.boosterPumpBoostBar;
    } else if (rIdx === firstActualGravityRowIdx) {
      equipmentTag = 'Gravity';
      primaryFlowRateLs = primaryActiveCell?.flowRateLs ?? null;
    }

    [...servedMainCells, ...servedSubCells].forEach((c) => {
      if (c.velocityMs !== null && c.velocityMs > overallMaxVel) {
        overallMaxVel = c.velocityMs;
      }
      if (c.workingPressureBar !== null && c.workingPressureBar > overallMaxWorkP) {
        overallMaxWorkP = c.workingPressureBar;
      }
    });

    // For ROOF_HEADER row, show booster dropper header size if present, else largest main header
    let primaryNominalMm = primaryActiveCell?.selectedNominalMm ?? null;
    let primaryInnerMm = primaryActiveCell?.selectedInnerMm ?? null;
    let primarySpecId: PipeSpecId = primaryActiveCell?.selectedSpecId ?? pipeSpec.id;
    let primaryIsFallbackMaterial = primaryActiveCell?.isFallbackMaterial ?? false;
    let primaryVelocityMs = primaryActiveCell?.velocityMs ?? null;
    let primaryCumulativeLu = primaryActiveCell?.cumulativeLu ?? 0;

    if (floor.supplyMode === SupplyMode.ROOF_HEADER) {
      const boosterCell = Object.values(cells).find((c) => {
        const ds = dropperSummaries.find((d) => d.dropperIndex === c.dropperIndex);
        return ds?.zoneType === 'Booster';
      });
      const targetHeader = boosterCell ?? primaryMainCell;
      if (targetHeader) {
        primaryNominalMm = targetHeader.selectedNominalMm;
        primaryInnerMm = targetHeader.selectedInnerMm;
        primarySpecId = targetHeader.selectedSpecId;
        primaryIsFallbackMaterial = targetHeader.isFallbackMaterial;
        primaryVelocityMs = targetHeader.velocityMs;
        primaryCumulativeLu = targetHeader.cumulativeLu;
      }
    }

    for (const c of servedMainCells) {
      if (
        c.workingPressureBar !== null &&
        c.workingPressureBar > parameters.maxStaticPressureBar + 1e-6
      ) {
        warnings.push(
          `Floor ${floor.floorLabel} (D${c.dropperIndex}): Working pressure (${c.workingPressureBar.toFixed(2)} bar) exceeds max allowable static pressure (${parameters.maxStaticPressureBar.toFixed(2)} bar) due to PRV removal or suppression.`
        );
      }
    }
    for (const c of servedSubCells) {
      if (
        c.workingPressureBar !== null &&
        c.workingPressureBar > parameters.maxStaticPressureBar + 1e-6
      ) {
        const sdLabel = subDropperSummaries.find((s) => s.id === c.subDropperId)?.label ?? c.subDropperId;
        warnings.push(
          `Floor ${floor.floorLabel} (${sdLabel}): Working pressure (${c.workingPressureBar.toFixed(2)} bar) exceeds max allowable static pressure (${parameters.maxStaticPressureBar.toFixed(2)} bar).`
        );
      }
    }

    return {
      input: floor,
      rowIndex: rIdx,
      cumulativeHeadM: cumulativeHeadsM[rIdx],
      staticPressureBar: staticPressuresBar[rIdx],
      equipmentTag,
      boostedRiserLabels,
      boostedRiserDetails,
      primaryDropperIndex: primarySubCell
        ? primarySubCell.parentDropperIndex
        : primaryMainCell?.dropperIndex ?? null,
      primarySubDropperId: primarySubCell?.subDropperId ?? null,
      primaryFlowRateLs: primaryFlowRateLs ?? primaryActiveCell?.flowRateLs ?? null,
      primaryDeltaPBar,
      primaryPrvRatio,
      primaryCumulativeLu,
      primaryNominalMm,
      primaryInnerMm,
      primarySpecId,
      primaryIsFallbackMaterial,
      primaryVelocityMs,
      primaryWorkingPressureBar:
        primarySubCell?.workingPressureBar ?? servedMainCells[0]?.workingPressureBar ?? null,
      isSplitFloor,
      servedRiserCount: riserAllocations.length,
      riserAllocations,
      dropperCells: cells,
      subDropperCells: subCells,
    };
  });

  const totalBuildingLu = floors.reduce((sum, f, rIdx) => {
    if (f.supplyMode === SupplyMode.ROOF_HEADER) return sum;
    const assigned = totalAssignedLuByRow.get(rIdx);
    if (effectiveSplitsByRow.has(rIdx) && assigned !== undefined) {
      return sum + assigned;
    }
    return sum + Math.max(0, f.loadingUnits);
  }, 0);

  const peakSystemFlowLs = calculateFlowRateFromLu(
    totalBuildingLu,
    parameters.flowFormula,
    parameters.standard
  );

  // Compute common Roof Tank Pipe Header size across all connected main droppers
  // Pipe Header velocity ceiling is 0.5 m/s lower than the global maximum velocity
  const headerMaxVelocityMs = getHeaderMaxVelocityMs(parameters.maxVelocityMs);
  const headerTotalLu = dropperSummaries.reduce((sum, d) => sum + d.totalZoneLu, 0);
  const headerFlowLs = calculateFlowRateFromLu(
    headerTotalLu,
    parameters.flowFormula,
    parameters.standard
  );
  const headerAutoSelection = selectPipeSizeByVelocity(
    headerFlowLs,
    pipeSpec,
    headerMaxVelocityMs,
    optionalPipeSpec,
    parameters.excludedPipeSizes
  );

  // Resolve optional manual custom Pipe Header nominal size override (if valid and active for primary or optional material)
  let customHeaderEntry: (PipeSizeEntry & { innerDiameter: number }) | null = null;
  let customHeaderSpec: PipeSpecificationTable = pipeSpec;
  let customHeaderIsFallback = false;

  if (parameters.pipeHeaderCustomSize) {
    const requestedSpecId = parameters.pipeHeaderCustomSize.specId ?? pipeSpec.id;
    let candidateSpec: PipeSpecificationTable | null = null;
    if (requestedSpecId === pipeSpec.id) {
      candidateSpec = pipeSpec;
    } else if (optionalPipeSpec && requestedSpecId === optionalPipeSpec.id) {
      candidateSpec = optionalPipeSpec;
    }

    if (candidateSpec) {
      const matched = getAvailablePipeSizes(candidateSpec, parameters.excludedPipeSizes).find(
        (s) => s.nominalSize === parameters.pipeHeaderCustomSize!.nominalSize
      );
      if (matched) {
        customHeaderEntry = matched;
        customHeaderSpec = candidateSpec;
        customHeaderIsFallback = Boolean(
          optionalPipeSpec &&
            candidateSpec.id === optionalPipeSpec.id &&
            candidateSpec.id !== pipeSpec.id
        );
      }
    }
  }

  const headerRequiredDiMm =
    headerFlowLs > 0 ? calculateRequiredInnerDiaMm(headerFlowLs, headerMaxVelocityMs) : null;

  const isCustomHeaderSize = customHeaderEntry !== null;
  const effectiveHeaderVelocityMs = isCustomHeaderSize
    ? headerFlowLs > 0
      ? calculateVelocityMs(headerFlowLs, customHeaderEntry!.innerDiameter)
      : 0
    : headerAutoSelection.velocityMs;
  const effectiveHeaderExceeds = isCustomHeaderSize
    ? headerFlowLs > 0 &&
      effectiveHeaderVelocityMs !== null &&
      effectiveHeaderVelocityMs > headerMaxVelocityMs + 1e-9
    : headerAutoSelection.exceedsMaxCapacity;

  const pipeHeader: PipeHeaderSummary = {
    totalLu: headerTotalLu,
    flowRateLs: headerFlowLs,
    maxVelocityMs: headerMaxVelocityMs,
    nominalMm: isCustomHeaderSize
      ? customHeaderEntry!.nominalSize
      : headerAutoSelection.selected?.nominalSize ?? null,
    outerMm: isCustomHeaderSize
      ? customHeaderEntry!.outerDiameter
      : headerAutoSelection.selected?.outerDiameter ?? null,
    innerMm: isCustomHeaderSize
      ? customHeaderEntry!.innerDiameter
      : headerAutoSelection.selected?.innerDiameter ?? null,
    specId: isCustomHeaderSize ? customHeaderSpec.id : headerAutoSelection.specId,
    isFallbackMaterial: isCustomHeaderSize
      ? customHeaderIsFallback
      : headerAutoSelection.isFallbackMaterial,
    requiredInnerDiaMm: headerRequiredDiMm,
    velocityMs: effectiveHeaderVelocityMs,
    exceedsMaxCapacity: effectiveHeaderExceeds,
    isCustomSize: isCustomHeaderSize,
    autoNominalMm: headerAutoSelection.selected?.nominalSize ?? null,
    autoSpecId: headerAutoSelection.specId,
    autoIsFallbackMaterial: headerAutoSelection.isFallbackMaterial,
    autoVelocityMs: headerAutoSelection.velocityMs,
    connectedDropperCount: dropperSummaries.length,
  };

  if (pipeHeader.exceedsMaxCapacity && headerFlowLs > 0) {
    const reqDi =
      pipeHeader.requiredInnerDiaMm ??
      calculateRequiredInnerDiaMm(headerFlowLs, headerMaxVelocityMs);
    if (pipeHeader.isCustomSize) {
      warnings.push(
        `Pipe Header (Custom ${getPipeSpecBadgeLabel(pipeHeader.specId)} Ø${
          pipeHeader.nominalMm
        } mm): Velocity ${(pipeHeader.velocityMs ?? 0).toFixed(
          2
        )} m/s exceeds Pipe Header limit (V ≤ ${headerMaxVelocityMs.toFixed(
          1
        )} m/s; Global ${parameters.maxVelocityMs.toFixed(
          1
        )} − 0.5 m/s). Requires di ≥ ${reqDi.toFixed(1)} mm for ${headerFlowLs.toFixed(
          2
        )} L/s — select a larger header size or revert to Auto.`
      );
    } else {
      warnings.push(
        buildSizingShortfallWarning(
          `Pipe Header (${Math.round(headerTotalLu)} LU, Header limit V ≤ ${headerMaxVelocityMs.toFixed(
            1
          )} m/s)`,
          headerFlowLs,
          reqDi,
          headerMaxVelocityMs
        )
      );
    }
  }

  const usesFallbackMaterial =
    pipeHeader.isFallbackMaterial ||
    dropperSummaries.some((d) => d.usesFallbackMaterial) ||
    subDropperSummaries.some((sd) => sd.usesFallbackMaterial);

  const boosterDropperPipes = dropperSummaries.filter((d) => d.hasBoosterPump).length;
  const boosterSubDropperPipes = subDropperSummaries.filter((sd) => sd.hasBoosterPump).length;
  const gravityDropperPipes = dropperSummaries.filter((d) => !d.hasBoosterPump).length;
  const totalBuildingHeightM =
    cumulativeHeadsM.length > 0 ? cumulativeHeadsM[cumulativeHeadsM.length - 1] : 0;
  const maxStaticHeadBar =
    staticPressuresBar.length > 0 ? staticPressuresBar[staticPressuresBar.length - 1] : 0;

  return {
    parameters,
    pipeSpec,
    optionalPipeSpec,
    maxSinglePipeCapacityLs,
    maxSinglePipeCapacityLu,
    maxOptionalPipeCapacityLs,
    maxOptionalPipeCapacityLu,
    usesFallbackMaterial,
    rows: calculatedRows,
    dropperSummaries,
    subDropperSummaries,
    prvList,
    pipeHeader,
    totalPhysicalDropperPipes: boosterDropperPipes + gravityDropperPipes,
    totalSubDropperPipes: subDropperSummaries.length,
    boosterDropperPipes,
    boosterSubDropperPipes,
    gravityDropperPipes,
    splitFloorCount,
    totalBuildingLu,
    peakSystemFlowLs,
    overallMaxVelocityMs: overallMaxVel,
    overallMaxWorkingPressureBar: overallMaxWorkP,
    totalBuildingHeightM,
    maxStaticHeadBar,
    warnings,
  };
}

function primaryWorkingExceeds(cells: DropperCellResult[], maxBar: number): boolean {
  return cells.some((c) => c.workingPressureBar !== null && c.workingPressureBar > maxBar + 1e-6);
}

/**
 * Reassign a floor's DCW tapping point from its current riser to a target riser
 * (or a new riser when targetDropperIndex = currentCount + 1), materializing
 * current riser assignments into MANUAL_ZONES so all other floors stay put.
 */
export function reassignFloorTappingPoint(
  floors: FloorInputRow[],
  parameters: DesignParameters,
  currentResult: SystemCalculationResult,
  floorId: string,
  targetDropperIndex: number
): { nextFloors: FloorInputRow[]; nextParametersPatch: Partial<DesignParameters> } {
  const targetFloorIdx = floors.findIndex((f) => f.id === floorId);
  if (targetFloorIdx < 0 || floors[targetFloorIdx].supplyMode === SupplyMode.ROOF_HEADER) {
    return { nextFloors: floors, nextParametersPatch: {} };
  }

  const zoneTypeByDropper = new Map<number, 'Booster' | 'Gravity'>();
  currentResult.dropperSummaries.forEach((d) => {
    zoneTypeByDropper.set(d.dropperIndex, d.zoneType);
  });

  // Check if any floors are served by parallel risers (e.g. AUTO_PARALLEL_SPLIT)
  const parallelAssigned = new Map<number, number>();
  const nonRoofIndicesByGroup = new Map<string, number[]>();
  currentResult.rows.forEach((r, idx) => {
    if (r.input.supplyMode === SupplyMode.ROOF_HEADER) return;
    const served = Object.values(r.dropperCells)
      .filter((c) => c.isServed)
      .map((c) => c.dropperIndex)
      .sort((a, b) => a - b);
    if (served.length > 1) {
      const key = served.join(',');
      const list = nonRoofIndicesByGroup.get(key) ?? [];
      list.push(idx);
      nonRoofIndicesByGroup.set(key, list);
    } else if (served.length === 1) {
      parallelAssigned.set(idx, served[0]);
    }
  });

  nonRoofIndicesByGroup.forEach((rowIndices, key) => {
    const dropperIds = key.split(',').map((s) => Number(s));
    const chunkSize = Math.ceil(rowIndices.length / dropperIds.length);
    rowIndices.forEach((rIdx, pos) => {
      const bucket = Math.min(dropperIds.length - 1, Math.floor(pos / chunkSize));
      parallelAssigned.set(rIdx, dropperIds[bucket]);
    });
  });

  const existingZoneType = zoneTypeByDropper.get(targetDropperIndex);
  const draggedCurrentMode =
    floors[targetFloorIdx].supplyMode === SupplyMode.BOOSTER ? 'Booster' : 'Gravity';
  const targetZoneType = existingZoneType ?? draggedCurrentMode;

  const updated = floors.map((f, idx) => {
    if (f.supplyMode === SupplyMode.ROOF_HEADER) {
      return { ...f };
    }
    const baseDropper =
      parallelAssigned.get(idx) ??
      currentResult.rows[idx]?.primaryDropperIndex ??
      f.manualDropperIndex ??
      1;

    if (f.id === floorId) {
      const nextSupplyMode =
        targetZoneType === 'Booster' ? SupplyMode.BOOSTER : SupplyMode.GRAVITY;
      return {
        ...f,
        supplyMode: nextSupplyMode,
        manualDropperIndex: targetDropperIndex,
        subDropperId: undefined,
        loadSplits: undefined,
      };
    }

    return {
      ...f,
      manualDropperIndex: baseDropper,
    };
  });

  // Normalize dropper indices (1..N) to close gaps if a source riser became empty
  const usedDropperIdSet = new Set<number>();
  updated.forEach((f) => {
    if (f.supplyMode === SupplyMode.ROOF_HEADER) return;
    if (f.loadSplits && f.loadSplits.length > 0) {
      for (const alloc of f.loadSplits) {
        if (alloc.target.kind === 'main' && alloc.loadingUnits > 0) {
          usedDropperIdSet.add(alloc.target.dropperIndex);
        }
      }
    } else {
      usedDropperIdSet.add(f.manualDropperIndex ?? 1);
    }
  });
  const usedDropperIds = Array.from(usedDropperIdSet).sort((a, b) => a - b);

  const oldToNew = new Map<number, number>();
  usedDropperIds.forEach((oldId, i) => oldToNew.set(oldId, i + 1));

  const nextFloors = updated.map((f) => {
    const nextManual =
      f.supplyMode === SupplyMode.ROOF_HEADER
        ? 1
        : oldToNew.get(f.manualDropperIndex ?? 1) ?? 1;

    let nextDropperPrvOverrides = f.dropperPrvOverrides;
    if (f.dropperPrvOverrides) {
      const remapped: Record<number, PrvOverrideMode> = {};
      Object.entries(f.dropperPrvOverrides).forEach(([k, mode]) => {
        const mappedKey = oldToNew.get(Number(k));
        if (mappedKey !== undefined) {
          remapped[mappedKey] = mode;
        }
      });
      nextDropperPrvOverrides = Object.keys(remapped).length > 0 ? remapped : undefined;
    }

    let nextDropperPrvSetPressures = f.dropperPrvSetPressures;
    if (f.dropperPrvSetPressures) {
      const remappedSet: Record<number, number> = {};
      Object.entries(f.dropperPrvSetPressures).forEach(([k, val]) => {
        const mappedKey = oldToNew.get(Number(k));
        if (mappedKey !== undefined) {
          remappedSet[mappedKey] = val;
        }
      });
      nextDropperPrvSetPressures =
        Object.keys(remappedSet).length > 0 ? remappedSet : undefined;
    }

    let nextLoadSplits = f.loadSplits;
    if (f.loadSplits && f.loadSplits.length > 0) {
      nextLoadSplits = f.loadSplits.map((alloc) =>
        alloc.target.kind === 'main'
          ? {
              ...alloc,
              target: {
                kind: 'main' as const,
                dropperIndex: oldToNew.get(alloc.target.dropperIndex) ?? alloc.target.dropperIndex,
              },
            }
          : alloc
      );
    }

    return {
      ...f,
      manualDropperIndex: nextManual,
      dropperPrvOverrides: nextDropperPrvOverrides,
      dropperPrvSetPressures: nextDropperPrvSetPressures,
      loadSplits: nextLoadSplits,
    };
  });

  const remappedSubDroppers = parameters.subDroppers?.map((sd) => ({
    ...sd,
    parentDropperIndex: oldToNew.get(sd.parentDropperIndex) ?? sd.parentDropperIndex,
  }));

  let remappedBoosterOverrides: Record<number, boolean> | undefined;
  if (parameters.dropperBoosterOverrides) {
    const copy: Record<number, boolean> = {};
    Object.entries(parameters.dropperBoosterOverrides).forEach(([k, val]) => {
      const mappedKey = oldToNew.get(Number(k));
      if (mappedKey !== undefined) {
        copy[mappedKey] = val;
      }
    });
    remappedBoosterOverrides = Object.keys(copy).length > 0 ? copy : undefined;
  }

  let remappedBoosterPressures: Record<number, number> | undefined;
  if (parameters.dropperBoosterPressures) {
    const copy: Record<number, number> = {};
    Object.entries(parameters.dropperBoosterPressures).forEach(([k, val]) => {
      const mappedKey = oldToNew.get(Number(k));
      if (mappedKey !== undefined) {
        copy[mappedKey] = val;
      }
    });
    remappedBoosterPressures = Object.keys(copy).length > 0 ? copy : undefined;
  }

  const nextParametersPatch: Partial<DesignParameters> = {
    ...(parameters.zoningStrategy === ZoningStrategy.MANUAL_ZONES &&
    parameters.desiredDropperCount == null
      ? {}
      : {
          zoningStrategy: ZoningStrategy.MANUAL_ZONES,
          desiredDropperCount: null,
        }),
    ...(remappedSubDroppers ? { subDroppers: remappedSubDroppers } : {}),
    ...(parameters.dropperBoosterOverrides !== undefined
      ? { dropperBoosterOverrides: remappedBoosterOverrides }
      : {}),
    ...(parameters.dropperBoosterPressures !== undefined
      ? { dropperBoosterPressures: remappedBoosterPressures }
      : {}),
  };

  return { nextFloors, nextParametersPatch };
}

/**
 * Reassign a floor's tap-off to either a Main Dropper or a Sub-Dropper.
 * When `sourceTarget` is provided on a split floor, moves only that specific split leg
 * (merging into the destination riser if it already serves this floor).
 */
export function reassignFloorTappingTarget(
  floors: FloorInputRow[],
  parameters: DesignParameters,
  currentResult: SystemCalculationResult,
  floorId: string,
  target: RiserTarget,
  sourceTarget?: RiserTarget
): { nextFloors: FloorInputRow[]; nextParametersPatch: Partial<DesignParameters> } {
  const floorIdx = floors.findIndex((f) => f.id === floorId);
  if (floorIdx < 0 || floors[floorIdx].supplyMode === SupplyMode.ROOF_HEADER) {
    return { nextFloors: floors, nextParametersPatch: {} };
  }

  const floor = floors[floorIdx];
  const calcRow = currentResult.rows[floorIdx];

  // If this floor is split across multiple risers and we know which tapping node was dragged,
  // relocate just that split leg (or merge back into a single full tap-off if dropped on an existing leg).
  if (sourceTarget && calcRow && calcRow.isSplitFloor) {
    if (isSameRiserTarget(sourceTarget, target)) {
      return { nextFloors: floors, nextParametersPatch: {} };
    }
    const baseSplits: FloorRiserAllocation[] =
      floor.loadSplits && floor.loadSplits.length >= 2
        ? floor.loadSplits.map((s) => ({ target: { ...s.target }, loadingUnits: s.loadingUnits }))
        : calcRow.riserAllocations.map((a) => ({
            target: { ...a.target },
            loadingUnits: Math.round(a.assignedLu * 10) / 10,
          }));

    const merged = new Map<string, FloorRiserAllocation>();
    for (const alloc of baseSplits) {
      const dest = isSameRiserTarget(alloc.target, sourceTarget) ? target : alloc.target;
      const key = riserTargetKey(dest);
      const existing = merged.get(key);
      if (existing) {
        existing.loadingUnits = Math.round((existing.loadingUnits + alloc.loadingUnits) * 10) / 10;
      } else {
        merged.set(key, {
          target: dest.kind === 'main'
            ? { kind: 'main', dropperIndex: dest.dropperIndex }
            : { kind: 'sub', subDropperId: dest.subDropperId },
          loadingUnits: alloc.loadingUnits,
        });
      }
    }

    const nextList = Array.from(merged.values()).filter((a) => a.loadingUnits > 0);
    if (nextList.length <= 1) {
      const singleTarget = nextList[0]?.target ?? target;
      const clearedFloors = floors.map((f) =>
        f.id === floorId ? { ...f, loadSplits: undefined } : f
      );
      if (singleTarget.kind === 'main') {
        return reassignFloorTappingPoint(
          clearedFloors,
          parameters,
          currentResult,
          floorId,
          singleTarget.dropperIndex
        );
      }
      const sdSummary = currentResult.subDropperSummaries.find(
        (s) => s.id === singleTarget.subDropperId
      );
      return {
        nextFloors: clearedFloors.map((f) =>
          f.id === floorId
            ? {
                ...f,
                subDropperId: singleTarget.subDropperId,
                loadSplits: undefined,
                supplyMode:
                  sdSummary?.zoneType === 'Booster' ? SupplyMode.BOOSTER : SupplyMode.GRAVITY,
              }
            : f
        ),
        nextParametersPatch: {},
      };
    }

    return {
      nextFloors: setFloorLoadSplits(floors, floorId, nextList),
      nextParametersPatch: {},
    };
  }

  if (target.kind === 'main') {
    return reassignFloorTappingPoint(
      floors,
      parameters,
      currentResult,
      floorId,
      target.dropperIndex
    );
  }

  const sdSummary = currentResult.subDropperSummaries.find((s) => s.id === target.subDropperId);
  const sdConfig = (parameters.subDroppers ?? []).find((s) => s.id === target.subDropperId);
  if (!sdConfig) {
    return { nextFloors: floors, nextParametersPatch: {} };
  }

  const nextFloors = floors.map((f) => {
    if (f.id !== floorId || f.supplyMode === SupplyMode.ROOF_HEADER) return f;
    return {
      ...f,
      subDropperId: target.subDropperId,
      loadSplits: undefined,
      supplyMode:
        sdSummary?.zoneType === 'Booster' ? SupplyMode.BOOSTER : SupplyMode.GRAVITY,
    };
  });

  return { nextFloors, nextParametersPatch: {} };
}

export function addSubDropperConfig(
  parameters: DesignParameters,
  floors: FloorInputRow[],
  options: {
    label?: string;
    parentDropperIndex: number;
    branchFloorId: string;
    servedFloorIds?: string[];
    hasBoosterPump?: boolean;
  }
): {
  nextParametersPatch: Partial<DesignParameters>;
  nextFloors: FloorInputRow[];
  created: SubDropperConfig;
} {
  const existing = parameters.subDroppers ?? [];
  let nextNum = existing.length + 1;
  const existingLabels = new Set(existing.map((s) => s.label.toUpperCase()));
  while (existingLabels.has(`SD${nextNum}`)) {
    nextNum += 1;
  }

  const created: SubDropperConfig = {
    id: `sd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: options.label?.trim() || `SD${nextNum}`,
    parentDropperIndex: options.parentDropperIndex,
    branchFloorId: options.branchFloorId,
    ...(options.hasBoosterPump ? { hasBoosterPump: true } : {}),
  };

  const servedSet = new Set(options.servedFloorIds ?? []);
  const nextFloors =
    servedSet.size > 0
      ? floors.map((f) =>
          servedSet.has(f.id) && f.supplyMode !== SupplyMode.ROOF_HEADER
            ? { ...f, subDropperId: created.id }
            : f
        )
      : floors;

  return {
    nextParametersPatch: {
      subDroppers: [...existing, created],
    },
    nextFloors,
    created,
  };
}

export function updateSubDropperConfig(
  parameters: DesignParameters,
  subDropperId: string,
  patch: Partial<Omit<SubDropperConfig, 'id'>>
): Partial<DesignParameters> {
  const existing = parameters.subDroppers ?? [];
  return {
    subDroppers: existing.map((sd) =>
      sd.id === subDropperId ? { ...sd, ...patch } : sd
    ),
  };
}

/**
 * Relocate a sub-dropper's branch takeoff floor along its parent dropper riser.
 * Maintains the sub-dropper's core served floor range while dynamically incorporating
 * any intermediate non-roof floors crossed between the previous branch point and the
 * new branch floor (inclusive of the target takeoff floor).
 */
export function relocateSubDropperBranchPoint(
  floors: FloorInputRow[],
  parameters: DesignParameters,
  currentResult: SystemCalculationResult,
  subDropperId: string,
  targetBranchFloorId: string
): {
  nextParametersPatch: Partial<DesignParameters>;
  nextFloors: FloorInputRow[];
  addedFloorIds: string[];
  addedRowIndices: number[];
} {
  const existing = parameters.subDroppers ?? [];
  const sdConfig = existing.find((sd) => sd.id === subDropperId);
  if (!sdConfig) {
    return { nextParametersPatch: {}, nextFloors: floors, addedFloorIds: [], addedRowIndices: [] };
  }

  const sdSummary = currentResult.subDropperSummaries.find((s) => s.id === subDropperId);
  const oldBranchRowIdx =
    sdSummary?.branchRowIdx ?? floors.findIndex((f) => f.id === sdConfig.branchFloorId);
  const newBranchRowIdx = floors.findIndex((f) => f.id === targetBranchFloorId);

  if (
    oldBranchRowIdx < 0 ||
    newBranchRowIdx < 0 ||
    floors[newBranchRowIdx]?.supplyMode === SupplyMode.ROOF_HEADER ||
    oldBranchRowIdx === newBranchRowIdx
  ) {
    return { nextParametersPatch: {}, nextFloors: floors, addedFloorIds: [], addedRowIndices: [] };
  }

  const minCrossIdx = Math.min(oldBranchRowIdx, newBranchRowIdx);
  const maxCrossIdx = Math.max(oldBranchRowIdx, newBranchRowIdx);
  const parentZoneType =
    sdSummary?.zoneType ??
    currentResult.dropperSummaries.find((d) => d.dropperIndex === sdConfig.parentDropperIndex)
      ?.zoneType ??
    'Gravity';
  const syncedSupplyMode =
    parentZoneType === 'Booster' ? SupplyMode.BOOSTER : SupplyMode.GRAVITY;

  const addedFloorIds: string[] = [];
  const addedRowIndices: number[] = [];

  const nextFloors = floors.map((f, idx) => {
    if (f.supplyMode === SupplyMode.ROOF_HEADER) return f;
    const isCrossed = idx >= minCrossIdx && idx <= maxCrossIdx;
    if (!isCrossed) return f;

    if (f.subDropperId !== subDropperId) {
      addedFloorIds.push(f.id);
      addedRowIndices.push(idx);
    }

    return {
      ...f,
      subDropperId,
      supplyMode: syncedSupplyMode,
    };
  });

  const nextParametersPatch: Partial<DesignParameters> = {
    subDroppers: existing.map((sd) =>
      sd.id === subDropperId ? { ...sd, branchFloorId: targetBranchFloorId } : sd
    ),
  };

  return {
    nextParametersPatch,
    nextFloors,
    addedFloorIds,
    addedRowIndices,
  };
}

export function deleteSubDropperConfig(
  parameters: DesignParameters,
  floors: FloorInputRow[],
  subDropperId: string
): { nextParametersPatch: Partial<DesignParameters>; nextFloors: FloorInputRow[] } {
  const existing = parameters.subDroppers ?? [];
  const nextSubs = existing.filter((sd) => sd.id !== subDropperId);

  const nextFloors = floors.map((f) => {
    const clearSubId = f.subDropperId === subDropperId;
    const hasPrvOverride = Boolean(f.subDropperPrvOverrides?.[subDropperId]);
    const hasSetP = f.subDropperPrvSetPressures?.[subDropperId] !== undefined;
    const hasSplitRef = Boolean(
      f.loadSplits?.some((s) => s.target.kind === 'sub' && s.target.subDropperId === subDropperId)
    );
    if (!clearSubId && !hasPrvOverride && !hasSetP && !hasSplitRef) return f;

    let nextOverrides = f.subDropperPrvOverrides;
    if (hasPrvOverride && nextOverrides) {
      const copy = { ...nextOverrides };
      delete copy[subDropperId];
      nextOverrides = Object.keys(copy).length > 0 ? copy : undefined;
    }

    let nextSetP = f.subDropperPrvSetPressures;
    if (hasSetP && nextSetP) {
      const copy = { ...nextSetP };
      delete copy[subDropperId];
      nextSetP = Object.keys(copy).length > 0 ? copy : undefined;
    }

    let nextLoadSplits = f.loadSplits;
    if (hasSplitRef && f.loadSplits) {
      const remaining = f.loadSplits.filter(
        (s) => !(s.target.kind === 'sub' && s.target.subDropperId === subDropperId)
      );
      nextLoadSplits = remaining.length >= 2 ? remaining : undefined;
    }

    return {
      ...f,
      subDropperId: clearSubId ? undefined : f.subDropperId,
      subDropperPrvOverrides: nextOverrides,
      subDropperPrvSetPressures: nextSetP,
      loadSplits: nextLoadSplits,
    };
  });

  return {
    nextParametersPatch: {
      subDroppers: nextSubs.length > 0 ? nextSubs : undefined,
    },
    nextFloors,
  };
}

/**
 * Independently add or remove a booster pump on any main dropper or sub-dropper riser.
 * Removing a booster pump clears any custom per-dropper pressure override so re-adding
 * cleanly inherits the global BOOSTER (BAR) configuration.
 */
export function toggleRiserBoosterPump(
  parameters: DesignParameters,
  currentResult: SystemCalculationResult,
  target: RiserTarget,
  forceEnabled?: boolean
): Partial<DesignParameters> {
  if (target.kind === 'main') {
    const summary = currentResult.dropperSummaries.find(
      (d) => d.dropperIndex === target.dropperIndex
    );
    const currentlyBoosted =
      summary?.hasBoosterPump ??
      Boolean(parameters.dropperBoosterOverrides?.[target.dropperIndex]);
    const nextBoosted = forceEnabled !== undefined ? forceEnabled : !currentlyBoosted;

    let nextBoosterPressures = parameters.dropperBoosterPressures;
    if (!nextBoosted && nextBoosterPressures && target.dropperIndex in nextBoosterPressures) {
      const copy = { ...nextBoosterPressures };
      delete copy[target.dropperIndex];
      nextBoosterPressures = Object.keys(copy).length > 0 ? copy : undefined;
    }

    return {
      dropperBoosterOverrides: {
        ...(parameters.dropperBoosterOverrides ?? {}),
        [target.dropperIndex]: nextBoosted,
      },
      ...(nextBoosterPressures !== parameters.dropperBoosterPressures
        ? { dropperBoosterPressures: nextBoosterPressures }
        : {}),
    };
  }

  const existingSubs = parameters.subDroppers ?? [];
  const targetSub = existingSubs.find((sd) => sd.id === target.subDropperId);
  if (!targetSub) return {};
  const nextBoosted =
    forceEnabled !== undefined ? forceEnabled : !Boolean(targetSub.hasBoosterPump);

  return {
    subDroppers: existingSubs.map((sd) =>
      sd.id === target.subDropperId
        ? {
            ...sd,
            hasBoosterPump: nextBoosted || undefined,
            boosterBoostBar: nextBoosted ? sd.boosterBoostBar : undefined,
          }
        : sd
    ),
  };
}

/**
 * Set or clear a per-riser booster pump pressure override (in bar).
 * Passing `null` resets the booster pump back to the global `BOOSTER (BAR)` configuration.
 */
export function setRiserBoosterPressure(
  parameters: DesignParameters,
  target: RiserTarget,
  pressureBar: number | null
): Partial<DesignParameters> {
  const sanitized =
    pressureBar === null
      ? null
      : Number.isFinite(pressureBar)
      ? Math.round(Math.min(15, Math.max(0.1, pressureBar)) * 100) / 100
      : null;

  if (target.kind === 'main') {
    const copy = { ...(parameters.dropperBoosterPressures ?? {}) };
    if (sanitized === null) {
      delete copy[target.dropperIndex];
    } else {
      copy[target.dropperIndex] = sanitized;
    }
    return {
      dropperBoosterPressures: Object.keys(copy).length > 0 ? copy : undefined,
    };
  }

  const existingSubs = parameters.subDroppers ?? [];
  if (!existingSubs.some((sd) => sd.id === target.subDropperId)) return {};

  return {
    subDroppers: existingSubs.map((sd) =>
      sd.id === target.subDropperId
        ? {
            ...sd,
            boosterBoostBar: sanitized === null ? undefined : sanitized,
          }
        : sd
    ),
  };
}

function toRiserTarget(target: number | RiserTarget): RiserTarget {
  return typeof target === 'number' ? { kind: 'main', dropperIndex: target } : target;
}

function getTargetCell(
  result: SystemCalculationResult,
  rowIdx: number,
  target: RiserTarget
) {
  const row = result.rows[rowIdx];
  if (!row) return undefined;
  return target.kind === 'main'
    ? row.dropperCells[target.dropperIndex]
    : row.subDropperCells[target.subDropperId];
}

function getDownstreamStep(
  result: SystemCalculationResult,
  rowIdx: number,
  target: RiserTarget
): 1 | -1 {
  if (target.kind === 'main') return 1;
  const summary = result.subDropperSummaries.find((s) => s.id === target.subDropperId);
  if (!summary) return 1;
  // On an up-feed sub-dropper, flow moves upward (decreasing rowIdx) from branchRowIdx
  if (rowIdx <= summary.branchRowIdx && summary.flowOrientation === 'Up-Feed') {
    return -1;
  }
  const cell = result.rows[rowIdx]?.subDropperCells[target.subDropperId];
  if (cell?.flowDirection === 'up') return -1;
  return 1;
}

/**
 * Reposition a PRV station vertically along the same riser or horizontally
 * onto another main dropper or sub-dropper riser.
 */
export function repositionPrvStation(
  floors: FloorInputRow[],
  currentResult: SystemCalculationResult,
  sourceTargetInput: number | RiserTarget,
  sourceFloorId: string,
  targetTargetInput: number | RiserTarget,
  targetFloorId: string
): FloorInputRow[] {
  const sourceTarget = toRiserTarget(sourceTargetInput);
  const targetTarget = toRiserTarget(targetTargetInput);
  const sourceRowIdx = floors.findIndex((f) => f.id === sourceFloorId);
  const targetRowIdx = floors.findIndex((f) => f.id === targetFloorId);
  if (sourceRowIdx < 0 || targetRowIdx < 0) return floors;
  if (floors[targetRowIdx].supplyMode === SupplyMode.ROOF_HEADER) return floors;

  const isSameRiser =
    sourceTarget.kind === targetTarget.kind &&
    (sourceTarget.kind === 'main'
      ? sourceTarget.dropperIndex === (targetTarget as { kind: 'main'; dropperIndex: number }).dropperIndex
      : sourceTarget.subDropperId === (targetTarget as { kind: 'sub'; subDropperId: string }).subDropperId);

  if (sourceRowIdx === targetRowIdx && isSameRiser) {
    return floors;
  }

  const existingCustomSetPressure =
    sourceTarget.kind === 'main'
      ? floors[sourceRowIdx]?.dropperPrvSetPressures?.[sourceTarget.dropperIndex]
      : floors[sourceRowIdx]?.subDropperPrvSetPressures?.[sourceTarget.subDropperId];

  const nextFloors = floors.map((f) => ({
    ...f,
    dropperPrvOverrides: f.dropperPrvOverrides ? { ...f.dropperPrvOverrides } : undefined,
    dropperPrvSetPressures: f.dropperPrvSetPressures
      ? { ...f.dropperPrvSetPressures }
      : undefined,
    subDropperPrvOverrides: f.subDropperPrvOverrides
      ? { ...f.subDropperPrvOverrides }
      : undefined,
    subDropperPrvSetPressures: f.subDropperPrvSetPressures
      ? { ...f.subDropperPrvSetPressures }
      : undefined,
  }));

  const setTargetPrv = (
    rIdx: number,
    target: RiserTarget,
    mode: PrvOverrideMode,
    customSetPressure?: number
  ) => {
    const f = nextFloors[rIdx];
    const cell = getTargetCell(currentResult, rIdx, target);

    if (target.kind === 'main') {
      const dIdx = target.dropperIndex;
      const nextMap = { ...(f.dropperPrvOverrides ?? {}) };
      const nextSetMap = { ...(f.dropperPrvSetPressures ?? {}) };
      if (mode === PrvOverrideMode.AUTO) {
        delete nextMap[dIdx];
        delete nextSetMap[dIdx];
      } else if (mode === PrvOverrideMode.NO_PRV) {
        nextMap[dIdx] = mode;
        delete nextSetMap[dIdx];
      } else {
        nextMap[dIdx] = mode;
        if (customSetPressure !== undefined && Number.isFinite(customSetPressure) && customSetPressure > 0) {
          nextSetMap[dIdx] = customSetPressure;
        }
      }
      f.dropperPrvOverrides = Object.keys(nextMap).length > 0 ? nextMap : undefined;
      f.dropperPrvSetPressures = Object.keys(nextSetMap).length > 0 ? nextSetMap : undefined;
      if (cell?.isServed) f.prvOverride = mode;
    } else {
      const sdId = target.subDropperId;
      const nextMap = { ...(f.subDropperPrvOverrides ?? {}) };
      const nextSetMap = { ...(f.subDropperPrvSetPressures ?? {}) };
      if (mode === PrvOverrideMode.AUTO) {
        delete nextMap[sdId];
        delete nextSetMap[sdId];
      } else if (mode === PrvOverrideMode.NO_PRV) {
        nextMap[sdId] = mode;
        delete nextSetMap[sdId];
      } else {
        nextMap[sdId] = mode;
        if (customSetPressure !== undefined && Number.isFinite(customSetPressure) && customSetPressure > 0) {
          nextSetMap[sdId] = customSetPressure;
        }
      }
      f.subDropperPrvOverrides = Object.keys(nextMap).length > 0 ? nextMap : undefined;
      f.subDropperPrvSetPressures = Object.keys(nextSetMap).length > 0 ? nextSetMap : undefined;
      if (cell?.isServed) f.prvOverride = mode;
    }
  };

  if (isSameRiser) {
    const step = getDownstreamStep(currentResult, sourceRowIdx, sourceTarget);
    const movedDownstream =
      step === 1 ? targetRowIdx > sourceRowIdx : targetRowIdx < sourceRowIdx;

    if (movedDownstream) {
      for (let r = sourceRowIdx; r !== targetRowIdx; r += step) {
        if (getTargetCell(currentResult, r, sourceTarget)) {
          setTargetPrv(r, sourceTarget, PrvOverrideMode.NO_PRV);
        }
      }
      setTargetPrv(targetRowIdx, targetTarget, PrvOverrideMode.FORCE_PRV, existingCustomSetPressure);
    } else {
      setTargetPrv(targetRowIdx, targetTarget, PrvOverrideMode.FORCE_PRV, existingCustomSetPressure);
      for (let r = targetRowIdx + step; r !== sourceRowIdx + step; r += step) {
        if (getTargetCell(currentResult, r, sourceTarget)) {
          setTargetPrv(r, sourceTarget, PrvOverrideMode.AUTO);
        }
      }
    }
  } else {
    setTargetPrv(sourceRowIdx, sourceTarget, PrvOverrideMode.NO_PRV);

    const step = getDownstreamStep(currentResult, sourceRowIdx, sourceTarget);
    for (let r = sourceRowIdx + step; r >= 0 && r < nextFloors.length; r += step) {
      const cell = getTargetCell(currentResult, r, sourceTarget);
      if (!cell) continue;
      if (cell.hasPrv) break;

      const f = nextFloors[r];
      const existingOverride =
        sourceTarget.kind === 'main'
          ? f.dropperPrvOverrides?.[sourceTarget.dropperIndex] ??
            (cell.isServed ? f.prvOverride : PrvOverrideMode.NO_PRV)
          : f.subDropperPrvOverrides?.[sourceTarget.subDropperId] ??
            (cell.isServed ? f.prvOverride : PrvOverrideMode.NO_PRV);

      if (existingOverride === PrvOverrideMode.FORCE_PRV) break;
      if (cell.isServed && existingOverride === PrvOverrideMode.AUTO) {
        setTargetPrv(r, sourceTarget, PrvOverrideMode.NO_PRV);
      }
    }

    setTargetPrv(targetRowIdx, targetTarget, PrvOverrideMode.FORCE_PRV, existingCustomSetPressure);
  }

  return nextFloors;
}

/**
 * Insert a PRV station at a specific floor along a main dropper or sub-dropper.
 */
export function addPrvStation(
  floors: FloorInputRow[],
  currentResult: SystemCalculationResult,
  targetInput: number | RiserTarget,
  floorId: string
): FloorInputRow[] {
  const target = toRiserTarget(targetInput);
  const rowIdx = floors.findIndex((f) => f.id === floorId);
  if (rowIdx < 0) return floors;
  if (floors[rowIdx].supplyMode === SupplyMode.ROOF_HEADER) return floors;

  const cell = getTargetCell(currentResult, rowIdx, target);
  if (!cell || cell.hasPrv) return floors;

  return floors.map((f, idx) => {
    if (idx !== rowIdx) return f;
    if (target.kind === 'main') {
      const nextMap = {
        ...(f.dropperPrvOverrides ?? {}),
        [target.dropperIndex]: PrvOverrideMode.FORCE_PRV,
      };
      return {
        ...f,
        prvOverride: cell.isServed ? PrvOverrideMode.FORCE_PRV : f.prvOverride,
        dropperPrvOverrides: nextMap,
      };
    }
    const nextSubMap = {
      ...(f.subDropperPrvOverrides ?? {}),
      [target.subDropperId]: PrvOverrideMode.FORCE_PRV,
    };
    return {
      ...f,
      prvOverride: cell.isServed ? PrvOverrideMode.FORCE_PRV : f.prvOverride,
      subDropperPrvOverrides: nextSubMap,
    };
  });
}

/**
 * Remove an existing PRV station at a specific floor along a main dropper or sub-dropper,
 * suppressing downstream AUTO PRV re-triggering along the physical flow direction.
 */
export function removePrvStation(
  floors: FloorInputRow[],
  currentResult: SystemCalculationResult,
  targetInput: number | RiserTarget,
  floorId: string
): FloorInputRow[] {
  const target = toRiserTarget(targetInput);
  const rowIdx = floors.findIndex((f) => f.id === floorId);
  if (rowIdx < 0) return floors;
  const sourceCell = getTargetCell(currentResult, rowIdx, target);
  if (!sourceCell || !sourceCell.hasPrv) return floors;

  const nextFloors = floors.map((f) => ({
    ...f,
    dropperPrvOverrides: f.dropperPrvOverrides ? { ...f.dropperPrvOverrides } : undefined,
    dropperPrvSetPressures: f.dropperPrvSetPressures
      ? { ...f.dropperPrvSetPressures }
      : undefined,
    subDropperPrvOverrides: f.subDropperPrvOverrides
      ? { ...f.subDropperPrvOverrides }
      : undefined,
    subDropperPrvSetPressures: f.subDropperPrvSetPressures
      ? { ...f.subDropperPrvSetPressures }
      : undefined,
  }));

  const setTargetPrv = (rIdx: number, mode: PrvOverrideMode) => {
    const f = nextFloors[rIdx];
    const cell = getTargetCell(currentResult, rIdx, target);
    if (target.kind === 'main') {
      const dIdx = target.dropperIndex;
      const nextMap = { ...(f.dropperPrvOverrides ?? {}) };
      const nextSetMap = { ...(f.dropperPrvSetPressures ?? {}) };
      if (mode === PrvOverrideMode.AUTO) {
        delete nextMap[dIdx];
        delete nextSetMap[dIdx];
      } else if (mode === PrvOverrideMode.NO_PRV) {
        nextMap[dIdx] = mode;
        delete nextSetMap[dIdx];
      } else {
        nextMap[dIdx] = mode;
      }
      f.dropperPrvOverrides = Object.keys(nextMap).length > 0 ? nextMap : undefined;
      f.dropperPrvSetPressures = Object.keys(nextSetMap).length > 0 ? nextSetMap : undefined;
      if (cell?.isServed) f.prvOverride = mode;
    } else {
      const sdId = target.subDropperId;
      const nextMap = { ...(f.subDropperPrvOverrides ?? {}) };
      const nextSetMap = { ...(f.subDropperPrvSetPressures ?? {}) };
      if (mode === PrvOverrideMode.AUTO) {
        delete nextMap[sdId];
        delete nextSetMap[sdId];
      } else if (mode === PrvOverrideMode.NO_PRV) {
        nextMap[sdId] = mode;
        delete nextSetMap[sdId];
      } else {
        nextMap[sdId] = mode;
      }
      f.subDropperPrvOverrides = Object.keys(nextMap).length > 0 ? nextMap : undefined;
      f.subDropperPrvSetPressures = Object.keys(nextSetMap).length > 0 ? nextSetMap : undefined;
      if (cell?.isServed) f.prvOverride = mode;
    }
  };

  setTargetPrv(rowIdx, PrvOverrideMode.NO_PRV);

  const step = getDownstreamStep(currentResult, rowIdx, target);
  for (let r = rowIdx + step; r >= 0 && r < nextFloors.length; r += step) {
    const cell = getTargetCell(currentResult, r, target);
    if (!cell) continue;
    if (cell.hasPrv) break;

    const f = nextFloors[r];
    const existingOverride =
      target.kind === 'main'
        ? f.dropperPrvOverrides?.[target.dropperIndex] ??
          (cell.isServed ? f.prvOverride : PrvOverrideMode.NO_PRV)
        : f.subDropperPrvOverrides?.[target.subDropperId] ??
          (cell.isServed ? f.prvOverride : PrvOverrideMode.NO_PRV);

    if (existingOverride === PrvOverrideMode.FORCE_PRV) break;
    if (cell.isServed && existingOverride === PrvOverrideMode.AUTO) {
      setTargetPrv(r, PrvOverrideMode.NO_PRV);
    }
  }

  return nextFloors;
}

/**
 * Set or clear a custom downstream set pressure (P2, bar) override for a specific PRV station
 * on either a main dropper or a sub-dropper.
 */
export function setPrvStationSetPressure(
  floors: FloorInputRow[],
  currentResult: SystemCalculationResult,
  targetInput: number | RiserTarget,
  floorId: string,
  downstreamPressureBar: number | null
): FloorInputRow[] {
  const target = toRiserTarget(targetInput);
  const rowIdx = floors.findIndex((f) => f.id === floorId);
  if (rowIdx < 0) return floors;
  const cell = getTargetCell(currentResult, rowIdx, target);
  if (!cell || !cell.hasPrv) return floors;

  return floors.map((f, idx) => {
    if (idx !== rowIdx) return f;
    if (target.kind === 'main') {
      const nextMap = { ...(f.dropperPrvSetPressures ?? {}) };
      if (
        downstreamPressureBar === null ||
        !Number.isFinite(downstreamPressureBar) ||
        downstreamPressureBar <= 0
      ) {
        delete nextMap[target.dropperIndex];
      } else {
        const rounded = Math.round(downstreamPressureBar * 100) / 100;
        nextMap[target.dropperIndex] = Math.max(0.1, Math.min(20.0, rounded));
      }
      return {
        ...f,
        dropperPrvSetPressures: Object.keys(nextMap).length > 0 ? nextMap : undefined,
      };
    }

    const nextSubMap = { ...(f.subDropperPrvSetPressures ?? {}) };
    if (
      downstreamPressureBar === null ||
      !Number.isFinite(downstreamPressureBar) ||
      downstreamPressureBar <= 0
    ) {
      delete nextSubMap[target.subDropperId];
    } else {
      const rounded = Math.round(downstreamPressureBar * 100) / 100;
      nextSubMap[target.subDropperId] = Math.max(0.1, Math.min(20.0, rounded));
    }
    return {
      ...f,
      subDropperPrvSetPressures: Object.keys(nextSubMap).length > 0 ? nextSubMap : undefined,
    };
  });
}

/**
 * Reset all manual PRV overrides (placement modes and custom P2 set pressures) back to AUTO.
 */
export function resetAllPrvOverrides(floors: FloorInputRow[]): FloorInputRow[] {
  return floors.map((f) => ({
    ...f,
    prvOverride: PrvOverrideMode.AUTO,
    dropperPrvOverrides: undefined,
    dropperPrvSetPressures: undefined,
    subDropperPrvOverrides: undefined,
    subDropperPrvSetPressures: undefined,
  }));
}

/**
 * Divide a total LU value evenly into `count` parts rounded to 1 decimal place while preserving exact sum.
 */
export function splitLuEvenly(totalLu: number, count: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(0, Math.round(totalLu * 10) / 10);
  if (count === 1) return [safeTotal];
  const base = Math.floor((safeTotal / count) * 10) / 10;
  const result = new Array<number>(count).fill(base);
  const assignedSoFar = Math.round(base * count * 10) / 10;
  const remainder = Math.round((safeTotal - assignedSoFar) * 10) / 10;
  // Distribute 0.1 increments cleanly from the first branch
  const steps = Math.round(remainder * 10);
  for (let i = 0; i < Math.abs(steps); i++) {
    result[i % count] = Math.round((result[i % count] + (steps > 0 ? 0.1 : -0.1)) * 10) / 10;
  }
  return result;
}

/**
 * Update or clear a floor's explicit multi-riser load split, keeping `loadingUnits` synchronized with the sum.
 */
export function setFloorLoadSplits(
  floors: FloorInputRow[],
  floorId: string,
  splits: FloorRiserAllocation[] | undefined
): FloorInputRow[] {
  return floors.map((f) => {
    if (f.id !== floorId || f.supplyMode === SupplyMode.ROOF_HEADER) return f;
    if (!splits || splits.length === 0) {
      return {
        ...f,
        loadSplits: undefined,
      };
    }

    if (splits.length === 1) {
      const only = splits[0];
      return {
        ...f,
        loadSplits: undefined,
        ...(only.target.kind === 'main'
          ? { manualDropperIndex: only.target.dropperIndex, subDropperId: undefined }
          : { subDropperId: only.target.subDropperId }),
      };
    }

    const sanitized = splits.map((s) => ({
      target:
        s.target.kind === 'main'
          ? { kind: 'main' as const, dropperIndex: Math.max(1, Math.round(s.target.dropperIndex)) }
          : { kind: 'sub' as const, subDropperId: s.target.subDropperId },
      loadingUnits: Math.max(0, Math.round((Number(s.loadingUnits) || 0) * 10) / 10),
    }));

    const sumLu =
      Math.round(sanitized.reduce((acc, s) => acc + s.loadingUnits, 0) * 10) / 10;

    return {
      ...f,
      loadingUnits: sumLu,
      loadSplits: sanitized,
    };
  });
}

/**
 * Proportionally scale a floor's explicit loadSplits when its total loadingUnits input is edited directly.
 */
export function scaleFloorLoadSplitsForTotal(
  floor: FloorInputRow,
  newTotalLu: number
): FloorRiserAllocation[] | undefined {
  if (!floor.loadSplits || floor.loadSplits.length < 2) return floor.loadSplits;
  const safeTotal = Math.max(0, Math.round(newTotalLu * 10) / 10);
  const currentSum = floor.loadSplits.reduce(
    (acc, s) => acc + Math.max(0, Number(s.loadingUnits) || 0),
    0
  );

  if (currentSum <= 0) {
    const even = splitLuEvenly(safeTotal, floor.loadSplits.length);
    return floor.loadSplits.map((s, i) => ({
      ...s,
      loadingUnits: even[i] ?? 0,
    }));
  }

  let running = 0;
  return floor.loadSplits.map((s, i) => {
    if (i === floor.loadSplits!.length - 1) {
      const rem = Math.max(0, Math.round((safeTotal - running) * 10) / 10);
      return { ...s, loadingUnits: rem };
    }
    const share = Math.max(0, Math.round(((s.loadingUnits / currentSum) * safeTotal) * 10) / 10);
    running = Math.round((running + share) * 10) / 10;
    return { ...s, loadingUnits: share };
  });
}

/**
 * Build a smart default 2-riser 50/50 split for a floor based on its active riser and available droppers.
 */
export function buildDefaultSplitForFloor(
  floor: FloorInputRow,
  calcRow: CalculatedFloorRow | undefined,
  dropperSummaries: DropperZoneSummary[],
  subDropperSummaries: SubDropperSummary[]
): FloorRiserAllocation[] {
  const totalLu = Math.max(0, floor.loadingUnits);
  const [halfA, halfB] = splitLuEvenly(totalLu, 2);
  const zoneType = floor.supplyMode === SupplyMode.BOOSTER ? 'Booster' : 'Gravity';

  // If already split by parallel strategy, materialize those exact risers first
  if (calcRow && calcRow.riserAllocations.length >= 2) {
    return calcRow.riserAllocations.map((a) => ({
      target:
        a.target.kind === 'main'
          ? { kind: 'main' as const, dropperIndex: a.target.dropperIndex }
          : { kind: 'sub' as const, subDropperId: a.target.subDropperId },
      loadingUnits: Math.round(a.assignedLu * 10) / 10,
    }));
  }

  // Primary active target
  let primaryTarget: RiserTarget;
  if (calcRow && calcRow.riserAllocations.length === 1) {
    primaryTarget = calcRow.riserAllocations[0].target;
  } else if (floor.subDropperId && subDropperSummaries.some((s) => s.id === floor.subDropperId)) {
    primaryTarget = { kind: 'sub', subDropperId: floor.subDropperId };
  } else {
    primaryTarget = {
      kind: 'main',
      dropperIndex:
        calcRow?.primaryDropperIndex ??
        floor.manualDropperIndex ??
        (zoneType === 'Booster' ? 1 : Math.min(2, Math.max(1, dropperSummaries.length))),
    };
  }

  // Pick best partner riser: another same-zone main dropper first, else next new dropper index
  let secondaryTarget: RiserTarget | null = null;
  if (primaryTarget.kind === 'main') {
    const sameZoneOthers = dropperSummaries.filter(
      (d) => d.zoneType === zoneType && d.dropperIndex !== primaryTarget.dropperIndex
    );
    const higherSameZone = sameZoneOthers.find((d) => d.dropperIndex > primaryTarget.dropperIndex);
    const chosen = higherSameZone ?? sameZoneOthers[0];
    if (chosen) {
      secondaryTarget = { kind: 'main', dropperIndex: chosen.dropperIndex };
    } else {
      const maxExisting = dropperSummaries.reduce((m, d) => Math.max(m, d.dropperIndex), 0);
      secondaryTarget = { kind: 'main', dropperIndex: Math.max(maxExisting, primaryTarget.dropperIndex) + 1 };
    }
  } else {
    const sd = subDropperSummaries.find((s) => s.id === primaryTarget.subDropperId);
    const parentIdx = sd?.parentDropperIndex ?? dropperSummaries[0]?.dropperIndex ?? 1;
    secondaryTarget = { kind: 'main', dropperIndex: parentIdx };
  }

  return [
    { target: primaryTarget, loadingUnits: halfA },
    { target: secondaryTarget, loadingUnits: halfB },
  ];
}

/**
 * Add a riser target to a floor's split (re-balancing evenly across all risers serving that floor).
 * Used for quick schematic right-click load splitting.
 */
export function splitFloorWithRiserTarget(
  floors: FloorInputRow[],
  currentResult: SystemCalculationResult,
  floorId: string,
  additionalTarget: RiserTarget
): FloorInputRow[] {
  const floorIdx = floors.findIndex((f) => f.id === floorId);
  if (floorIdx < 0 || floors[floorIdx].supplyMode === SupplyMode.ROOF_HEADER) return floors;
  const floor = floors[floorIdx];
  const calcRow = currentResult.rows[floorIdx];

  const existingTargets: RiserTarget[] = [];
  if (floor.loadSplits && floor.loadSplits.length >= 2) {
    for (const s of floor.loadSplits) {
      existingTargets.push(s.target);
    }
  } else if (calcRow && calcRow.riserAllocations.length > 0) {
    for (const a of calcRow.riserAllocations) {
      existingTargets.push(a.target);
    }
  } else {
    existingTargets.push({ kind: 'main', dropperIndex: floor.manualDropperIndex ?? 1 });
  }

  if (existingTargets.some((t) => isSameRiserTarget(t, additionalTarget))) {
    return floors;
  }

  const nextTargets = [...existingTargets, additionalTarget];
  const shares = splitLuEvenly(floor.loadingUnits, nextTargets.length);
  const nextSplits: FloorRiserAllocation[] = nextTargets.map((target, idx) => ({
    target,
    loadingUnits: shares[idx] ?? 0,
  }));

  return setFloorLoadSplits(floors, floorId, nextSplits);
}

/**
 * Copy a floor's split ratio (target list + percentage weights) across a range of floors.
 */
export function applySplitRatioToFloorRange(
  floors: FloorInputRow[],
  sourceFloorId: string,
  fromFloorId: string,
  toFloorId: string
): FloorInputRow[] {
  const sourceFloor = floors.find((f) => f.id === sourceFloorId);
  if (!sourceFloor?.loadSplits || sourceFloor.loadSplits.length < 2) return floors;

  const idxA = floors.findIndex((f) => f.id === fromFloorId);
  const idxB = floors.findIndex((f) => f.id === toFloorId);
  if (idxA < 0 || idxB < 0) return floors;

  const minI = Math.min(idxA, idxB);
  const maxI = Math.max(idxA, idxB);
  const sourceTotal = sourceFloor.loadSplits.reduce(
    (sum, s) => sum + Math.max(0, s.loadingUnits),
    0
  );
  const weights =
    sourceTotal > 0
      ? sourceFloor.loadSplits.map((s) => Math.max(0, s.loadingUnits) / sourceTotal)
      : sourceFloor.loadSplits.map(() => 1 / sourceFloor.loadSplits!.length);

  return floors.map((f, idx) => {
    if (f.supplyMode === SupplyMode.ROOF_HEADER) return f;
    if (idx < minI || idx > maxI) return f;
    const total = Math.max(0, Math.round(f.loadingUnits * 10) / 10);
    let running = 0;
    const nextSplits: FloorRiserAllocation[] = sourceFloor.loadSplits!.map((s, i) => {
      const target: RiserTarget =
        s.target.kind === 'main'
          ? { kind: 'main', dropperIndex: s.target.dropperIndex }
          : { kind: 'sub', subDropperId: s.target.subDropperId };
      if (i === sourceFloor.loadSplits!.length - 1) {
        const rem = Math.max(0, Math.round((total - running) * 10) / 10);
        return { target, loadingUnits: rem };
      }
      const val = Math.max(0, Math.round(total * weights[i] * 10) / 10);
      running = Math.round((running + val) * 10) / 10;
      return { target, loadingUnits: val };
    });

    return {
      ...f,
      loadSplits: nextSplits,
    };
  });
}

/**
 * Apply calculated total loading units and appliance counts across an inclusive range of floors.
 * Proportionally scales existing multi-riser loadSplits on any split floors in the range.
 */
export function applyApplianceLuToFloorRange(
  floors: FloorInputRow[],
  fromFloorId: string,
  toFloorId: string,
  totalLu: number,
  applianceCounts?: ApplianceCounts
): FloorInputRow[] {
  const idxA = floors.findIndex((f) => f.id === fromFloorId);
  const idxB = floors.findIndex((f) => f.id === toFloorId);
  if (idxA < 0 || idxB < 0) return floors;

  const minI = Math.min(idxA, idxB);
  const maxI = Math.max(idxA, idxB);
  const safeLu = Math.max(0, Math.round(totalLu * 100) / 100);

  return floors.map((f, idx) => {
    if (f.supplyMode === SupplyMode.ROOF_HEADER) return f;
    if (idx < minI || idx > maxI) return f;

    const hasSplits = Boolean(f.loadSplits && f.loadSplits.length >= 2);
    return {
      ...f,
      loadingUnits: safeLu,
      applianceCounts: applianceCounts ? { ...applianceCounts } : undefined,
      ...(hasSplits ? { loadSplits: scaleFloorLoadSplitsForTotal(f, safeLu) } : {}),
    };
  });
}

export function formatExcludedPipeSizesSummary(
  parameters: DesignParameters
): string | null {
  const excludedMap = parameters.excludedPipeSizes;
  if (!excludedMap) return null;

  const activeSpecOrder: PipeSpecId[] = [parameters.pipeSpecId];
  if (
    parameters.optionalPipeSpecId &&
    !activeSpecOrder.includes(parameters.optionalPipeSpecId)
  ) {
    activeSpecOrder.push(parameters.optionalPipeSpecId);
  }
  (Object.keys(excludedMap) as PipeSpecId[]).forEach((specId) => {
    if (!activeSpecOrder.includes(specId)) {
      activeSpecOrder.push(specId);
    }
  });

  const parts: string[] = [];
  for (const specId of activeSpecOrder) {
    const sizes = excludedMap[specId];
    if (!sizes || sizes.length === 0) continue;
    const sorted = [...sizes].sort((a, b) => a - b);
    const label = getPipeSpecBadgeLabel(specId);
    parts.push(`${label}: ${sorted.map((s) => `Ø${s} mm`).join(', ')}`);
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}


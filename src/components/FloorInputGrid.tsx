import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Copy, GitBranch, Plus, Trash2, X } from 'lucide-react';
import { calculateTotalLuFromAppliances } from '../data/appliances';
import { getPipeSpecBadgeLabel } from '../data/pipeSpecs';
import {
  ApplianceCounts,
  DesignParameters,
  DropperZoneSummary,
  FloorInputRow,
  FloorRiserAllocation,
  PrvOverrideMode,
  RiserTarget,
  SubDropperSummary,
  SupplyMode,
  SystemCalculationResult,
  ZoningStrategy,
} from '../types/hydraulics';
import {
  addSubDropperConfig,
  applyApplianceLuToFloorRange,
  applySplitRatioToFloorRange,
  buildDefaultSplitForFloor,
  deleteSubDropperConfig,
  formatFlowFormulaDisplay,
  getEffectiveStandard,
  isSameRiserTarget,
  riserTargetKey,
  scaleFloorLoadSplitsForTotal,
  setFloorLoadSplits,
  splitLuEvenly,
  updateSubDropperConfig,
} from '../utils/calculations';
import { ApplianceCalculatorModal } from './ApplianceCalculatorModal';

interface FloorInputGridProps {
  floors: FloorInputRow[];
  zoningStrategy: ZoningStrategy;
  parameters?: DesignParameters;
  calcResult?: SystemCalculationResult;
  dropperSummaries?: DropperZoneSummary[];
  subDropperSummaries?: SubDropperSummary[];
  onChangeFloors: (nextFloors: FloorInputRow[]) => void;
  onUpdateParameters?: (patch: Partial<DesignParameters>) => void;
}

const TapDotGlyph: React.FC<{ split: boolean; className?: string }> = ({ split, className = '' }) => (
  <svg
    viewBox="0 0 12 12"
    className={`w-3 h-3 shrink-0 ${className}`}
    aria-hidden="true"
  >
    {split ? (
      <>
        <circle cx="6" cy="6" r="4.5" fill="#ffffff" stroke="currentColor" strokeWidth="1.4" />
        <path d="M 6 1.5 A 4.5 4.5 0 0 0 6 10.5 Z" fill="currentColor" />
      </>
    ) : (
      <circle cx="6" cy="6" r="4.5" fill="currentColor" />
    )}
  </svg>
);

interface TwoDecimalNumberInputProps {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  ariaLabel?: string;
  onCommit: (nextValue: number) => void;
  className: string;
}

const TwoDecimalNumberInput: React.FC<TwoDecimalNumberInputProps> = ({
  id,
  value,
  min = 0.01,
  max,
  ariaLabel,
  onCommit,
  className,
}) => {
  const formatVal = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : min.toFixed(2));
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatVal(value));

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatVal(value));
    }
  }, [value, isFocused]);

  return (
    <input
      id={id}
      type="number"
      step="0.01"
      min={min.toFixed(2)}
      max={max !== undefined ? max.toFixed(2) : undefined}
      value={draft}
      aria-label={ariaLabel}
      onFocus={() => {
        setIsFocused(true);
        setDraft(formatVal(value));
      }}
      onBlur={() => {
        setIsFocused(false);
        const parsed = parseFloat(draft);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setDraft(formatVal(value));
          return;
        }
        const next = max !== undefined && parsed > max ? max : parsed;
        onCommit(next);
        setDraft(next.toFixed(2));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        const inputType = (e.nativeEvent as InputEvent | undefined)?.inputType;
        const isTyping =
          inputType === 'insertText' ||
          inputType === 'deleteContentBackward' ||
          inputType === 'deleteContentForward' ||
          inputType === 'deleteByCut' ||
          inputType === 'insertFromPaste';

        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
          const next = max !== undefined && parsed > max ? max : parsed;
          onCommit(next);
          setDraft(isTyping ? raw : next.toFixed(2));
        } else {
          setDraft(raw);
        }
      }}
      className={className}
    />
  );
};

export const FloorInputGrid: React.FC<FloorInputGridProps> = ({
  floors,
  zoningStrategy,
  parameters,
  calcResult,
  dropperSummaries = [],
  subDropperSummaries = [],
  onChangeFloors,
  onUpdateParameters,
}) => {
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [expandedSplitFloorId, setExpandedSplitFloorId] = useState<string | null>(null);
  const [copyRangeFloorId, setCopyRangeFloorId] = useState<string | null>(null);
  const [copyRangeDraft, setCopyRangeDraft] = useState<{ fromId: string; toId: string }>({
    fromId: '',
    toId: '',
  });
  const [rangeDraftBySd, setRangeDraftBySd] = useState<
    Record<string, { fromId: string; toId: string }>
  >({});

  const [genStoreys, setGenStoreys] = useState<number>(30);
  const [genRoofHead, setGenRoofHead] = useState<number>(1.5);
  const [genTypHeight, setGenTypHeight] = useState<number>(3.2);
  const [genBoosterCount, setGenBoosterCount] = useState<number>(4);
  const [genFloorLu, setGenFloorLu] = useState<number>(220);
  const [genApplianceCounts, setGenApplianceCounts] = useState<ApplianceCounts | undefined>(
    undefined
  );
  const [applianceCalcTarget, setApplianceCalcTarget] = useState<
    | { kind: 'generator' }
    | { kind: 'floor'; floorId: string; floorLabel: string }
    | null
  >(null);

  const effectiveStandard = getEffectiveStandard(parameters?.standard);

  useEffect(() => {
    if (genApplianceCounts && Object.keys(genApplianceCounts).length > 0) {
      setGenFloorLu(calculateTotalLuFromAppliances(genApplianceCounts, effectiveStandard));
    }
  }, [effectiveStandard, genApplianceCounts]);

  const subDroppers = parameters?.subDroppers ?? [];
  const nonRoofFloors = useMemo(
    () => floors.filter((f) => f.supplyMode !== SupplyMode.ROOF_HEADER),
    [floors]
  );
  const availableFloorOptions = useMemo(
    () => nonRoofFloors.map((f) => ({ id: f.id, floorLabel: f.floorLabel })),
    [nonRoofFloors]
  );

  const handleUpdateRow = (index: number, patch: Partial<FloorInputRow>) => {
    const next = floors.map((f, idx) => {
      if (idx !== index) return f;
      const updated = { ...f, ...patch };
      if (patch.prvOverride !== undefined) {
        if (updated.subDropperId) {
          const copySub = { ...(f.subDropperPrvOverrides ?? {}) };
          if (patch.prvOverride === PrvOverrideMode.AUTO) {
            delete copySub[updated.subDropperId];
          } else {
            copySub[updated.subDropperId] = patch.prvOverride;
          }
          updated.subDropperPrvOverrides =
            Object.keys(copySub).length > 0 ? copySub : undefined;

          if (patch.prvOverride === PrvOverrideMode.NO_PRV && f.subDropperPrvSetPressures) {
            const copySet = { ...f.subDropperPrvSetPressures };
            delete copySet[updated.subDropperId];
            updated.subDropperPrvSetPressures =
              Object.keys(copySet).length > 0 ? copySet : undefined;
          }
        }
        if (f.dropperPrvOverrides) {
          const dIdx = f.manualDropperIndex;
          const copy = { ...f.dropperPrvOverrides };
          if (dIdx !== undefined) {
            delete copy[dIdx];
          }
          updated.dropperPrvOverrides = Object.keys(copy).length > 0 ? copy : undefined;
        }
      }
      if (patch.prvOverride === PrvOverrideMode.NO_PRV && f.dropperPrvSetPressures) {
        const dIdx = f.manualDropperIndex;
        if (dIdx !== undefined) {
          const copySet = { ...f.dropperPrvSetPressures };
          delete copySet[dIdx];
          updated.dropperPrvSetPressures =
            Object.keys(copySet).length > 0 ? copySet : undefined;
        } else {
          updated.dropperPrvSetPressures = undefined;
        }
      }
      return updated;
    });
    onChangeFloors(next);
  };

  const handleAddRowTop = () => {
    if (floors.length === 0) {
      const roofRow: FloorInputRow = {
        id: `flr-roof-${Date.now()}`,
        floorLabel: 'Roof',
        floorHeightM: 1.0,
        supplyMode: SupplyMode.ROOF_HEADER,
        loadingUnits: 0,
        prvOverride: PrvOverrideMode.AUTO,
        manualDropperIndex: 1,
      };
      onChangeFloors([roofRow]);
      return;
    }

    const newRow: FloorInputRow = {
      id: `flr-${Date.now()}`,
      floorLabel: `L${floors.length}`,
      floorHeightM: 3.2,
      supplyMode: SupplyMode.BOOSTER,
      loadingUnits: 200,
      prvOverride: PrvOverrideMode.AUTO,
      manualDropperIndex: 1,
    };
    const insertIdx = floors[0]?.supplyMode === SupplyMode.ROOF_HEADER ? 1 : 0;
    const next = [...floors.slice(0, insertIdx), newRow, ...floors.slice(insertIdx)];
    onChangeFloors(next);
  };

  const handleAddRowBottom = () => {
    const newRow: FloorInputRow = {
      id: `flr-${Date.now()}`,
      floorLabel: floors.length === 0 ? 'L1' : 'B1',
      floorHeightM: floors.length === 0 ? 3.2 : 3.6,
      supplyMode: SupplyMode.GRAVITY,
      loadingUnits: 160,
      prvOverride: PrvOverrideMode.AUTO,
      manualDropperIndex: 2,
    };
    onChangeFloors([...floors, newRow]);
  };

  const handleDeleteRow = (index: number) => {
    const removedId = floors[index]?.id;
    const nextFloors = floors.filter((_, idx) => idx !== index);
    onChangeFloors(nextFloors);

    if (removedId && parameters && onUpdateParameters && subDroppers.length > 0) {
      const fallbackFloor = nextFloors.find((f) => f.supplyMode !== SupplyMode.ROOF_HEADER);
      if (subDroppers.some((sd) => sd.branchFloorId === removedId)) {
        if (fallbackFloor) {
          onUpdateParameters({
            subDroppers: subDroppers.map((sd) =>
              sd.branchFloorId === removedId
                ? { ...sd, branchFloorId: fallbackFloor.id }
                : sd
            ),
          });
        } else {
          onUpdateParameters({ subDroppers: undefined });
        }
      }
    }
  };

  const handleGenerateBuilding = () => {
    const count = Math.max(2, Math.min(120, Math.round(genStoreys)));
    const boostTop = Math.max(0, Math.min(count, Math.round(genBoosterCount)));
    const next: FloorInputRow[] = [
      {
        id: `gen-roof-${Date.now()}`,
        floorLabel: 'Roof',
        floorHeightM: Math.max(0.5, genRoofHead),
        supplyMode: SupplyMode.ROOF_HEADER,
        loadingUnits: 0,
        prvOverride: PrvOverrideMode.AUTO,
        manualDropperIndex: 1,
      },
    ];

    for (let lvl = count; lvl >= 1; lvl--) {
      const isBooster = lvl > count - boostTop;
      next.push({
        id: `gen-${Date.now()}-${lvl}`,
        floorLabel: `L${lvl}`,
        floorHeightM: Math.max(2.0, genTypHeight),
        supplyMode: isBooster ? SupplyMode.BOOSTER : SupplyMode.GRAVITY,
        loadingUnits: Math.max(0, genFloorLu),
        prvOverride: PrvOverrideMode.AUTO,
        manualDropperIndex: isBooster ? 1 : 2,
        ...(genApplianceCounts ? { applianceCounts: { ...genApplianceCounts } } : {}),
      });
    }
    if (parameters && onUpdateParameters) {
      if (
        subDroppers.length > 0 ||
        parameters.dropperBoosterOverrides ||
        parameters.dropperBoosterPressures
      ) {
        onUpdateParameters({
          subDroppers: undefined,
          dropperBoosterOverrides: undefined,
          dropperBoosterPressures: undefined,
        });
      }
    }
    setGenMessage(`Generated ${count}-storey building schedule (+ Roof Tank Header).`);
    onChangeFloors(next);
  };

  const handleAddSubDropper = () => {
    if (!parameters || !onUpdateParameters || nonRoofFloors.length === 0) return;
    const defaultParent =
      dropperSummaries.length > 0
        ? dropperSummaries[dropperSummaries.length - 1].dropperIndex
        : 1;
    const defaultBranchFloor = nonRoofFloors[nonRoofFloors.length - 1];
    const { nextParametersPatch, nextFloors } = addSubDropperConfig(parameters, floors, {
      parentDropperIndex: defaultParent,
      branchFloorId: defaultBranchFloor.id,
      servedFloorIds: [defaultBranchFloor.id],
    });
    onUpdateParameters(nextParametersPatch);
    onChangeFloors(nextFloors);
  };

  const handleAssignSubDropperRange = (sdId: string, parentDropperIndex: number, branchFloorId: string) => {
    const draft = rangeDraftBySd[sdId];
    const fromId = draft?.fromId || branchFloorId;
    const toId = draft?.toId || branchFloorId;
    const idxA = floors.findIndex((f) => f.id === fromId);
    const idxB = floors.findIndex((f) => f.id === toId);
    if (idxA < 0 || idxB < 0) return;

    const minI = Math.min(idxA, idxB);
    const maxI = Math.max(idxA, idxB);
    const parentZone = dropperSummaries.find((d) => d.dropperIndex === parentDropperIndex)?.zoneType;
    const nextSupplyMode =
      parentZone === 'Booster'
        ? SupplyMode.BOOSTER
        : parentZone === 'Gravity'
        ? SupplyMode.GRAVITY
        : undefined;

    const nextFloors = floors.map((f, idx) => {
      if (f.supplyMode === SupplyMode.ROOF_HEADER) return f;
      if (idx >= minI && idx <= maxI) {
        return {
          ...f,
          subDropperId: sdId,
          ...(nextSupplyMode ? { supplyMode: nextSupplyMode } : {}),
        };
      }
      return f;
    });
    onChangeFloors(nextFloors);
  };

  const calcRowById = useMemo(() => {
    const map = new Map<string, SystemCalculationResult['rows'][number]>();
    if (calcResult) {
      calcResult.rows.forEach((r) => map.set(r.input.id, r));
    }
    return map;
  }, [calcResult]);

  const maxMainDropperIdx = useMemo(() => {
    let maxIdx = dropperSummaries.reduce((m, d) => Math.max(m, d.dropperIndex), 1);
    floors.forEach((f) => {
      if (f.manualDropperIndex && f.manualDropperIndex > maxIdx) {
        maxIdx = f.manualDropperIndex;
      }
      f.loadSplits?.forEach((s) => {
        if (s.target.kind === 'main' && s.target.dropperIndex > maxIdx) {
          maxIdx = s.target.dropperIndex;
        }
      });
    });
    return Math.min(12, maxIdx);
  }, [dropperSummaries, floors]);

  const formatTargetShort = (target: RiserTarget): string => {
    if (target.kind === 'main') return `D${target.dropperIndex}`;
    return subDroppers.find((s) => s.id === target.subDropperId)?.label ?? target.subDropperId;
  };

  const handleOpenOrStartSplit = (row: FloorInputRow) => {
    if (row.supplyMode === SupplyMode.ROOF_HEADER) return;
    if (row.loadSplits && row.loadSplits.length >= 2) {
      setExpandedSplitFloorId((prev) => (prev === row.id ? null : row.id));
      setCopyRangeFloorId(null);
      return;
    }
    const calcRow = calcRowById.get(row.id);
    const initialSplits = buildDefaultSplitForFloor(
      row,
      calcRow,
      dropperSummaries,
      subDropperSummaries
    );
    onChangeFloors(setFloorLoadSplits(floors, row.id, initialSplits));
    setExpandedSplitFloorId(row.id);
    setCopyRangeFloorId(null);
  };

  const handleUpdateSplitLegTarget = (
    floorId: string,
    splits: FloorRiserAllocation[],
    legIdx: number,
    encodedValue: string
  ) => {
    let nextTarget: RiserTarget;
    if (encodedValue.startsWith('main:')) {
      nextTarget = { kind: 'main', dropperIndex: Number(encodedValue.slice(5)) || 1 };
    } else if (encodedValue.startsWith('sub:')) {
      nextTarget = { kind: 'sub', subDropperId: encodedValue.slice(4) };
    } else {
      return;
    }
    if (splits.some((s, i) => i !== legIdx && isSameRiserTarget(s.target, nextTarget))) {
      return;
    }
    const nextSplits = splits.map((s, i) => (i === legIdx ? { ...s, target: nextTarget } : s));
    onChangeFloors(setFloorLoadSplits(floors, floorId, nextSplits));
  };

  const handleUpdateSplitLegLu = (
    floorId: string,
    splits: FloorRiserAllocation[],
    legIdx: number,
    lu: number
  ) => {
    const safeLu = Math.max(0, Math.round((Number.isFinite(lu) ? lu : 0) * 10) / 10);
    const nextSplits = splits.map((s, i) => (i === legIdx ? { ...s, loadingUnits: safeLu } : s));
    onChangeFloors(setFloorLoadSplits(floors, floorId, nextSplits));
  };

  const handleEqualizeSplits = (floorId: string, splits: FloorRiserAllocation[]) => {
    const total = splits.reduce((sum, s) => sum + Math.max(0, s.loadingUnits), 0);
    const shares = splitLuEvenly(total, splits.length);
    const nextSplits = splits.map((s, i) => ({ ...s, loadingUnits: shares[i] ?? 0 }));
    onChangeFloors(setFloorLoadSplits(floors, floorId, nextSplits));
  };

  const handleAddSplitLeg = (row: FloorInputRow, splits: FloorRiserAllocation[]) => {
    // Pick first unused main dropper (1..maxMainDropperIdx), else unused sub-dropper, else new main dropper
    let candidate: RiserTarget | null = null;
    for (let dIdx = 1; dIdx <= maxMainDropperIdx; dIdx++) {
      const t: RiserTarget = { kind: 'main', dropperIndex: dIdx };
      if (!splits.some((s) => isSameRiserTarget(s.target, t))) {
        candidate = t;
        break;
      }
    }
    if (!candidate) {
      for (const sd of subDroppers) {
        const t: RiserTarget = { kind: 'sub', subDropperId: sd.id };
        if (!splits.some((s) => isSameRiserTarget(s.target, t))) {
          candidate = t;
          break;
        }
      }
    }
    if (!candidate && maxMainDropperIdx < 12) {
      candidate = { kind: 'main', dropperIndex: maxMainDropperIdx + 1 };
    }
    if (!candidate) return;

    const total = Math.max(0, row.loadingUnits);
    const shares = splitLuEvenly(total, splits.length + 1);
    const nextSplits: FloorRiserAllocation[] = [
      ...splits.map((s, i) => ({ ...s, loadingUnits: shares[i] ?? 0 })),
      { target: candidate, loadingUnits: shares[splits.length] ?? 0 },
    ];
    onChangeFloors(setFloorLoadSplits(floors, row.id, nextSplits));
  };

  const handleRemoveSplitLeg = (
    floorId: string,
    splits: FloorRiserAllocation[],
    legIdx: number
  ) => {
    const remaining = splits.filter((_, i) => i !== legIdx);
    if (remaining.length <= 1) {
      onChangeFloors(setFloorLoadSplits(floors, floorId, remaining));
      setExpandedSplitFloorId(null);
      setCopyRangeFloorId(null);
      return;
    }
    const total = splits.reduce((sum, s) => sum + Math.max(0, s.loadingUnits), 0);
    const shares = splitLuEvenly(total, remaining.length);
    const nextSplits = remaining.map((s, i) => ({ ...s, loadingUnits: shares[i] ?? 0 }));
    onChangeFloors(setFloorLoadSplits(floors, floorId, nextSplits));
  };

  const handleClearFloorSplit = (floorId: string, splits: FloorRiserAllocation[]) => {
    const firstLeg = splits[0] ? [splits[0]] : undefined;
    onChangeFloors(setFloorLoadSplits(floors, floorId, firstLeg));
    setExpandedSplitFloorId(null);
    setCopyRangeFloorId(null);
  };

  const availableParentDroppers =
    dropperSummaries.length > 0
      ? dropperSummaries
      : [{ dropperIndex: 1, label: 'D1', zoneType: 'Gravity' as const }];

  const showTapOffCol = subDroppers.length > 0;
  const colSpanEmpty = 8 + (zoningStrategy === ZoningStrategy.MANUAL_ZONES ? 1 : 0) + (showTapOffCol ? 1 : 0);

  return (
    <div className="bg-white flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Parametric Tower Generator & Unified Floor Stack Toolbar */}
      <div className="shrink-0 bg-[#f8f8f8] border-b border-[#e0e0e0] px-4 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-[11px] font-bold uppercase tracking-wider text-[#121212]">
            Parametric Tower Generator
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            {genMessage && (
              <span className="font-mono text-[11px] text-[#15803d] font-medium">
                {genMessage}
              </span>
            )}
            <span className="font-mono text-[11px] font-semibold text-[#121212] tabular-nums">
              Floor Stack ({floors.length} {floors.length === 1 ? 'row' : 'rows'})
              {calcResult && calcResult.splitFloorCount > 0 && (
                <span className="text-[#0369a1] ml-1.5">
                  · ◐ {calcResult.splitFloorCount} Split
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <label
                htmlFor="gen-storeys"
                className="font-display text-[10px] font-bold uppercase text-[#555555] whitespace-nowrap"
              >
                Storeys
              </label>
              <input
                id="gen-storeys"
                type="number"
                min={2}
                max={120}
                value={genStoreys}
                onChange={(e) => setGenStoreys(Number(e.target.value))}
                className="w-[72px] h-7 px-2 text-xs text-right font-mono tabular-nums bg-white border border-[#e0e0e0] focus:outline-none focus:border-[#121212]"
              />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <label
                htmlFor="gen-roof-head"
                className="font-display text-[10px] font-bold uppercase text-[#555555] whitespace-nowrap"
              >
                Tank Head (m)
              </label>
              <TwoDecimalNumberInput
                id="gen-roof-head"
                min={0.5}
                value={genRoofHead}
                onCommit={(nextVal) => setGenRoofHead(nextVal)}
                className="w-[72px] h-7 px-2 text-xs text-right font-mono tabular-nums bg-white border border-[#e0e0e0] focus:outline-none focus:border-[#121212]"
              />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <label
                htmlFor="gen-typ-height"
                className="font-display text-[10px] font-bold uppercase text-[#555555] whitespace-nowrap"
              >
                Flr Ht (m)
              </label>
              <TwoDecimalNumberInput
                id="gen-typ-height"
                min={2.2}
                value={genTypHeight}
                onCommit={(nextVal) => setGenTypHeight(nextVal)}
                className="w-[72px] h-7 px-2 text-xs text-right font-mono tabular-nums bg-white border border-[#e0e0e0] focus:outline-none focus:border-[#121212]"
              />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <label
                htmlFor="gen-booster-count"
                className="font-display text-[10px] font-bold uppercase text-[#555555] whitespace-nowrap"
              >
                Booster Flrs
              </label>
              <input
                id="gen-booster-count"
                type="number"
                min={0}
                max={20}
                value={genBoosterCount}
                onChange={(e) => setGenBoosterCount(Number(e.target.value))}
                className="w-[72px] h-7 px-2 text-xs text-right font-mono tabular-nums bg-white border border-[#e0e0e0] focus:outline-none focus:border-[#121212]"
              />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <label
                htmlFor="gen-floor-lu"
                className="font-display text-[10px] font-bold uppercase text-[#555555] whitespace-nowrap"
              >
                LU / Flr
              </label>
              <div className="inline-flex items-center">
                <input
                  id="gen-floor-lu"
                  data-testid="gen-floor-lu-input"
                  type="number"
                  step="any"
                  min={0}
                  value={genFloorLu}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    setGenFloorLu(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
                    setGenApplianceCounts(undefined);
                  }}
                  className="w-[72px] h-7 px-2 text-xs text-right font-mono tabular-nums bg-white border border-[#e0e0e0] focus:z-10 focus:outline-none focus:border-[#121212]"
                />
                <button
                  type="button"
                  data-testid="gen-floor-lu-calc-btn"
                  onClick={() => setApplianceCalcTarget({ kind: 'generator' })}
                  aria-label="Calculate LU per floor from appliance quantities"
                  title={
                    genApplianceCounts
                      ? 'Calculated from appliances (click to edit quantities)'
                      : 'Open Appliance LU Calculator for LU / Flr'
                  }
                  className={`h-7 w-7 -ml-px inline-flex items-center justify-center border transition-colors shrink-0 ${
                    genApplianceCounts
                      ? 'bg-[#eff6ff] text-[#1d4ed8] border-[#1d4ed8] hover:bg-[#1d4ed8] hover:text-white'
                      : 'bg-white text-[#555555] border-[#e0e0e0] hover:bg-[#121212] hover:text-white hover:border-[#121212]'
                  }`}
                >
                  <Calculator className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleGenerateBuilding}
              className="h-7 px-3 font-display text-[10px] font-bold uppercase text-white bg-[#121212] hover:bg-[#2a2a2a] transition-colors whitespace-nowrap shrink-0"
            >
              Generate
            </button>
            <button
              type="button"
              onClick={handleAddRowTop}
              className="h-7 px-2.5 font-display text-[10px] font-bold uppercase bg-white border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3 h-3" />
              <span>{floors.length === 0 ? 'Add Roof' : 'Upper'}</span>
            </button>
            <button
              type="button"
              onClick={handleAddRowBottom}
              className="h-7 px-2.5 font-display text-[10px] font-bold uppercase bg-white border border-[#e0e0e0] text-[#121212] hover:border-[#121212] inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3 h-3" />
              <span>{floors.length === 0 ? 'Add L1' : 'Lower'}</span>
            </button>
          </div>
        </div>

        {/* Sub-Dropper Branch Configuration Strip */}
        {parameters && onUpdateParameters && (
          <div className="pt-2 border-t border-[#e0e0e0] space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch className="w-3.5 h-3.5 text-[#0891b2]" />
                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212]">
                  Sub-Dropper Branches ({subDroppers.length})
                </span>
                {subDroppers.length === 0 && (
                  <span className="text-[11px] text-[#666666]">
                    Branch a telescoping sub-dropper off any main dropper at a designated floor.
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={nonRoofFloors.length === 0}
                onClick={handleAddSubDropper}
                className="h-7 px-2.5 font-display text-[10px] font-bold uppercase bg-white border border-[#0891b2] text-[#0891b2] hover:bg-[#0891b2] hover:text-white disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Add Sub-Dropper</span>
              </button>
            </div>

            {subDroppers.length > 0 && (
              <div className="space-y-1.5">
                {subDroppers.map((sd) => {
                  const summary = subDropperSummaries.find((s) => s.id === sd.id);
                  const draft = rangeDraftBySd[sd.id] ?? {
                    fromId: sd.branchFloorId,
                    toId: sd.branchFloorId,
                  };
                  const odText =
                    summary?.baseNominalMm &&
                    summary?.terminalNominalMm &&
                    summary.baseNominalMm !== summary.terminalNominalMm
                      ? `Ø${summary.baseNominalMm}→${summary.terminalNominalMm}`
                      : summary?.baseNominalMm
                      ? `Ø${summary.baseNominalMm}`
                      : '—';

                  return (
                    <div
                      key={sd.id}
                      className="bg-white border border-[#e0e0e0] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={sd.label}
                          onChange={(e) =>
                            onUpdateParameters(
                              updateSubDropperConfig(parameters, sd.id, {
                                label: e.target.value,
                              })
                            )
                          }
                          aria-label={`Sub-dropper label ${sd.label}`}
                          className="w-16 h-6 px-1.5 text-xs font-mono font-bold text-[#0891b2] bg-[#f8f8f8] border border-[#e0e0e0] focus:bg-white focus:border-[#121212] focus:outline-none"
                        />

                        <div className="flex items-center gap-1">
                          <span className="font-display text-[9px] font-bold uppercase text-[#666666]">
                            Feed
                          </span>
                          <select
                            value={sd.parentDropperIndex}
                            onChange={(e) =>
                              onUpdateParameters(
                                updateSubDropperConfig(parameters, sd.id, {
                                  parentDropperIndex: Number(e.target.value),
                                })
                              )
                            }
                            aria-label={`Parent main dropper for ${sd.label}`}
                            className="h-6 px-1.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
                          >
                            {availableParentDroppers.map((d) => (
                              <option key={d.dropperIndex} value={d.dropperIndex}>
                                D{d.dropperIndex} ({d.zoneType === 'Booster' ? 'Boost' : 'Grav'})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-1">
                          <span className="font-display text-[9px] font-bold uppercase text-[#666666]">
                            Branch @
                          </span>
                          <select
                            value={sd.branchFloorId}
                            onChange={(e) =>
                              onUpdateParameters(
                                updateSubDropperConfig(parameters, sd.id, {
                                  branchFloorId: e.target.value,
                                })
                              )
                            }
                            aria-label={`Branch floor for ${sd.label}`}
                            className="h-6 px-1.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
                          >
                            {nonRoofFloors.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.floorLabel}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="inline-flex items-center">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateParameters(
                                updateSubDropperConfig(parameters, sd.id, {
                                  hasBoosterPump: !sd.hasBoosterPump || undefined,
                                  boosterBoostBar: !sd.hasBoosterPump
                                    ? undefined
                                    : undefined,
                                })
                              )
                            }
                            aria-pressed={Boolean(sd.hasBoosterPump)}
                            title={
                              sd.hasBoosterPump
                                ? `Remove inline booster pump (+${(
                                    sd.boosterBoostBar ?? parameters.boosterPumpBoostBar
                                  ).toFixed(2)} bar) from ${sd.label}`
                                : `Add inline booster pump (+${parameters.boosterPumpBoostBar.toFixed(
                                    2
                                  )} bar) to ${sd.label}`
                            }
                            className={`h-6 px-2 font-mono text-[10px] font-semibold border transition-colors whitespace-nowrap ${
                              sd.hasBoosterPump
                                ? sd.boosterBoostBar !== undefined
                                  ? 'bg-[#eef2ff] text-[#1d4ed8] border-[#1d4ed8] hover:bg-[#fee2e2] hover:text-[#d90000] hover:border-[#d90000]'
                                  : 'bg-[#e0f2fe] text-[#0369a1] border-[#0369a1] hover:bg-[#fee2e2] hover:text-[#d90000] hover:border-[#d90000]'
                                : 'bg-[#f8f8f8] text-[#555555] border-[#d4d4d4] hover:bg-[#e0f2fe] hover:text-[#0369a1] hover:border-[#0369a1]'
                            }`}
                          >
                            {sd.hasBoosterPump ? 'Pump' : '+ Pump'}
                          </button>
                          {sd.hasBoosterPump && (
                            <div className="inline-flex items-center -ml-px">
                              <input
                                type="number"
                                step="0.1"
                                min="0.1"
                                max="15.0"
                                value={
                                  sd.boosterBoostBar !== undefined
                                    ? sd.boosterBoostBar
                                    : parameters.boosterPumpBoostBar
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw.trim() === '') {
                                    onUpdateParameters(
                                      updateSubDropperConfig(parameters, sd.id, {
                                        boosterBoostBar: undefined,
                                      })
                                    );
                                    return;
                                  }
                                  const parsed = parseFloat(raw);
                                  if (!Number.isNaN(parsed) && parsed >= 0.1 && parsed <= 15) {
                                    const rounded = Math.round(parsed * 100) / 100;
                                    onUpdateParameters(
                                      updateSubDropperConfig(parameters, sd.id, {
                                        boosterBoostBar: rounded,
                                      })
                                    );
                                  }
                                }}
                                aria-label={`Booster pump pressure bar for ${sd.label}`}
                                title={
                                  sd.boosterBoostBar !== undefined
                                    ? `Custom booster pressure (+${sd.boosterBoostBar.toFixed(
                                        2
                                      )} bar; global ${parameters.boosterPumpBoostBar.toFixed(
                                        2
                                      )} bar)`
                                    : `Global default booster pressure (+${parameters.boosterPumpBoostBar.toFixed(
                                        2
                                      )} bar) — Edit to override for ${sd.label}`
                                }
                                className={`w-14 h-6 px-1 text-right font-mono text-[10px] font-semibold tabular-nums border focus:outline-none focus:border-[#121212] ${
                                  sd.boosterBoostBar !== undefined
                                    ? 'bg-[#dbeafe] text-[#1d4ed8] border-[#1d4ed8]'
                                    : 'bg-white text-[#0369a1] border-[#0369a1]'
                                }`}
                              />
                              <span className="h-6 px-1 inline-flex items-center text-[9px] font-mono bg-[#f8f8f8] border border-l-0 border-[#d4d4d4] text-[#555555]">
                                b{sd.boosterBoostBar !== undefined ? '*' : ''}
                              </span>
                              {sd.boosterBoostBar !== undefined && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onUpdateParameters(
                                      updateSubDropperConfig(parameters, sd.id, {
                                        boosterBoostBar: undefined,
                                      })
                                    )
                                  }
                                  title={`Reset ${sd.label} booster pressure to global default (${parameters.boosterPumpBoostBar.toFixed(
                                    2
                                  )} bar)`}
                                  className="h-6 px-1.5 -ml-px bg-white border border-[#d4d4d4] hover:border-[#121212] text-[9px] font-display font-bold uppercase text-[#121212]"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 pl-1 border-l border-[#e0e0e0]">
                          <span className="font-display text-[9px] font-bold uppercase text-[#666666]">
                            Range
                          </span>
                          <select
                            value={draft.fromId}
                            onChange={(e) =>
                              setRangeDraftBySd((prev) => ({
                                ...prev,
                                [sd.id]: { ...draft, fromId: e.target.value },
                              }))
                            }
                            aria-label={`Assign start floor for ${sd.label}`}
                            className="h-6 px-1 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
                          >
                            {nonRoofFloors.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.floorLabel}
                              </option>
                            ))}
                          </select>
                          <span className="text-[#888888]">–</span>
                          <select
                            value={draft.toId}
                            onChange={(e) =>
                              setRangeDraftBySd((prev) => ({
                                ...prev,
                                [sd.id]: { ...draft, toId: e.target.value },
                              }))
                            }
                            aria-label={`Assign end floor for ${sd.label}`}
                            className="h-6 px-1 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
                          >
                            {nonRoofFloors.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.floorLabel}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              handleAssignSubDropperRange(
                                sd.id,
                                sd.parentDropperIndex,
                                sd.branchFloorId
                              )
                            }
                            className="h-6 px-2 font-display text-[9px] font-bold uppercase bg-[#f8f8f8] border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white transition-colors whitespace-nowrap"
                          >
                            Assign
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 ml-auto">
                        {summary && (
                          <span className="font-mono tabular-nums text-[11px] text-[#555555] whitespace-nowrap">
                            {summary.servedFloorCount} flrs · {Math.round(summary.totalZoneLu)} LU ·{' '}
                            <strong className="text-[#121212]">{odText}</strong> ·{' '}
                            {summary.flowOrientation}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const { nextParametersPatch, nextFloors } = deleteSubDropperConfig(
                              parameters,
                              floors,
                              sd.id
                            );
                            onUpdateParameters(nextParametersPatch);
                            onChangeFloors(nextFloors);
                          }}
                          aria-label={`Delete sub-dropper ${sd.label}`}
                          className="h-6 w-6 inline-flex items-center justify-center text-[#666666] hover:text-[#d90000] transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 max-h-[70vh] lg:max-h-none overflow-y-auto overflow-x-auto bg-white">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#eeeeee] text-[#121212] font-display text-[10px] uppercase">
              <th className="py-1.5 px-2 text-left font-bold w-10 bg-[#eeeeee] border-b-2 border-[#121212]">#</th>
              <th className="py-1.5 px-2 text-left font-bold bg-[#eeeeee] border-b-2 border-[#121212]">Level</th>
              <th className="py-1.5 px-2 text-right font-bold bg-[#eeeeee] border-b-2 border-[#121212]">Height (m)</th>
              <th className="py-1.5 px-2 text-left font-bold bg-[#eeeeee] border-b-2 border-[#121212]">Supply Mode</th>
              {showTapOffCol && (
                <th className="py-1.5 px-2 text-left font-bold bg-[#eeeeee] border-b-2 border-[#121212]">Tap-Off Riser</th>
              )}
              <th className="py-1.5 px-2 text-right font-bold bg-[#eeeeee] border-b-2 border-[#121212]">Loading Units</th>
              <th className="py-1.5 px-2 text-left font-bold bg-[#eeeeee] border-b-2 border-[#121212]">Load Split</th>
              <th className="py-1.5 px-2 text-left font-bold bg-[#eeeeee] border-b-2 border-[#121212]">PRV Rule</th>
              {zoningStrategy === ZoningStrategy.MANUAL_ZONES && (
                <th className="py-1.5 px-2 text-right font-bold bg-[#eeeeee] border-b-2 border-[#121212]">Dropper #</th>
              )}
              <th className="py-1.5 px-2 text-center font-bold w-10 bg-[#eeeeee] border-b-2 border-[#121212]">Del</th>
            </tr>
          </thead>
          <tbody onMouseLeave={() => setHoveredRowIdx(null)}>
            {floors.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpanEmpty}
                  className="py-10 px-4 text-center text-xs text-[#666666] border-b border-[#e0e0e0]"
                >
                  Clean slate project — use the Parametric Tower Generator above or add Roof/Floor rows manually.
                </td>
              </tr>
            ) : (
              floors.map((row, idx) => {
                const isRoof = row.supplyMode === SupplyMode.ROOF_HEADER;
                const isHovered = hoveredRowIdx === idx;
                const explicitSplits =
                  !isRoof && row.loadSplits && row.loadSplits.length >= 2 ? row.loadSplits : null;
                const calcRow = calcRowById.get(row.id);
                const isAnySplit = Boolean(explicitSplits || calcRow?.isSplitFloor);
                const isSplitExpanded = Boolean(explicitSplits && expandedSplitFloorId === row.id);

                const rowBg = isSplitExpanded
                  ? 'bg-[#eff6ff]'
                  : isHovered
                  ? 'bg-[#eeeeee]'
                  : isRoof
                  ? 'bg-[#f4f4f4]'
                  : idx % 2 === 1
                  ? 'bg-[#fafafa]'
                  : 'bg-white';
                const effectivePrvRule = row.subDropperId
                  ? row.subDropperPrvOverrides?.[row.subDropperId] ?? row.prvOverride
                  : row.prvOverride;

                const splitSummaryText = explicitSplits
                  ? explicitSplits
                      .map((s) => `${formatTargetShort(s.target)} ${Math.round(s.loadingUnits)}`)
                      .join(' · ')
                  : calcRow?.isSplitFloor
                  ? calcRow.riserAllocations
                      .map((a) => `${a.riserLabel} ${Math.round(a.assignedLu)}`)
                      .join(' · ')
                  : null;

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      onMouseEnter={() => setHoveredRowIdx(idx)}
                      className={`group ${rowBg} hover:bg-[#eeeeee] focus-within:bg-[#eeeeee] transition-colors`}
                    >
                      <td className="py-0.5 px-2 align-middle font-mono tabular-nums text-[11px] text-[#666666] border-b border-[#e0e0e0]">
                        {idx + 1}
                      </td>
                      <td className="py-0.5 px-2 align-middle border-b border-[#e0e0e0]">
                        <input
                          type="text"
                          value={row.floorLabel}
                          onChange={(e) => handleUpdateRow(idx, { floorLabel: e.target.value })}
                          aria-label={`Floor label row ${idx + 1}`}
                          className="w-24 h-6 px-1.5 py-0 text-xs font-mono font-medium bg-transparent focus:bg-white border border-[#e0e0e0] group-hover:border-[#bdbdbd] focus:outline-none focus:border-[#121212] transition-colors"
                        />
                      </td>
                      <td className="py-0.5 px-2 align-middle text-right border-b border-[#e0e0e0]">
                        <TwoDecimalNumberInput
                          min={0.1}
                          value={row.floorHeightM}
                          onCommit={(nextHeight) =>
                            handleUpdateRow(idx, {
                              floorHeightM: Math.max(0, nextHeight),
                            })
                          }
                          ariaLabel={`Floor height row ${idx + 1}`}
                          className="w-20 h-6 px-1.5 py-0 text-xs text-right font-mono tabular-nums bg-transparent focus:bg-white border border-[#e0e0e0] group-hover:border-[#bdbdbd] focus:outline-none focus:border-[#121212] transition-colors"
                        />
                      </td>
                      <td className="py-0.5 px-2 align-middle border-b border-[#e0e0e0]">
                        <select
                          value={row.supplyMode}
                          onChange={(e) =>
                            handleUpdateRow(idx, { supplyMode: e.target.value as SupplyMode })
                          }
                          aria-label={`Supply mode row ${idx + 1}`}
                          className="h-6 px-1.5 py-0 text-xs font-mono bg-transparent focus:bg-white border border-[#e0e0e0] group-hover:border-[#bdbdbd] text-[#121212] [&>option]:bg-white [&>option]:text-[#121212] focus:outline-none focus:border-[#121212] transition-colors"
                        >
                          <option value={SupplyMode.ROOF_HEADER}>Roof Tank / Header</option>
                          <option value={SupplyMode.BOOSTER}>Booster Pump Zone</option>
                          <option value={SupplyMode.GRAVITY}>Gravity Flow Zone</option>
                        </select>
                      </td>
                      {showTapOffCol && (
                        <td className="py-0.5 px-2 align-middle border-b border-[#e0e0e0]">
                          {isRoof ? (
                            <span className="text-[#888888]">—</span>
                          ) : explicitSplits ? (
                            <button
                              type="button"
                              onClick={() => handleOpenOrStartSplit(row)}
                              className="h-6 px-1.5 text-[11px] font-mono font-semibold text-[#0369a1] bg-[#f0f9ff] border border-[#bae6fd] hover:border-[#0369a1] inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <TapDotGlyph split />
                              <span>{explicitSplits.length} Risers</span>
                            </button>
                          ) : (
                            <select
                              value={row.subDropperId ?? ''}
                              onChange={(e) => {
                                const nextSdId = e.target.value || undefined;
                                if (!nextSdId) {
                                  handleUpdateRow(idx, { subDropperId: undefined });
                                  return;
                                }
                                const sdObj = subDroppers.find((s) => s.id === nextSdId);
                                const parentZone = sdObj
                                  ? dropperSummaries.find(
                                      (d) => d.dropperIndex === sdObj.parentDropperIndex
                                    )?.zoneType
                                  : undefined;
                                handleUpdateRow(idx, {
                                  subDropperId: nextSdId,
                                  ...(parentZone
                                    ? {
                                        supplyMode:
                                          parentZone === 'Booster'
                                            ? SupplyMode.BOOSTER
                                            : SupplyMode.GRAVITY,
                                      }
                                    : {}),
                                });
                              }}
                              aria-label={`Tap-off riser row ${idx + 1}`}
                              className={`h-6 px-1.5 py-0 text-xs font-mono bg-transparent focus:bg-white border border-[#e0e0e0] group-hover:border-[#bdbdbd] [&>option]:bg-white [&>option]:text-[#121212] focus:outline-none focus:border-[#121212] transition-colors ${
                                row.subDropperId
                                  ? 'text-[#0891b2] font-semibold'
                                  : 'text-[#121212]'
                              }`}
                            >
                              <option value="">
                                {zoningStrategy === ZoningStrategy.MANUAL_ZONES
                                  ? `Main D${row.manualDropperIndex ?? 1}`
                                  : 'Main Riser'}
                              </option>
                              {subDroppers.map((sd) => {
                                const bLbl =
                                  floors.find((f) => f.id === sd.branchFloorId)?.floorLabel ?? '?';
                                return (
                                  <option key={sd.id} value={sd.id}>
                                    {sd.label} (←D{sd.parentDropperIndex}@{bLbl})
                                  </option>
                                );
                              })}
                            </select>
                          )}
                        </td>
                      )}
                      <td className="py-0.5 px-2 align-middle text-right border-b border-[#e0e0e0]">
                        {isRoof ? (
                          <span className="text-[11px] text-[#666666] font-mono">Header Auto</span>
                        ) : (
                          <div className="inline-flex items-center justify-end">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={row.loadingUnits}
                              onChange={(e) => {
                                const nextLu = Math.max(0, parseFloat(e.target.value) || 0);
                                if (explicitSplits) {
                                  handleUpdateRow(idx, {
                                    loadingUnits: nextLu,
                                    applianceCounts: undefined,
                                    loadSplits: scaleFloorLoadSplitsForTotal(row, nextLu),
                                  });
                                } else {
                                  handleUpdateRow(idx, {
                                    loadingUnits: nextLu,
                                    applianceCounts: undefined,
                                  });
                                }
                              }}
                              aria-label={`Loading units row ${idx + 1}`}
                              className="w-20 h-6 px-1.5 py-0 text-xs text-right font-mono tabular-nums bg-transparent focus:bg-white border border-[#e0e0e0] group-hover:border-[#bdbdbd] focus:z-10 focus:outline-none focus:border-[#121212] transition-colors"
                            />
                            <button
                              type="button"
                              data-testid={`floor-lu-calc-btn-${row.floorLabel}`}
                              onClick={() =>
                                setApplianceCalcTarget({
                                  kind: 'floor',
                                  floorId: row.id,
                                  floorLabel: row.floorLabel,
                                })
                              }
                              aria-label={`Calculate loading units from appliances for ${row.floorLabel}`}
                              title={
                                row.applianceCounts
                                  ? `Calculated from appliances (click to edit quantities)`
                                  : `Open Appliance LU Calculator for ${row.floorLabel}`
                              }
                              className={`h-6 w-6 -ml-px inline-flex items-center justify-center border transition-colors shrink-0 ${
                                row.applianceCounts
                                  ? 'bg-[#eff6ff] text-[#1d4ed8] border-[#1d4ed8] hover:bg-[#1d4ed8] hover:text-white'
                                  : 'bg-[#f8f8f8] text-[#555555] border-[#e0e0e0] group-hover:border-[#bdbdbd] hover:bg-[#121212] hover:text-white hover:border-[#121212]'
                              }`}
                            >
                              <Calculator className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-0.5 px-2 align-middle border-b border-[#e0e0e0]">
                        {isRoof ? (
                          <span className="text-[#888888]">—</span>
                        ) : isAnySplit ? (
                          <button
                            type="button"
                            onClick={() => handleOpenOrStartSplit(row)}
                            aria-expanded={isSplitExpanded}
                            title="Configure multi-dropper LU split for this floor"
                            data-testid={`split-btn-${row.floorLabel}`}
                            className={`h-6 px-2 font-mono tabular-nums text-[11px] inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap ${
                              isSplitExpanded
                                ? 'bg-[#121212] text-white border-[#121212]'
                                : 'bg-[#eff6ff] text-[#1d4ed8] border-[#1d4ed8] hover:bg-[#1d4ed8] hover:text-white'
                            }`}
                          >
                            <TapDotGlyph split />
                            <span className="font-semibold">{splitSummaryText}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenOrStartSplit(row)}
                            title="Split this floor's loading units across multiple droppers"
                            data-testid={`split-btn-${row.floorLabel}`}
                            className="h-6 px-2 font-mono text-[11px] inline-flex items-center gap-1.5 bg-transparent hover:bg-white text-[#555555] hover:text-[#121212] border border-[#e0e0e0] hover:border-[#121212] transition-colors whitespace-nowrap"
                          >
                            <TapDotGlyph split={false} className="text-[#121212]" />
                            <span>Full</span>
                            <span className="text-[10px] font-display uppercase text-[#666666] group-hover:text-[#121212] pl-0.5 border-l border-[#e0e0e0]">
                              Split
                            </span>
                          </button>
                        )}
                      </td>
                      <td className="py-0.5 px-2 align-middle border-b border-[#e0e0e0]">
                        {isRoof ? (
                          <span className="text-[#888888]">—</span>
                        ) : (
                          <select
                            value={effectivePrvRule}
                            onChange={(e) =>
                              handleUpdateRow(idx, {
                                prvOverride: e.target.value as PrvOverrideMode,
                              })
                            }
                            aria-label={`PRV placement mode row ${idx + 1}`}
                            className="h-6 px-1.5 py-0 text-xs font-mono bg-transparent focus:bg-white border border-[#e0e0e0] group-hover:border-[#bdbdbd] text-[#121212] [&>option]:bg-white [&>option]:text-[#121212] focus:outline-none focus:border-[#121212] transition-colors"
                          >
                            <option value={PrvOverrideMode.AUTO}>Auto (&gt; Pmax)</option>
                            <option value={PrvOverrideMode.FORCE_PRV}>Force PRV</option>
                            <option value={PrvOverrideMode.NO_PRV}>Suppress PRV</option>
                          </select>
                        )}
                      </td>
                      {zoningStrategy === ZoningStrategy.MANUAL_ZONES && (
                        <td className="py-0.5 px-2 align-middle text-right border-b border-[#e0e0e0]">
                          {isRoof ? (
                            <span className="text-[#888888]">—</span>
                          ) : explicitSplits ? (
                            <span className="font-mono text-[11px] font-semibold text-[#1d4ed8]">
                              Split
                            </span>
                          ) : (
                            <input
                              type="number"
                              min="1"
                              max="12"
                              value={row.manualDropperIndex ?? 1}
                              onChange={(e) =>
                                handleUpdateRow(idx, {
                                  manualDropperIndex: Math.max(
                                    1,
                                    Math.round(parseInt(e.target.value, 10) || 1)
                                  ),
                                })
                              }
                              className="w-14 h-6 px-1.5 py-0 text-xs text-right font-mono tabular-nums bg-transparent focus:bg-white border border-[#e0e0e0] group-hover:border-[#bdbdbd] focus:outline-none focus:border-[#121212] transition-colors"
                            />
                          )}
                        </td>
                      )}
                      <td className="py-0.5 px-2 align-middle text-center border-b border-[#e0e0e0]">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(idx)}
                          aria-label={`Delete floor ${row.floorLabel}`}
                          className="h-6 w-6 p-0 text-[#666666] hover:text-[#d90000] transition-colors inline-flex items-center justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>

                    {/* Expandable Inline Multi-Dropper Load Split Editor */}
                    {isSplitExpanded && explicitSplits && (
                      <tr className="bg-[#f8f8f8]">
                        <td
                          colSpan={colSpanEmpty}
                          className="px-3.5 py-2.5 border-b-2 border-[#121212]"
                        >
                          <div className="bg-white border border-[#121212] p-2.5 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#e0e0e0]">
                              <div className="flex flex-wrap items-center gap-2">
                                <TapDotGlyph split className="text-[#1d4ed8]" />
                                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212]">
                                  Multi-Dropper Load Split — Level {row.floorLabel}
                                </span>
                                <span className="font-mono tabular-nums text-[11px] font-semibold text-[#1d4ed8]">
                                  Total: {row.loadingUnits.toFixed(1).replace(/\.0$/, '')} LU
                                </span>
                                <span className="text-[11px] text-[#666666]">
                                  ({formatFlowFormulaDisplay(parameters?.flowFormula, effectiveStandard)} evaluated per riser)
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleEqualizeSplits(row.id, explicitSplits)}
                                  className="h-6 px-2 font-display text-[9px] font-bold uppercase bg-[#f8f8f8] border border-[#e0e0e0] hover:border-[#121212] text-[#121212] transition-colors whitespace-nowrap"
                                >
                                  Equal Split
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAddSplitLeg(row, explicitSplits)}
                                  className="h-6 px-2 font-display text-[9px] font-bold uppercase bg-white border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Add Riser</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (copyRangeFloorId === row.id) {
                                      setCopyRangeFloorId(null);
                                    } else {
                                      setCopyRangeFloorId(row.id);
                                      setCopyRangeDraft({ fromId: row.id, toId: row.id });
                                    }
                                  }}
                                  className={`h-6 px-2 font-display text-[9px] font-bold uppercase border inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                                    copyRangeFloorId === row.id
                                      ? 'bg-[#121212] text-white border-[#121212]'
                                      : 'bg-white text-[#121212] border-[#e0e0e0] hover:border-[#121212]'
                                  }`}
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Copy to Floors</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleClearFloorSplit(row.id, explicitSplits)}
                                  className="h-6 px-2 font-display text-[9px] font-bold uppercase bg-white border border-[#e0e0e0] text-[#666666] hover:border-[#d90000] hover:text-[#d90000] transition-colors whitespace-nowrap"
                                >
                                  Clear Split
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedSplitFloorId(null);
                                    setCopyRangeFloorId(null);
                                  }}
                                  aria-label="Close split editor"
                                  className="h-6 w-6 inline-flex items-center justify-center bg-[#f8f8f8] border border-[#e0e0e0] text-[#555555] hover:border-[#121212] hover:text-[#121212]"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {copyRangeFloorId === row.id && (
                              <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 bg-[#f8f8f8] border border-[#e0e0e0] text-[11px]">
                                <span className="font-display text-[9px] font-bold uppercase text-[#555555]">
                                  Apply Split Ratio to Range:
                                </span>
                                <select
                                  value={copyRangeDraft.fromId}
                                  onChange={(e) =>
                                    setCopyRangeDraft((prev) => ({
                                      ...prev,
                                      fromId: e.target.value,
                                    }))
                                  }
                                  aria-label="Copy split ratio start floor"
                                  className="h-6 px-1.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
                                >
                                  {nonRoofFloors.map((nf) => (
                                    <option key={nf.id} value={nf.id}>
                                      {nf.floorLabel}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-[#888888]">–</span>
                                <select
                                  value={copyRangeDraft.toId}
                                  onChange={(e) =>
                                    setCopyRangeDraft((prev) => ({
                                      ...prev,
                                      toId: e.target.value,
                                    }))
                                  }
                                  aria-label="Copy split ratio end floor"
                                  className="h-6 px-1.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
                                >
                                  {nonRoofFloors.map((nf) => (
                                    <option key={nf.id} value={nf.id}>
                                      {nf.floorLabel}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onChangeFloors(
                                      applySplitRatioToFloorRange(
                                        floors,
                                        row.id,
                                        copyRangeDraft.fromId,
                                        copyRangeDraft.toId
                                      )
                                    );
                                    setCopyRangeFloorId(null);
                                  }}
                                  className="h-6 px-2.5 font-display text-[9px] font-bold uppercase bg-[#121212] text-white hover:bg-[#2a2a2a]"
                                >
                                  Apply Ratio
                                </button>
                              </div>
                            )}

                            <div className="space-y-1.5">
                              {explicitSplits.map((leg, legIdx) => {
                                const encodedVal =
                                  leg.target.kind === 'main'
                                    ? `main:${leg.target.dropperIndex}`
                                    : `sub:${leg.target.subDropperId}`;
                                const totalSplitLu = explicitSplits.reduce(
                                  (sum, s) => sum + Math.max(0, s.loadingUnits),
                                  0
                                );
                                const pct =
                                  totalSplitLu > 0
                                    ? (Math.max(0, leg.loadingUnits) / totalSplitLu) * 100
                                    : 100 / explicitSplits.length;
                                const allocResult = calcRow?.riserAllocations.find((a) =>
                                  isSameRiserTarget(a.target, leg.target)
                                );
                                const velExceeded = Boolean(
                                  allocResult?.velocityMs !== null &&
                                    allocResult?.velocityMs !== undefined &&
                                    parameters &&
                                    allocResult.velocityMs > parameters.maxVelocityMs + 1e-4
                                );

                                return (
                                  <div
                                    key={`${row.id}-leg-${riserTargetKey(leg.target)}-${legIdx}`}
                                    className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 bg-[#fafafa] border border-[#e0e0e0]"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-mono text-[10px] font-bold text-[#666666] w-5">
                                        #{legIdx + 1}
                                      </span>
                                      <select
                                        value={encodedVal}
                                        onChange={(e) =>
                                          handleUpdateSplitLegTarget(
                                            row.id,
                                            explicitSplits,
                                            legIdx,
                                            e.target.value
                                          )
                                        }
                                        aria-label={`Split branch ${legIdx + 1} riser for Level ${row.floorLabel}`}
                                        className="h-6 px-1.5 text-xs font-mono font-semibold bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
                                      >
                                        {Array.from(
                                          { length: maxMainDropperIdx },
                                          (_, i) => i + 1
                                        ).map((dIdx) => {
                                          const summary = dropperSummaries.find(
                                            (d) => d.dropperIndex === dIdx
                                          );
                                          const targetObj: RiserTarget = {
                                            kind: 'main',
                                            dropperIndex: dIdx,
                                          };
                                          const usedElsewhere = explicitSplits.some(
                                            (s, i) =>
                                              i !== legIdx &&
                                              isSameRiserTarget(s.target, targetObj)
                                          );
                                          return (
                                            <option
                                              key={`opt-main-${dIdx}`}
                                              value={`main:${dIdx}`}
                                              disabled={usedElsewhere}
                                            >
                                              D{dIdx}
                                              {summary
                                                ? ` (${summary.zoneType === 'Booster' ? 'Boost' : 'Grav'})`
                                                : ''}
                                            </option>
                                          );
                                        })}
                                        {maxMainDropperIdx < 12 && (
                                          <option value={`main:${maxMainDropperIdx + 1}`}>
                                            + New Main D{maxMainDropperIdx + 1}
                                          </option>
                                        )}
                                        {subDroppers.map((sd) => {
                                          const targetObj: RiserTarget = {
                                            kind: 'sub',
                                            subDropperId: sd.id,
                                          };
                                          const usedElsewhere = explicitSplits.some(
                                            (s, i) =>
                                              i !== legIdx &&
                                              isSameRiserTarget(s.target, targetObj)
                                          );
                                          const bLbl =
                                            floors.find((f) => f.id === sd.branchFloorId)
                                              ?.floorLabel ?? '?';
                                          return (
                                            <option
                                              key={`opt-sub-${sd.id}`}
                                              value={`sub:${sd.id}`}
                                              disabled={usedElsewhere}
                                            >
                                              {sd.label} (←D{sd.parentDropperIndex}@{bLbl})
                                            </option>
                                          );
                                        })}
                                      </select>

                                      <div className="flex items-center gap-1">
                                        <input
                                          type="number"
                                          step="1"
                                          min="0"
                                          value={leg.loadingUnits}
                                          onChange={(e) =>
                                            handleUpdateSplitLegLu(
                                              row.id,
                                              explicitSplits,
                                              legIdx,
                                              parseFloat(e.target.value)
                                            )
                                          }
                                          aria-label={`Assigned LU on ${formatTargetShort(leg.target)} at Level ${row.floorLabel}`}
                                          className="w-24 h-6 px-1.5 text-xs text-right font-mono tabular-nums bg-white border border-[#121212] text-[#121212] focus:outline-none"
                                        />
                                        <span className="font-mono text-[11px] text-[#555555]">
                                          LU
                                        </span>
                                      </div>

                                      <span className="font-mono tabular-nums text-[11px] font-semibold text-[#1d4ed8] w-12 text-right">
                                        {pct.toFixed(0)}%
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-3 ml-auto">
                                      {allocResult && (
                                        <span className="font-mono tabular-nums text-[11px] text-[#555555] whitespace-nowrap">
                                          Cum {Math.round(allocResult.cumulativeLu)} LU ·{' '}
                                          {allocResult.flowRateLs.toFixed(2)} L/s ·{' '}
                                          <strong
                                            className={
                                              allocResult.isFallbackMaterial
                                                ? 'text-[#1d4ed8]'
                                                : 'text-[#121212]'
                                            }
                                          >
                                            {allocResult.nominalMm
                                              ? `${
                                                  allocResult.isFallbackMaterial
                                                    ? `${getPipeSpecBadgeLabel(allocResult.specId)} `
                                                    : ''
                                                }Ø${allocResult.nominalMm}`
                                              : '—'}
                                          </strong>{' '}
                                          ·{' '}
                                          <strong
                                            className={
                                              velExceeded ? 'text-[#d90000]' : 'text-[#121212]'
                                            }
                                          >
                                            {allocResult.velocityMs !== null
                                              ? `${allocResult.velocityMs.toFixed(2)} m/s`
                                              : '—'}
                                          </strong>
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleRemoveSplitLeg(row.id, explicitSplits, legIdx)
                                        }
                                        aria-label={`Remove ${formatTargetShort(leg.target)} from Level ${row.floorLabel} split`}
                                        className="h-6 w-6 inline-flex items-center justify-center text-[#666666] hover:text-[#d90000] transition-colors"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Appliance Quantity LU Pop-Out Calculator */}
      {(() => {
        if (!applianceCalcTarget) return null;
        const targetFloorIdx =
          applianceCalcTarget.kind === 'floor'
            ? floors.findIndex((f) => f.id === applianceCalcTarget.floorId)
            : -1;
        const targetFloor = targetFloorIdx >= 0 ? floors[targetFloorIdx] : null;
        const targetLabel =
          applianceCalcTarget.kind === 'generator'
            ? 'Parametric Tower (LU / Flr)'
            : `Level ${targetFloor?.floorLabel ?? applianceCalcTarget.floorLabel}`;
        const initialCounts =
          applianceCalcTarget.kind === 'generator'
            ? genApplianceCounts
            : targetFloor?.applianceCounts;
        const currentLu =
          applianceCalcTarget.kind === 'generator'
            ? genFloorLu
            : targetFloor?.loadingUnits ?? 0;

        return (
          <ApplianceCalculatorModal
            isOpen
            targetLabel={targetLabel}
            standard={effectiveStandard}
            flowFormula={parameters?.flowFormula}
            initialCounts={initialCounts}
            currentLu={currentLu}
            availableFloors={availableFloorOptions}
            currentFloorId={
              applianceCalcTarget.kind === 'floor' ? applianceCalcTarget.floorId : undefined
            }
            onApply={(totalLu, counts) => {
              if (applianceCalcTarget.kind === 'generator') {
                setGenFloorLu(totalLu);
                setGenApplianceCounts(counts);
              } else if (targetFloorIdx >= 0 && targetFloor) {
                const hasSplits =
                  targetFloor.supplyMode !== SupplyMode.ROOF_HEADER &&
                  targetFloor.loadSplits &&
                  targetFloor.loadSplits.length >= 2;
                if (hasSplits) {
                  handleUpdateRow(targetFloorIdx, {
                    loadingUnits: totalLu,
                    applianceCounts: counts,
                    loadSplits: scaleFloorLoadSplitsForTotal(targetFloor, totalLu),
                  });
                } else {
                  handleUpdateRow(targetFloorIdx, {
                    loadingUnits: totalLu,
                    applianceCounts: counts,
                  });
                }
              }
            }}
            onApplyRange={(totalLu, counts, fromFloorId, toFloorId) => {
              onChangeFloors(
                applyApplianceLuToFloorRange(
                  floors,
                  fromFloorId,
                  toFloorId,
                  totalLu,
                  counts
                )
              );
            }}
            onClose={() => setApplianceCalcTarget(null)}
          />
        );
      })()}
    </div>
  );
};

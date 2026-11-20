import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { formatPipeDim, getPipeSpecBadgeLabel, PIPE_SPEC_TABLES } from '../data/pipeSpecs';
import {
  DesignParameters,
  DropperZoneSummary,
  FloorInputRow,
  FloorRiserAllocation,
  PipeSpecId,
  PrvOverrideMode,
  RiserTarget,
  SubDropperSummary,
  SupplyMode,
  SystemCalculationResult,
} from '../types/hydraulics';
import {
  addPrvStation,
  addSubDropperConfig,
  buildDefaultSplitForFloor,
  calculateVelocityMs,
  formatCavitationRatio,
  getAvailablePipeSizes,
  getEffectiveCavitationRatioLimit,
  reassignFloorTappingTarget,
  relocateSubDropperBranchPoint,
  removePrvStation,
  repositionPrvStation,
  resetAllPrvOverrides,
  runHydraulicCalculations,
  setFloorLoadSplits,
  setPrvStationSetPressure,
  setRiserBoosterPressure,
  splitFloorWithRiserTarget,
  splitLuEvenly,
  toggleRiserBoosterPump,
} from '../utils/calculations';

interface RiserSchematicProps {
  result: SystemCalculationResult;
  floors?: FloorInputRow[];
  onChangeFloors?: (nextFloors: FloorInputRow[]) => void;
  onUpdateParameters?: (patch: Partial<DesignParameters>) => void;
  isAddPrvMode?: boolean;
  onChangeAddPrvMode?: (next: boolean) => void;
  highlightedRiser?: RiserTarget | null;
  stickyHeader?: boolean;
}

const DROPPER_COLORS = [
  '#121212',
  '#0369a1',
  '#1d4ed8',
  '#0f766e',
  '#7c2d12',
  '#be185d',
  '#6d28d9',
  '#4338ca',
];

const SUB_DROPPER_COLORS = [
  '#0891b2',
  '#7c3aed',
  '#059669',
  '#c2410c',
  '#0284c7',
  '#be123c',
];

type OrderedRiserColumn =
  | {
      kind: 'main';
      key: string;
      target: RiserTarget;
      dropperIndex: number;
      shortLabel: string;
      color: string;
      summary: DropperZoneSummary;
    }
  | {
      kind: 'sub';
      key: string;
      target: RiserTarget;
      subDropperId: string;
      parentDropperIndex: number;
      branchRowIdx: number;
      shortLabel: string;
      color: string;
      summary: SubDropperSummary;
    };

function riserKey(target: RiserTarget): string {
  return target.kind === 'main' ? `main-${target.dropperIndex}` : `sub-${target.subDropperId}`;
}

function isSameRiser(a: RiserTarget, b: RiserTarget): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'main'
    ? a.dropperIndex === (b as { kind: 'main'; dropperIndex: number }).dropperIndex
    : a.subDropperId === (b as { kind: 'sub'; subDropperId: string }).subDropperId;
}

type DragState =
  | {
      kind: 'tapping';
      floorId: string;
      floorLabel: string;
      rowIdx: number;
      sourceTarget: RiserTarget;
      targetTarget: RiserTarget;
      isNewMainRiser: boolean;
      pointerX: number;
      loadingUnits: number;
      isSplitLeg: boolean;
      started: boolean;
      startClientX: number;
      startClientY: number;
    }
  | {
      kind: 'prv';
      sourceFloorId: string;
      sourceFloorLabel: string;
      sourceRowIdx: number;
      sourceTarget: RiserTarget;
      targetRowIdx: number;
      targetFloorId: string;
      targetFloorLabel: string;
      targetTarget: RiserTarget;
      pointerX: number;
      pointerY: number;
      started: boolean;
      startClientX: number;
      startClientY: number;
    }
  | {
      kind: 'new-prv';
      targetRowIdx: number;
      targetFloorId: string;
      targetFloorLabel: string;
      targetTarget: RiserTarget;
      pointerX: number;
      pointerY: number;
      insideSvg: boolean;
      started: boolean;
      startClientX: number;
      startClientY: number;
    }
  | {
      kind: 'sub-branch';
      subDropperId: string;
      subDropperLabel: string;
      parentDropperIndex: number;
      sourceBranchRowIdx: number;
      sourceBranchFloorId: string;
      sourceBranchFloorLabel: string;
      targetBranchRowIdx: number;
      targetBranchFloorId: string;
      targetBranchFloorLabel: string;
      pointerY: number;
      started: boolean;
      startClientX: number;
      startClientY: number;
    };

interface SelectedPrv {
  target: RiserTarget;
  targetKey: string;
  riserLabel: string;
  floorId: string;
  floorLabel: string;
}

interface SelectedTapNode {
  target: RiserTarget;
  targetKey: string;
  riserLabel: string;
  floorId: string;
  floorLabel: string;
}

interface ContextMenuState {
  clientX: number;
  clientY: number;
  target: RiserTarget;
  riserLabel: string;
  floorId: string;
  floorLabel: string;
  hasPrv: boolean;
  isServed: boolean;
}

export const RiserSchematic: React.FC<RiserSchematicProps> = ({
  result,
  floors,
  onChangeFloors,
  onUpdateParameters,
  isAddPrvMode: controlledAddPrvMode,
  onChangeAddPrvMode,
  highlightedRiser = null,
  stickyHeader,
}) => {
  const {
    rows,
    dropperSummaries,
    subDropperSummaries,
    pipeHeader,
    parameters,
    pipeSpec,
    optionalPipeSpec,
  } = result;
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [hoveredTargetKey, setHoveredTargetKey] = useState<string | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<{
    target: RiserTarget;
    targetKey: string;
    rowIdx: number;
  } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectedPrv, setSelectedPrv] = useState<SelectedPrv | null>(null);
  const [isPrvPopoverOpen, setIsPrvPopoverOpen] = useState<boolean>(false);
  const [selectedTapNode, setSelectedTapNode] = useState<SelectedTapNode | null>(null);
  const [prvP2Draft, setPrvP2Draft] = useState<string>('');
  const [isPrvInputFocused, setIsPrvInputFocused] = useState<boolean>(false);
  const [internalAddPrvMode, setInternalAddPrvMode] = useState<boolean>(false);
  const isAddPrvMode = controlledAddPrvMode ?? internalAddPrvMode;
  const setIsAddPrvMode = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(isAddPrvMode) : next;
    if (onChangeAddPrvMode) {
      onChangeAddPrvMode(resolved);
    } else {
      setInternalAddPrvMode(resolved);
    }
  };
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isScrolled, setIsScrolled] = useState<boolean>(false);
  const [isSubCreatorOpen, setIsSubCreatorOpen] = useState<boolean>(false);
  const [subDraftLabel, setSubDraftLabel] = useState<string>('');
  const [subDraftParent, setSubDraftParent] = useState<number>(1);
  const [subDraftBranchId, setSubDraftBranchId] = useState<string>('');
  const [subDraftFromId, setSubDraftFromId] = useState<string>('');
  const [subDraftToId, setSubDraftToId] = useState<string>('');
  const [subDraftBooster, setSubDraftBooster] = useState<boolean>(false);
  const [hoveredPumpKey, setHoveredPumpKey] = useState<string | null>(null);
  const [selectedBoosterPump, setSelectedBoosterPump] = useState<{
    target: RiserTarget;
    key: string;
    riserLabel: string;
  } | null>(null);
  const [boosterDraft, setBoosterDraft] = useState<string>('');
  const [isBoosterInputFocused, setIsBoosterInputFocused] = useState<boolean>(false);
  const [isHeaderEditorOpen, setIsHeaderEditorOpen] = useState<boolean>(false);
  const [isHeaderHovered, setIsHeaderHovered] = useState<boolean>(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const boosterInputRef = useRef<HTMLInputElement | null>(null);
  const prvInputRef = useRef<HTMLInputElement | null>(null);
  const headerSelectRef = useRef<HTMLSelectElement | null>(null);
  const addPrvBtnClickGuardRef = useRef<boolean>(false);
  const dragStateRef = useRef<DragState | null>(null);
  const selectedPrvRef = useRef<SelectedPrv | null>(null);
  const isPrvPopoverOpenRef = useRef<boolean>(false);
  const selectedTapNodeRef = useRef<SelectedTapNode | null>(null);

  useEffect(() => {
    selectedPrvRef.current = selectedPrv;
    isPrvPopoverOpenRef.current = isPrvPopoverOpen;
    selectedTapNodeRef.current = selectedTapNode;
  }, [selectedPrv, isPrvPopoverOpen, selectedTapNode]);

  const updateDragState = (next: DragState | null) => {
    dragStateRef.current = next;
    setDragState(next);
  };

  const isInteractive = Boolean(floors && onChangeFloors && onUpdateParameters);
  const useStickyHeader = stickyHeader ?? isInteractive;

  const nonRoofRows = useMemo(
    () => rows.filter((r) => r.input.supplyMode !== SupplyMode.ROOF_HEADER),
    [rows]
  );

  // Ordered columns: each Main Dropper followed immediately by its attached Sub-Droppers
  const orderedColumns = useMemo<OrderedRiserColumn[]>(() => {
    const cols: OrderedRiserColumn[] = [];
    let subColorCursor = 0;
    for (const d of dropperSummaries) {
      cols.push({
        kind: 'main',
        key: `main-${d.dropperIndex}`,
        target: { kind: 'main', dropperIndex: d.dropperIndex },
        dropperIndex: d.dropperIndex,
        shortLabel: `D${d.dropperIndex}`,
        color: DROPPER_COLORS[(d.dropperIndex - 1) % DROPPER_COLORS.length],
        summary: d,
      });
      const attached = subDropperSummaries.filter(
        (sd) => sd.parentDropperIndex === d.dropperIndex
      );
      for (const sd of attached) {
        cols.push({
          kind: 'sub',
          key: `sub-${sd.id}`,
          target: { kind: 'sub', subDropperId: sd.id },
          subDropperId: sd.id,
          parentDropperIndex: sd.parentDropperIndex,
          branchRowIdx: sd.branchRowIdx,
          shortLabel: sd.label,
          color: SUB_DROPPER_COLORS[subColorCursor % SUB_DROPPER_COLORS.length],
          summary: sd,
        });
        subColorCursor += 1;
      }
    }
    return cols;
  }, [dropperSummaries, subDropperSummaries]);

  const colIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    orderedColumns.forEach((c, idx) => map.set(c.key, idx));
    return map;
  }, [orderedColumns]);

  const formatTargetLabel = (target: RiserTarget): string => {
    if (target.kind === 'main') return `D${target.dropperIndex}`;
    return (
      subDropperSummaries.find((s) => s.id === target.subDropperId)?.label ??
      target.subDropperId
    );
  };

  const rowHeight = 28;
  const tankTopHeight = 104;
  const headerBusY = 47;
  const mainPumpY = 74;
  const svgTopOffset = useStickyHeader ? 0 : tankTopHeight;
  const bottomPad = 36;
  const totalSvgHeight = svgTopOffset + rows.length * rowHeight + bottomPad;

  const numDroppers = Math.max(1, dropperSummaries.length);
  const numColumns = Math.max(1, orderedColumns.length);
  const leftLabelWidth = 122;
  const dropperSpacing = Math.max(105, Math.min(165, Math.floor(680 / numColumns)));
  const canCreateNewRiser = isInteractive && numDroppers < 12;
  const rightMargin = canCreateNewRiser ? Math.max(148, dropperSpacing + 36) : 100;
  const schematicSvgWidth = Math.max(
    760,
    leftLabelWidth + numColumns * dropperSpacing + rightMargin
  );

  const columnX = (colIdx: number) => leftLabelWidth + colIdx * dropperSpacing + 56;
  const targetX = (target: RiserTarget) => {
    const idx = colIndexByKey.get(riserKey(target));
    if (idx !== undefined) return columnX(idx);
    return columnX(numColumns);
  };
  const rowY = (rIdx: number) => svgTopOffset + rIdx * rowHeight + rowHeight / 2;

  const getPrvYOffset = (
    target: RiserTarget,
    rowIdx: number,
    flowDirection?: 'up' | 'down' | 'junction'
  ) => {
    if (target.kind === 'main') {
      return rowIdx > 0 ? -rowHeight / 2 : 0;
    }
    if (flowDirection === 'up') return rowHeight / 2;
    if (flowDirection === 'down') return -rowHeight / 2;
    return 0;
  };

  const getCellForTarget = (rowIdx: number, target: RiserTarget) => {
    const row = rows[rowIdx];
    if (!row) return undefined;
    return target.kind === 'main'
      ? row.dropperCells[target.dropperIndex]
      : row.subDropperCells[target.subDropperId];
  };

  // Map valid floor rows per riser column for PRV placement / clamping
  const validPrvRowsByKey = useMemo(() => {
    const map = new Map<string, number[]>();
    orderedColumns.forEach((col) => {
      const validRows: number[] = [];
      rows.forEach((r, rIdx) => {
        if (r.input.supplyMode === SupplyMode.ROOF_HEADER) return;
        if (col.kind === 'main' && r.dropperCells[col.dropperIndex]) {
          validRows.push(rIdx);
        } else if (col.kind === 'sub' && r.subDropperCells[col.subDropperId]) {
          validRows.push(rIdx);
        }
      });
      map.set(col.key, validRows);
    });
    return map;
  }, [orderedColumns, rows]);

  // Keep selectedPrv synced if the PRV was removed or moved elsewhere
  useEffect(() => {
    if (!selectedPrv) {
      setIsPrvPopoverOpen(false);
      return;
    }
    const row = rows.find((r) => r.input.id === selectedPrv.floorId);
    const cell =
      selectedPrv.target.kind === 'main'
        ? row?.dropperCells[selectedPrv.target.dropperIndex]
        : row?.subDropperCells[selectedPrv.target.subDropperId];
    if (!cell?.hasPrv || !cell.prvDetail) {
      setSelectedPrv(null);
      setIsPrvPopoverOpen(false);
      return;
    }
    if (!isPrvInputFocused) {
      setPrvP2Draft(cell.prvDetail.downstreamPressureBar.toFixed(2));
    }
  }, [rows, selectedPrv, isPrvInputFocused]);

  // Auto-focus and select the P2 input whenever the inline PRV popover opens
  useEffect(() => {
    if (!isPrvPopoverOpen || !selectedPrv) return;
    const raf = requestAnimationFrame(() => {
      prvInputRef.current?.focus();
      prvInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [isPrvPopoverOpen, selectedPrv?.targetKey, selectedPrv?.floorId]);

  // Keep selectedBoosterPump synced if the pump was removed or global pressure changed
  useEffect(() => {
    if (!selectedBoosterPump) return;
    const summary =
      selectedBoosterPump.target.kind === 'main'
        ? dropperSummaries.find(
            (d) =>
              d.dropperIndex ===
              (selectedBoosterPump.target as { kind: 'main'; dropperIndex: number }).dropperIndex
          )
        : subDropperSummaries.find(
            (sd) =>
              sd.id ===
              (selectedBoosterPump.target as { kind: 'sub'; subDropperId: string }).subDropperId
          );
    if (!summary || !summary.hasBoosterPump) {
      setSelectedBoosterPump(null);
      return;
    }
    if (!isBoosterInputFocused) {
      const effectiveBar = summary.boosterPressureBar ?? parameters.boosterPumpBoostBar;
      setBoosterDraft(effectiveBar.toFixed(2));
    }
  }, [
    dropperSummaries,
    subDropperSummaries,
    selectedBoosterPump,
    isBoosterInputFocused,
    parameters.boosterPumpBoostBar,
  ]);

  // Auto-focus and select the booster pressure input whenever the booster popover opens
  useEffect(() => {
    if (!selectedBoosterPump) return;
    const raf = requestAnimationFrame(() => {
      boosterInputRef.current?.focus();
      boosterInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedBoosterPump?.key]);

  // Auto-focus the Pipe Header nominal size selector whenever the header editor opens
  useEffect(() => {
    if (!isHeaderEditorOpen) return;
    const raf = requestAnimationFrame(() => {
      headerSelectRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [isHeaderEditorOpen]);

  // Keep scroll state synced when row count or layout changes
  useEffect(() => {
    if (!useStickyHeader) {
      setIsScrolled(false);
      return;
    }
    const el = scrollContainerRef.current;
    setIsScrolled(Boolean(el && el.scrollTop > 4));
  }, [rows.length, useStickyHeader]);

  // Live hydraulic preview during drag or Add-PRV hover
  const livePreview = useMemo(() => {
    if (!floors) return null;

    if (dragState?.started) {
      if (dragState.kind === 'tapping') {
        if (
          !dragState.isNewMainRiser &&
          isSameRiser(dragState.targetTarget, dragState.sourceTarget)
        ) {
          return { kind: 'tapping' as const, changed: false as const };
        }
        const { nextFloors, nextParametersPatch } = reassignFloorTappingTarget(
          floors,
          parameters,
          result,
          dragState.floorId,
          dragState.targetTarget,
          dragState.sourceTarget
        );
        const previewResult = runHydraulicCalculations(nextFloors, {
          ...parameters,
          ...nextParametersPatch,
        });
        const movedRow = previewResult.rows.find((r) => r.input.id === dragState.floorId);
        if (dragState.targetTarget.kind === 'sub') {
          const sdId = dragState.targetTarget.subDropperId;
          const destSummary = previewResult.subDropperSummaries.find((s) => s.id === sdId);
          return {
            kind: 'tapping' as const,
            changed: true as const,
            targetLabel: destSummary?.label ?? sdId,
            totalZoneLu: destSummary?.totalZoneLu ?? 0,
            peakFlowRateLs: destSummary?.peakFlowRateLs ?? 0,
            nominalMm: destSummary?.baseNominalMm ?? null,
          };
        }
        const destDropperIdx = movedRow?.primaryDropperIndex ?? dragState.targetTarget.dropperIndex;
        const destSummary = previewResult.dropperSummaries.find(
          (d) => d.dropperIndex === destDropperIdx
        );
        return {
          kind: 'tapping' as const,
          changed: true as const,
          targetLabel: `D${destDropperIdx}`,
          totalZoneLu: destSummary?.totalZoneLu ?? 0,
          peakFlowRateLs: destSummary?.peakFlowRateLs ?? 0,
          nominalMm: destSummary?.headerNominalMm ?? null,
        };
      }

      if (dragState.kind === 'prv') {
        const nextFloors = repositionPrvStation(
          floors,
          result,
          dragState.sourceTarget,
          dragState.sourceFloorId,
          dragState.targetTarget,
          dragState.targetFloorId
        );
        const previewResult = runHydraulicCalculations(nextFloors, parameters);
        const targetRow = previewResult.rows[dragState.targetRowIdx];
        const targetCell =
          dragState.targetTarget.kind === 'main'
            ? targetRow?.dropperCells[dragState.targetTarget.dropperIndex]
            : targetRow?.subDropperCells[dragState.targetTarget.subDropperId];
        return {
          kind: 'prv' as const,
          prvDetail: targetCell?.prvDetail ?? null,
          changed:
            !isSameRiser(dragState.targetTarget, dragState.sourceTarget) ||
            dragState.targetRowIdx !== dragState.sourceRowIdx,
        };
      }

      if (dragState.kind === 'new-prv' && dragState.insideSvg) {
        const nextFloors = addPrvStation(
          floors,
          result,
          dragState.targetTarget,
          dragState.targetFloorId
        );
        const previewResult = runHydraulicCalculations(nextFloors, parameters);
        const targetRow = previewResult.rows[dragState.targetRowIdx];
        const targetCell =
          dragState.targetTarget.kind === 'main'
            ? targetRow?.dropperCells[dragState.targetTarget.dropperIndex]
            : targetRow?.subDropperCells[dragState.targetTarget.subDropperId];
        return {
          kind: 'new-prv' as const,
          prvDetail: targetCell?.prvDetail ?? null,
        };
      }

      if (dragState.kind === 'sub-branch') {
        if (dragState.targetBranchRowIdx === dragState.sourceBranchRowIdx) {
          return { kind: 'sub-branch' as const, changed: false as const };
        }
        const { nextFloors, nextParametersPatch, addedRowIndices } =
          relocateSubDropperBranchPoint(
            floors,
            parameters,
            result,
            dragState.subDropperId,
            dragState.targetBranchFloorId
          );
        const previewResult = runHydraulicCalculations(nextFloors, {
          ...parameters,
          ...nextParametersPatch,
        });
        const destSummary = previewResult.subDropperSummaries.find(
          (s) => s.id === dragState.subDropperId
        );
        const evalRows: number[] = [];
        previewResult.rows.forEach((r, idx) => {
          if (r.subDropperCells[dragState.subDropperId]) evalRows.push(idx);
        });
        return {
          kind: 'sub-branch' as const,
          changed: true as const,
          subDropperLabel: dragState.subDropperLabel,
          addedFloorLabels: addedRowIndices
            .map((idx) => rows[idx]?.input.floorLabel)
            .filter((lbl): lbl is string => Boolean(lbl)),
          addedRowIndices,
          servedFloorRange: destSummary?.servedFloorRange ?? '',
          totalZoneLu: destSummary?.totalZoneLu ?? 0,
          peakFlowRateLs: destSummary?.peakFlowRateLs ?? 0,
          baseNominalMm: destSummary?.baseNominalMm ?? null,
          terminalNominalMm: destSummary?.terminalNominalMm ?? null,
          minEvalRow: evalRows[0] ?? dragState.targetBranchRowIdx,
          maxEvalRow:
            evalRows[evalRows.length - 1] ?? dragState.targetBranchRowIdx,
        };
      }
    }

    if (isAddPrvMode && hoveredSegment) {
      const hoverRow = rows[hoveredSegment.rowIdx];
      const hoverCell = getCellForTarget(hoveredSegment.rowIdx, hoveredSegment.target);
      if (hoverRow && hoverCell && !hoverCell.hasPrv) {
        const nextFloors = addPrvStation(
          floors,
          result,
          hoveredSegment.target,
          hoverRow.input.id
        );
        const previewResult = runHydraulicCalculations(nextFloors, parameters);
        const targetRow = previewResult.rows[hoveredSegment.rowIdx];
        const targetCell =
          hoveredSegment.target.kind === 'main'
            ? targetRow?.dropperCells[hoveredSegment.target.dropperIndex]
            : targetRow?.subDropperCells[hoveredSegment.target.subDropperId];
        return {
          kind: 'hover-add-prv' as const,
          riserLabel: formatTargetLabel(hoveredSegment.target),
          floorLabel: hoverRow.input.floorLabel,
          prvDetail: targetCell?.prvDetail ?? null,
        };
      }
    }

    return null;
  }, [dragState, floors, hoveredSegment, isAddPrvMode, parameters, result, rows]);

  const handleAddPrv = (target: RiserTarget, floorId: string) => {
    if (!floors || !onChangeFloors) return;
    const nextFloors = addPrvStation(floors, result, target, floorId);
    onChangeFloors(nextFloors);
    const floorLabel = rows.find((r) => r.input.id === floorId)?.input.floorLabel ?? '';
    setSelectedPrv({
      target,
      targetKey: riserKey(target),
      riserLabel: formatTargetLabel(target),
      floorId,
      floorLabel,
    });
    setContextMenu(null);
  };

  const handleDeletePrv = (target: RiserTarget, floorId: string) => {
    if (!floors || !onChangeFloors) return;
    const nextFloors = removePrvStation(floors, result, target, floorId);
    onChangeFloors(nextFloors);
    if (
      selectedPrv &&
      selectedPrv.targetKey === riserKey(target) &&
      selectedPrv.floorId === floorId
    ) {
      setSelectedPrv(null);
      setIsPrvPopoverOpen(false);
    }
    setContextMenu(null);
  };

  const handleSetPrvPressure = (
    target: RiserTarget,
    floorId: string,
    downstreamPressureBar: number | null
  ) => {
    if (!floors || !onChangeFloors) return;
    const nextFloors = setPrvStationSetPressure(
      floors,
      result,
      target,
      floorId,
      downstreamPressureBar
    );
    onChangeFloors(nextFloors);
  };

  const handleToggleBoosterPump = (target: RiserTarget, forceEnabled?: boolean) => {
    if (!onUpdateParameters) return;
    const patch = toggleRiserBoosterPump(parameters, result, target, forceEnabled);
    if (Object.keys(patch).length > 0) {
      onUpdateParameters(patch);
    }
    setContextMenu(null);
  };

  const handleSetBoosterPressure = (target: RiserTarget, pressureBar: number | null) => {
    if (!onUpdateParameters) return;
    const patch = setRiserBoosterPressure(parameters, target, pressureBar);
    if (Object.keys(patch).length > 0) {
      onUpdateParameters(patch);
    }
  };

  const openBoosterEditor = (target: RiserTarget, riserLabel: string) => {
    const key = target.kind === 'main' ? `main-${target.dropperIndex}` : `sub-${target.subDropperId}`;
    const summary =
      target.kind === 'main'
        ? dropperSummaries.find((d) => d.dropperIndex === target.dropperIndex)
        : subDropperSummaries.find((sd) => sd.id === target.subDropperId);
    const effectiveBar = summary?.boosterPressureBar ?? parameters.boosterPumpBoostBar;
    setSelectedPrv(null);
    setIsPrvPopoverOpen(false);
    setSelectedTapNode(null);
    setIsHeaderEditorOpen(false);
    setContextMenu(null);
    setBoosterDraft(effectiveBar.toFixed(2));
    setSelectedBoosterPump({ target, key, riserLabel });
  };

  const openPipeHeaderEditor = () => {
    if (!isInteractive) return;
    setSelectedPrv(null);
    setIsPrvPopoverOpen(false);
    setSelectedTapNode(null);
    setSelectedBoosterPump(null);
    setContextMenu(null);
    setIsHeaderEditorOpen((prev) => !prev);
  };

  const handleSelectPipeHeaderSize = (encodedValue: string) => {
    if (!onUpdateParameters) return;
    if (encodedValue === 'AUTO') {
      onUpdateParameters({ pipeHeaderCustomSize: null });
      return;
    }
    const sepIdx = encodedValue.indexOf(':');
    if (sepIdx <= 0) return;
    const specId = encodedValue.slice(0, sepIdx) as PipeSpecId;
    const nominalSize = Number(encodedValue.slice(sepIdx + 1));
    if (!Number.isFinite(nominalSize) || nominalSize <= 0) return;
    onUpdateParameters({
      pipeHeaderCustomSize: {
        specId,
        nominalSize,
      },
    });
  };

  const openSubCreator = (presetParent?: number, presetBranchFloorId?: string) => {
    const existing = parameters.subDroppers ?? [];
    let nextNum = existing.length + 1;
    const labels = new Set(existing.map((s) => s.label.toUpperCase()));
    while (labels.has(`SD${nextNum}`)) nextNum += 1;

    const defaultParent =
      presetParent ??
      (dropperSummaries.length > 0
        ? dropperSummaries[dropperSummaries.length - 1].dropperIndex
        : 1);
    const fallbackFloor =
      presetBranchFloorId ??
      nonRoofRows[nonRoofRows.length - 1]?.input.id ??
      '';

    setSubDraftLabel(`SD${nextNum}`);
    setSubDraftParent(defaultParent);
    setSubDraftBranchId(fallbackFloor);
    setSubDraftFromId(fallbackFloor);
    setSubDraftToId(fallbackFloor);
    setSubDraftBooster(false);
    setIsSubCreatorOpen(true);
    setIsAddPrvMode(false);
    setContextMenu(null);
  };

  const handleCreateSubDropper = () => {
    if (!floors || !onChangeFloors || !onUpdateParameters || !subDraftBranchId) return;
    const idxA = floors.findIndex((f) => f.id === (subDraftFromId || subDraftBranchId));
    const idxB = floors.findIndex((f) => f.id === (subDraftToId || subDraftBranchId));
    const minI = idxA >= 0 && idxB >= 0 ? Math.min(idxA, idxB) : -1;
    const maxI = idxA >= 0 && idxB >= 0 ? Math.max(idxA, idxB) : -1;
    const servedFloorIds =
      minI >= 0
        ? floors
            .slice(minI, maxI + 1)
            .filter((f) => f.supplyMode !== SupplyMode.ROOF_HEADER)
            .map((f) => f.id)
        : [subDraftBranchId];

    const parentZone = dropperSummaries.find(
      (d) => d.dropperIndex === subDraftParent
    )?.zoneType;

    const { nextParametersPatch, nextFloors } = addSubDropperConfig(parameters, floors, {
      label: subDraftLabel,
      parentDropperIndex: subDraftParent,
      branchFloorId: subDraftBranchId,
      servedFloorIds,
      hasBoosterPump: subDraftBooster,
    });

    const syncedFloors = parentZone
      ? nextFloors.map((f) =>
          servedFloorIds.includes(f.id)
            ? {
                ...f,
                supplyMode:
                  parentZone === 'Booster' ? SupplyMode.BOOSTER : SupplyMode.GRAVITY,
              }
            : f
        )
      : nextFloors;

    onUpdateParameters(nextParametersPatch);
    onChangeFloors(syncedFloors);
    setIsSubCreatorOpen(false);
  };

  // Keyboard shortcuts: Delete/Backspace removes selected PRV; Escape clears mode/selection/menu
  useEffect(() => {
    if (!isInteractive) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const isEditingInput =
        targetEl &&
        (targetEl.tagName === 'INPUT' ||
          targetEl.tagName === 'TEXTAREA' ||
          targetEl.tagName === 'SELECT' ||
          targetEl.isContentEditable);

      if (e.key === 'Escape') {
        setContextMenu(null);
        setIsAddPrvMode(false);
        setIsSubCreatorOpen(false);
        setSelectedTapNode(null);
        setSelectedBoosterPump(null);
        setIsHeaderEditorOpen(false);
        updateDragState(null);
        if (isPrvPopoverOpen) {
          setIsPrvPopoverOpen(false);
        } else {
          setSelectedPrv(null);
        }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPrv && !isEditingInput) {
        e.preventDefault();
        handleDeletePrv(selectedPrv.target, selectedPrv.floorId);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isInteractive, selectedPrv, floors, result]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [contextMenu]);

  // Window pointer tracking while dragging (tapping point, existing PRV, or toolbar new PRV)
  useEffect(() => {
    if (!dragState) return;

    const getSvgCoords = (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const inside =
        clientX >= rect.left - 16 &&
        clientX <= rect.right + 16 &&
        clientY >= rect.top - 16 &&
        clientY <= rect.bottom + 16;
      return {
        x: ((clientX - rect.left) / rect.width) * schematicSvgWidth,
        y: ((clientY - rect.top) / rect.height) * totalSvgHeight,
        inside,
      };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const prev = dragStateRef.current;
      if (!prev) return;
      const dist = Math.hypot(
        e.clientX - prev.startClientX,
        e.clientY - prev.startClientY
      );
      const coords = getSvgCoords(e.clientX, e.clientY);
      if (!coords) return;

      const started = prev.started || dist >= 4;

      if (prev.kind === 'tapping') {
        let bestTarget: RiserTarget = prev.sourceTarget;
        let bestIsNew = false;
        let bestDist = Infinity;

        orderedColumns.forEach((col, colIdx) => {
          const dx = Math.abs(coords.x - columnX(colIdx));
          if (dx < bestDist) {
            bestDist = dx;
            bestTarget = col.target;
            bestIsNew = false;
          }
        });

        if (canCreateNewRiser) {
          const newMainX = columnX(numColumns);
          const dxNew = Math.abs(coords.x - newMainX);
          if (dxNew < bestDist) {
            bestDist = dxNew;
            bestTarget = { kind: 'main', dropperIndex: numDroppers + 1 };
            bestIsNew = true;
          }
        }

        const maxX = canCreateNewRiser ? columnX(numColumns) + 24 : columnX(numColumns - 1) + 24;
        const clampedX = Math.max(columnX(0) - 24, Math.min(maxX, coords.x));
        updateDragState({
          ...prev,
          started,
          pointerX: clampedX,
          targetTarget: bestTarget,
          isNewMainRiser: bestIsNew,
        });
        return;
      }

      if (prev.kind === 'sub-branch') {
        let bestRowIdx = -1;
        let bestYDist = Infinity;
        let firstNonRoofIdx = -1;
        let lastNonRoofIdx = -1;

        rows.forEach((r, rIdx) => {
          if (r.input.supplyMode === SupplyMode.ROOF_HEADER) return;
          if (firstNonRoofIdx < 0) firstNonRoofIdx = rIdx;
          lastNonRoofIdx = rIdx;
          const dy = Math.abs(coords.y - rowY(rIdx));
          if (dy < bestYDist) {
            bestYDist = dy;
            bestRowIdx = rIdx;
          }
        });

        if (bestRowIdx < 0) return;
        const targetRow = rows[bestRowIdx];
        const minY = rowY(firstNonRoofIdx);
        const maxY = rowY(lastNonRoofIdx);
        const clampedY = Math.max(minY, Math.min(maxY, coords.y));

        updateDragState({
          ...prev,
          started,
          pointerY: clampedY,
          targetBranchRowIdx: bestRowIdx,
          targetBranchFloorId: targetRow.input.id,
          targetBranchFloorLabel: targetRow.input.floorLabel,
        });
        return;
      }

      // PRV or New-PRV 2D dragging (vertical + horizontal across Main & Sub droppers)
      let bestCol = orderedColumns[0];
      let bestXDist = Infinity;
      orderedColumns.forEach((col, colIdx) => {
        const dx = Math.abs(coords.x - columnX(colIdx));
        if (dx < bestXDist) {
          bestXDist = dx;
          bestCol = col;
        }
      });

      const bestTarget = bestCol ? bestCol.target : prev.targetTarget;
      const validRows = validPrvRowsByKey.get(riserKey(bestTarget)) ?? [];
      let bestRowIdx = validRows.includes(prev.targetRowIdx)
        ? prev.targetRowIdx
        : validRows[0] ?? prev.targetRowIdx;
      let bestYDist = Infinity;
      for (const rIdx of validRows) {
        const rCell =
          bestTarget.kind === 'main'
            ? rows[rIdx]?.dropperCells[bestTarget.dropperIndex]
            : rows[rIdx]?.subDropperCells[bestTarget.subDropperId];
        const flowDir =
          bestTarget.kind === 'sub' && rCell && 'flowDirection' in rCell
            ? rCell.flowDirection
            : undefined;
        const prvCenterY = rowY(rIdx) + getPrvYOffset(bestTarget, rIdx, flowDir);
        const dy = Math.abs(coords.y - prvCenterY);
        if (dy < bestYDist) {
          bestYDist = dy;
          bestRowIdx = rIdx;
        }
      }

      const targetRow = rows[bestRowIdx];
      const clampedX = Math.max(
        columnX(0) - 30,
        Math.min(columnX(numColumns - 1) + 40, coords.x)
      );
      const clampedY = Math.max(
        svgTopOffset,
        Math.min(totalSvgHeight - bottomPad, coords.y)
      );

      if (prev.kind === 'new-prv') {
        updateDragState({
          ...prev,
          started,
          insideSvg: coords.inside,
          pointerX: clampedX,
          pointerY: clampedY,
          targetTarget: bestTarget,
          targetRowIdx: bestRowIdx,
          targetFloorId: targetRow ? targetRow.input.id : prev.targetFloorId,
          targetFloorLabel: targetRow ? targetRow.input.floorLabel : prev.targetFloorLabel,
        });
        return;
      }

      updateDragState({
        ...prev,
        started,
        pointerX: clampedX,
        pointerY: clampedY,
        targetTarget: bestTarget,
        targetRowIdx: bestRowIdx,
        targetFloorId: targetRow ? targetRow.input.id : prev.targetFloorId,
        targetFloorLabel: targetRow ? targetRow.input.floorLabel : prev.targetFloorLabel,
      });
    };

    const handlePointerUp = () => {
      const current = dragStateRef.current;
      if (!current) return;
      updateDragState(null);

      if (!current.started) {
        if (current.kind === 'tapping') {
          const srcKey = riserKey(current.sourceTarget);
          const prevTap = selectedTapNodeRef.current;
          if (
            prevTap &&
            prevTap.floorId === current.floorId &&
            prevTap.targetKey === srcKey
          ) {
            setSelectedTapNode(null);
          } else {
            setSelectedPrv(null);
            setIsPrvPopoverOpen(false);
            setSelectedBoosterPump(null);
            setIsHeaderEditorOpen(false);
            setSelectedTapNode({
              target: current.sourceTarget,
              targetKey: srcKey,
              riserLabel: formatTargetLabel(current.sourceTarget),
              floorId: current.floorId,
              floorLabel: current.floorLabel,
            });
          }
          return;
        }
        if (current.kind === 'prv') {
          const srcKey = riserKey(current.sourceTarget);
          const currentSelected = selectedPrvRef.current;
          const isSameSelected =
            currentSelected &&
            currentSelected.targetKey === srcKey &&
            currentSelected.floorId === current.sourceFloorId;
          setSelectedTapNode(null);
          setSelectedBoosterPump(null);
          setIsHeaderEditorOpen(false);
          if (isSameSelected && isPrvPopoverOpenRef.current) {
            setIsPrvPopoverOpen(false);
            setSelectedPrv(null);
          } else {
            const rowObj = rows.find((r) => r.input.id === current.sourceFloorId);
            const clickedCell =
              current.sourceTarget.kind === 'main'
                ? rowObj?.dropperCells[current.sourceTarget.dropperIndex]
                : rowObj?.subDropperCells[current.sourceTarget.subDropperId];
            if (clickedCell?.prvDetail) {
              setPrvP2Draft(clickedCell.prvDetail.downstreamPressureBar.toFixed(2));
            }
            setSelectedPrv({
              target: current.sourceTarget,
              targetKey: srcKey,
              riserLabel: formatTargetLabel(current.sourceTarget),
              floorId: current.sourceFloorId,
              floorLabel: current.sourceFloorLabel,
            });
            setIsPrvPopoverOpen(true);
          }
        }
        return;
      }

      if (!floors || !onChangeFloors) return;

      if (current.kind === 'tapping') {
        if (
          current.isNewMainRiser ||
          !isSameRiser(current.targetTarget, current.sourceTarget)
        ) {
          const { nextFloors, nextParametersPatch } = reassignFloorTappingTarget(
            floors,
            parameters,
            result,
            current.floorId,
            current.targetTarget,
            current.sourceTarget
          );
          onChangeFloors(nextFloors);
          if (onUpdateParameters && Object.keys(nextParametersPatch).length > 0) {
            onUpdateParameters(nextParametersPatch);
          }
        }
      } else if (current.kind === 'sub-branch') {
        if (current.targetBranchFloorId !== current.sourceBranchFloorId) {
          const { nextFloors, nextParametersPatch } = relocateSubDropperBranchPoint(
            floors,
            parameters,
            result,
            current.subDropperId,
            current.targetBranchFloorId
          );
          onChangeFloors(nextFloors);
          if (onUpdateParameters && Object.keys(nextParametersPatch).length > 0) {
            onUpdateParameters(nextParametersPatch);
          }
        }
      } else if (current.kind === 'prv') {
        if (
          !isSameRiser(current.targetTarget, current.sourceTarget) ||
          current.targetRowIdx !== current.sourceRowIdx
        ) {
          const nextFloors = repositionPrvStation(
            floors,
            result,
            current.sourceTarget,
            current.sourceFloorId,
            current.targetTarget,
            current.targetFloorId
          );
          onChangeFloors(nextFloors);
          setSelectedPrv({
            target: current.targetTarget,
            targetKey: riserKey(current.targetTarget),
            riserLabel: formatTargetLabel(current.targetTarget),
            floorId: current.targetFloorId,
            floorLabel: current.targetFloorLabel,
          });
        }
      } else if (current.kind === 'new-prv') {
        addPrvBtnClickGuardRef.current = true;
        setTimeout(() => {
          addPrvBtnClickGuardRef.current = false;
        }, 80);

        if (current.insideSvg && current.targetFloorId) {
          const nextFloors = addPrvStation(
            floors,
            result,
            current.targetTarget,
            current.targetFloorId
          );
          onChangeFloors(nextFloors);
          setSelectedPrv({
            target: current.targetTarget,
            targetKey: riserKey(current.targetTarget),
            riserLabel: formatTargetLabel(current.targetTarget),
            floorId: current.targetFloorId,
            floorLabel: current.targetFloorLabel,
          });
          setIsAddPrvMode(false);
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    canCreateNewRiser,
    dragState !== null,
    floors,
    numColumns,
    numDroppers,
    onChangeFloors,
    onUpdateParameters,
    orderedColumns,
    parameters,
    result,
    rows,
    schematicSvgWidth,
    svgTopOffset,
    totalSvgHeight,
    useStickyHeader,
    validPrvRowsByKey,
  ]);

  const hasManualPrvOverrides = useMemo(
    () =>
      Boolean(
        floors?.some(
          (f) =>
            f.prvOverride !== PrvOverrideMode.AUTO ||
            (f.dropperPrvOverrides && Object.keys(f.dropperPrvOverrides).length > 0) ||
            (f.dropperPrvSetPressures && Object.keys(f.dropperPrvSetPressures).length > 0) ||
            (f.subDropperPrvOverrides && Object.keys(f.subDropperPrvOverrides).length > 0) ||
            (f.subDropperPrvSetPressures && Object.keys(f.subDropperPrvSetPressures).length > 0)
        )
      ),
    [floors]
  );

  const lastMainColIdx = useMemo(() => {
    let idx = 0;
    orderedColumns.forEach((c, i) => {
      if (c.kind === 'main') idx = i;
    });
    return idx;
  }, [orderedColumns]);

  if (rows.length === 0) {
    return (
      <div className="bg-white p-10 text-center text-xs text-[#666666]">
        Add building floors in the Floor Data view to generate the vertical riser schematic.
      </div>
    );
  }

  const inspectedRow =
    hoveredRowIdx !== null
      ? rows[hoveredRowIdx]
      : rows[Math.min(rows.length - 1, Math.floor(rows.length / 2))];

  const selectedPrvCell = selectedPrv
    ? (() => {
        const rowObj = rows.find((r) => r.input.id === selectedPrv.floorId);
        return selectedPrv.target.kind === 'main'
          ? rowObj?.dropperCells[selectedPrv.target.dropperIndex]
          : rowObj?.subDropperCells[selectedPrv.target.subDropperId];
      })()
    : null;

  const startTappingDrag = (
    e: React.PointerEvent,
    floorId: string,
    floorLabel: string,
    rowIdx: number,
    sourceTarget: RiserTarget,
    loadingUnits: number,
    isSplitLeg: boolean
  ) => {
    if (!isInteractive || e.button !== 0 || isAddPrvMode) return;
    e.stopPropagation();
    e.preventDefault();
    setContextMenu(null);
    updateDragState({
      kind: 'tapping',
      floorId,
      floorLabel,
      rowIdx,
      sourceTarget,
      targetTarget: sourceTarget,
      isNewMainRiser: false,
      pointerX: targetX(sourceTarget) + 19,
      loadingUnits,
      isSplitLeg,
      started: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
    });
  };

  const startPrvDrag = (
    e: React.PointerEvent,
    floorId: string,
    floorLabel: string,
    rowIdx: number,
    sourceTarget: RiserTarget,
    yOffset: number
  ) => {
    if (!isInteractive || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setContextMenu(null);
    updateDragState({
      kind: 'prv',
      sourceFloorId: floorId,
      sourceFloorLabel: floorLabel,
      sourceRowIdx: rowIdx,
      sourceTarget,
      targetRowIdx: rowIdx,
      targetFloorId: floorId,
      targetFloorLabel: floorLabel,
      targetTarget: sourceTarget,
      pointerX: targetX(sourceTarget),
      pointerY: rowY(rowIdx) + yOffset,
      started: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
    });
  };

  const startNewPrvToolbarDrag = (e: React.PointerEvent) => {
    if (!isInteractive || e.button !== 0) return;
    setContextMenu(null);
    const defaultCol = orderedColumns[0];
    if (!defaultCol) return;
    const validRows = validPrvRowsByKey.get(defaultCol.key) ?? [];
    const defaultRowIdx = validRows[0] ?? 0;
    const defaultRow = rows[defaultRowIdx];
    if (!defaultRow) return;

    updateDragState({
      kind: 'new-prv',
      targetTarget: defaultCol.target,
      targetRowIdx: defaultRowIdx,
      targetFloorId: defaultRow.input.id,
      targetFloorLabel: defaultRow.input.floorLabel,
      pointerX: targetX(defaultCol.target),
      pointerY: rowY(defaultRowIdx),
      insideSvg: false,
      started: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
    });
  };

  const startSubBranchDrag = (
    e: React.PointerEvent,
    sd: SubDropperSummary
  ) => {
    if (!isInteractive || e.button !== 0 || isAddPrvMode) return;
    e.stopPropagation();
    e.preventDefault();
    setContextMenu(null);
    updateDragState({
      kind: 'sub-branch',
      subDropperId: sd.id,
      subDropperLabel: sd.label,
      parentDropperIndex: sd.parentDropperIndex,
      sourceBranchRowIdx: sd.branchRowIdx,
      sourceBranchFloorId: sd.branchFloorId,
      sourceBranchFloorLabel: sd.branchFloorLabel,
      targetBranchRowIdx: sd.branchRowIdx,
      targetBranchFloorId: sd.branchFloorId,
      targetBranchFloorLabel: sd.branchFloorLabel,
      pointerY: rowY(sd.branchRowIdx),
      started: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
    });
  };

  const openSegmentContextMenu = (
    e: React.MouseEvent,
    target: RiserTarget,
    floorId: string,
    floorLabel: string,
    hasPrv: boolean,
    isServed: boolean
  ) => {
    if (!isInteractive) return;
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 276;
    const menuHeight = (target.kind === 'main' ? 124 : 84) + (!isServed ? 40 : 0);
    const clampedX = Math.min(window.innerWidth - menuWidth - 12, e.clientX);
    const clampedY = Math.min(window.innerHeight - menuHeight - 12, e.clientY);
    setContextMenu({
      clientX: Math.max(8, clampedX),
      clientY: Math.max(8, clampedY),
      target,
      riserLabel: formatTargetLabel(target),
      floorId,
      floorLabel,
      hasPrv,
      isServed,
    });
  };

  /**
   * Renders a full solid dot (●) for single-riser full floor tap-offs,
   * or a crisp half-filled dot (◐) for multi-riser split/fractional floor tap-offs.
   */
  const renderTappingDot = (
    cx: number,
    cy: number,
    dotColor: string,
    isSplitLoad: boolean
  ) => {
    if (isSplitLoad) {
      const r = isInteractive ? 4.6 : 3.2;
      return (
        <g data-tap-dot="split">
          {isInteractive && <circle cx={cx} cy={cy} r={r + 1.3} fill="#ffffff" />}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="#ffffff"
            stroke={dotColor}
            strokeWidth={isInteractive ? 1.5 : 1.2}
          />
          <path
            d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`}
            fill={dotColor}
          />
        </g>
      );
    }
    return (
      <circle
        data-tap-dot="full"
        cx={cx}
        cy={cy}
        r={isInteractive ? 4.2 : 2.5}
        fill={dotColor}
        stroke={isInteractive ? '#ffffff' : 'none'}
        strokeWidth={isInteractive ? 1.4 : 0}
      />
    );
  };

  const getPipeHeaderGeometry = () => {
    const tankX = 10;
    const tankY = 8;
    const tankWidth = 136;
    const tankHeight = 46;
    const tankRight = tankX + tankWidth;
    const hasMainDroppers = orderedColumns.some((c) => c.kind === 'main');
    const lastMainX = hasMainDroppers ? columnX(lastMainColIdx) : tankRight + 86;
    const headerEndX = Math.max(tankRight + 32, lastMainX + 10);
    const headerSpan = headerEndX - tankRight;
    const canCenterLabel = headerSpan >= 240;
    const rawCenterX = (tankRight + headerEndX) / 2;
    const labelX = canCenterLabel
      ? Math.max(tankRight + 132, Math.min(schematicSvgWidth - 132, rawCenterX))
      : tankRight + 16;
    const labelAnchor: 'middle' | 'start' = canCenterLabel ? 'middle' : 'start';
    return {
      tankX,
      tankY,
      tankWidth,
      tankHeight,
      tankRight,
      headerEndX,
      headerSpan,
      canCenterLabel,
      labelX,
      labelAnchor,
    };
  };

  const renderPipeHeaderPopover = (isStickyContext: boolean) => {
    if (!isInteractive || !isHeaderEditorOpen || dragState?.started) return null;

    const { tankRight, headerEndX, labelX } = getPipeHeaderGeometry();
    const headerSpec = PIPE_SPEC_TABLES[pipeHeader.specId] ?? pipeSpec;
    const autoSpec = PIPE_SPEC_TABLES[pipeHeader.autoSpecId] ?? pipeSpec;
    const anchorX = Math.max(tankRight + 40, Math.min(headerEndX - 10, labelX));
    const leftPct = (anchorX / schematicSvgWidth) * 100;
    const placeLeft = leftPct > 64;
    const placeRightEdge = leftPct < 24;
    const translateX = placeRightEdge
      ? '0%'
      : placeLeft
      ? 'calc(-100% + 24px)'
      : '-50%';

    const primaryValidSizes = getAvailablePipeSizes(
      pipeSpec,
      result.parameters.excludedPipeSizes
    );
    const optionalValidSizes =
      optionalPipeSpec && optionalPipeSpec.id !== pipeSpec.id
        ? getAvailablePipeSizes(optionalPipeSpec, result.parameters.excludedPipeSizes)
        : [];

    const currentSelectValue = pipeHeader.isCustomSize && pipeHeader.nominalMm !== null
      ? `${pipeHeader.specId}:${pipeHeader.nominalMm}`
      : 'AUTO';

    const autoSizeSummary = pipeHeader.autoNominalMm
      ? `${
          pipeHeader.autoIsFallbackMaterial
            ? `${getPipeSpecBadgeLabel(pipeHeader.autoSpecId)} `
            : ''
        }Ø${pipeHeader.autoNominalMm} mm${
          pipeHeader.autoVelocityMs !== null
            ? ` (${pipeHeader.autoVelocityMs.toFixed(2)} m/s)`
            : ''
        }`
      : '—';

    return (
      <div
        role="dialog"
        aria-label="Edit Pipe Header Nominal Size"
        data-testid="pipe-header-popover"
        className="absolute z-40 w-[296px] bg-white border-2 border-[#121212] shadow-[4px_4px_0_0_rgba(18,18,18,0.14)] p-2.5 text-xs"
        style={
          isStickyContext
            ? {
                left: `${leftPct}%`,
                top: '56px',
                transform: `translateX(${translateX})`,
              }
            : {
                left: `${leftPct}%`,
                top: `${((headerBusY + 10) / totalSvgHeight) * 100}%`,
                transform: `translateX(${translateX})`,
              }
        }
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-[#e0e0e0]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212] truncate">
              Pipe Header Size
            </span>
            {pipeHeader.isCustomSize ? (
              <span className="px-1 py-0.5 bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] font-mono text-[9px] font-bold uppercase leading-none shrink-0">
                Custom
              </span>
            ) : (
              <span className="px-1 py-0.5 bg-[#f4f4f5] border border-[#cccccc] text-[#555555] font-mono text-[9px] font-bold uppercase leading-none shrink-0">
                Auto
              </span>
            )}
            {pipeHeader.exceedsMaxCapacity && (
              <span className="px-1 py-0.5 bg-[#fef2f2] border border-[#dc2626] text-[#dc2626] font-mono text-[9px] font-bold uppercase leading-none shrink-0">
                &gt; Limit
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsHeaderEditorOpen(false)}
            aria-label="Close pipe header size editor"
            className="h-5 w-5 inline-flex items-center justify-center text-[#555555] hover:text-[#121212]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mb-2 font-mono tabular-nums text-[10px] bg-[#f8f8f8] border border-[#e0e0e0] px-2 py-1.5">
          <div>
            <span className="text-[#666666] block text-[9px] uppercase">Flow / Load</span>
            <span className="font-semibold text-[#121212]">
              {pipeHeader.flowRateLs.toFixed(2)} L/s · {Math.round(pipeHeader.totalLu)} LU
            </span>
          </div>
          <div className="text-right">
            <span className="text-[#666666] block text-[9px] uppercase">
              Velocity (≤ {pipeHeader.maxVelocityMs.toFixed(1)})
            </span>
            <span
              data-testid="pipe-header-popover-velocity"
              className={`font-semibold ${
                pipeHeader.exceedsMaxCapacity
                  ? 'text-[#d90000]'
                  : pipeHeader.flowRateLs > 0
                  ? 'text-[#15803d]'
                  : 'text-[#121212]'
              }`}
            >
              {pipeHeader.velocityMs !== null ? `${pipeHeader.velocityMs.toFixed(2)} m/s` : '—'}
            </span>
          </div>
          <div>
            <span className="text-[#666666] block text-[9px] uppercase">Active Internal di</span>
            <span className="font-semibold text-[#121212]">
              {pipeHeader.innerMm !== null
                ? `${formatPipeDim(pipeHeader.innerMm, headerSpec)} mm`
                : '—'}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[#666666] block text-[9px] uppercase">
              Req. di (Vmax − 0.5)
            </span>
            <span className="font-semibold text-[#121212]">
              {pipeHeader.requiredInnerDiaMm !== null
                ? `≥ ${pipeHeader.requiredInnerDiaMm.toFixed(1)} mm`
                : '—'}
            </span>
          </div>
        </div>

        <div
          data-testid="pipe-header-popover-status"
          className={`mb-2 px-2 py-1 border font-mono text-[10px] leading-snug ${
            pipeHeader.exceedsMaxCapacity
              ? 'bg-[#fef2f2] border-[#fca5a5] text-[#b91c1c]'
              : 'bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]'
          }`}
        >
          {pipeHeader.exceedsMaxCapacity ? (
            <>
              Exceeds header velocity limit ({pipeHeader.velocityMs?.toFixed(2)} &gt;{' '}
              {pipeHeader.maxVelocityMs.toFixed(1)} m/s; Global{' '}
              {parameters.maxVelocityMs.toFixed(1)} − 0.5 m/s)
            </>
          ) : (
            <>
              Compliant: V ≤ {pipeHeader.maxVelocityMs.toFixed(1)} m/s (Global{' '}
              {parameters.maxVelocityMs.toFixed(1)} − 0.5 m/s)
            </>
          )}
        </div>

        <label
          htmlFor="pipe-header-size-select"
          className="block font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] mb-1"
        >
          Nominal Pipe Size ({getPipeSpecBadgeLabel(pipeSpec.id)}
          {optionalPipeSpec && optionalPipeSpec.id !== pipeSpec.id
            ? ` / ${getPipeSpecBadgeLabel(optionalPipeSpec.id)}`
            : ''}
          )
        </label>
        <select
          ref={headerSelectRef}
          id="pipe-header-size-select"
          data-testid="pipe-header-size-select"
          value={currentSelectValue}
          onChange={(e) => handleSelectPipeHeaderSize(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setIsHeaderEditorOpen(false);
            }
          }}
          className="w-full h-7 px-2 text-xs font-mono tabular-nums bg-white border border-[#121212] text-[#121212] focus:outline-none"
        >
          <option value="AUTO">Auto-Sized — {autoSizeSummary}</option>
          <optgroup label={`Primary: ${pipeSpec.fullName}`}>
            {primaryValidSizes.map((entry) => {
              const vel =
                pipeHeader.flowRateLs > 0
                  ? calculateVelocityMs(pipeHeader.flowRateLs, entry.innerDiameter)
                  : 0;
              const overLimit =
                pipeHeader.flowRateLs > 0 && vel > pipeHeader.maxVelocityMs + 1e-9;
              const isAutoChoice =
                !pipeHeader.autoIsFallbackMaterial &&
                pipeHeader.autoNominalMm === entry.nominalSize;
              return (
                <option
                  key={`${pipeSpec.id}:${entry.nominalSize}`}
                  value={`${pipeSpec.id}:${entry.nominalSize}`}
                >
                  Ø{entry.nominalSize} mm · di {formatPipeDim(entry.innerDiameter, pipeSpec)} ·{' '}
                  {vel.toFixed(2)} m/s{overLimit ? ' [> Limit]' : ' [OK]'}
                  {isAutoChoice ? ' ★' : ''}
                </option>
              );
            })}
          </optgroup>
          {optionalPipeSpec && optionalValidSizes.length > 0 && (
            <optgroup label={`Optional: ${optionalPipeSpec.fullName}`}>
              {optionalValidSizes.map((entry) => {
                const vel =
                  pipeHeader.flowRateLs > 0
                    ? calculateVelocityMs(pipeHeader.flowRateLs, entry.innerDiameter)
                    : 0;
                const overLimit =
                  pipeHeader.flowRateLs > 0 && vel > pipeHeader.maxVelocityMs + 1e-9;
                const isAutoChoice =
                  pipeHeader.autoIsFallbackMaterial &&
                  pipeHeader.autoNominalMm === entry.nominalSize;
                return (
                  <option
                    key={`${optionalPipeSpec.id}:${entry.nominalSize}`}
                    value={`${optionalPipeSpec.id}:${entry.nominalSize}`}
                  >
                    {getPipeSpecBadgeLabel(optionalPipeSpec.id)} Ø{entry.nominalSize} mm · di{' '}
                    {formatPipeDim(entry.innerDiameter, optionalPipeSpec)} · {vel.toFixed(2)} m/s
                    {overLimit ? ' [> Limit]' : ' [OK]'}
                    {isAutoChoice ? ' ★' : ''}
                  </option>
                );
              })}
            </optgroup>
          )}
        </select>

        <div className="mt-2 pt-1.5 border-t border-[#e0e0e0] flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-[#666666]">
          <span className="truncate" title={`Auto-sized (${autoSpec.fullName}): ${autoSizeSummary}`}>
            Auto: {autoSizeSummary}
          </span>
          {pipeHeader.isCustomSize && (
            <button
              type="button"
              onClick={() => handleSelectPipeHeaderSize('AUTO')}
              data-testid="pipe-header-revert-auto"
              className="h-6 px-2 font-display text-[9px] font-bold uppercase bg-white border border-[#121212] hover:bg-[#121212] hover:text-white text-[#121212] inline-flex items-center gap-1 shrink-0 transition-colors"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Revert Auto</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderRoofTankAssembly = (isStickyHeaderSvg: boolean) => {
    const {
      tankX,
      tankY,
      tankWidth,
      tankHeight,
      tankRight,
      headerEndX,
      headerSpan,
      canCenterLabel,
      labelX,
      labelAnchor,
    } = getPipeHeaderGeometry();
    const tankSpecText = optionalPipeSpec
      ? `${getPipeSpecBadgeLabel(pipeSpec.id)} / ${getPipeSpecBadgeLabel(optionalPipeSpec.id)}`
      : pipeSpec.shortName ?? pipeSpec.fullName;

    const headerSpec = PIPE_SPEC_TABLES[pipeHeader.specId] ?? pipeSpec;
    const headerSpecBadge = getPipeSpecBadgeLabel(pipeHeader.specId);
    const headerStrokeColor = pipeHeader.exceedsMaxCapacity
      ? '#dc2626'
      : pipeHeader.isCustomSize || pipeHeader.isFallbackMaterial
      ? '#1d4ed8'
      : '#121212';

    const headerHeadline = pipeHeader.nominalMm
      ? `PIPE HEADER  ${pipeHeader.isFallbackMaterial ? `${headerSpecBadge} ` : ''}Ø${
          pipeHeader.nominalMm
        } mm${pipeHeader.isCustomSize ? ' [Custom]' : ''}${
          pipeHeader.exceedsMaxCapacity ? ` (> ${pipeHeader.maxVelocityMs.toFixed(1)} m/s)` : ''
        }`
      : 'PIPE HEADER';
    const headerSubline = pipeHeader.nominalMm
      ? `di ${formatPipeDim(pipeHeader.innerMm, headerSpec)} mm${
          pipeHeader.exceedsMaxCapacity && pipeHeader.requiredInnerDiaMm !== null
            ? ` (req ≥ ${pipeHeader.requiredInnerDiaMm.toFixed(0)})`
            : ''
        } · ${Math.round(pipeHeader.totalLu)} LU · ${pipeHeader.flowRateLs.toFixed(2)} L/s · ${
          pipeHeader.velocityMs !== null
            ? `${pipeHeader.velocityMs.toFixed(2)} m/s`
            : '—'
        }`
      : `${Math.round(pipeHeader.totalLu)} LU · ${pipeHeader.flowRateLs.toFixed(2)} L/s`;

    const isDraggingNewMain =
      Boolean(dragState?.started) &&
      dragState?.kind === 'tapping' &&
      dragState.isNewMainRiser &&
      canCreateNewRiser;
    const previewHeaderEndX = isDraggingNewMain ? columnX(numColumns) : headerEndX;
    const showHeaderHighlight = isInteractive && (isHeaderHovered || isHeaderEditorOpen);
    const headerLabelBoxWidth = Math.max(220, Math.min(headerSpan - 12, 340));
    const headerLabelBoxX = canCenterLabel
      ? Math.max(tankRight + 6, labelX - headerLabelBoxWidth / 2)
      : tankRight + 8;

    return (
      <g>
        {/* Rectangular Roof Storage Tank positioned above floor level rows */}
        <g data-testid="roof-storage-tank">
          <rect
            x={tankX}
            y={tankY}
            width={tankWidth}
            height={tankHeight}
            rx={0}
            fill="#f8f8f8"
            stroke="#121212"
            strokeWidth={1.5}
          />
          {/* Subtle water volume fill inside tank */}
          <rect
            x={tankX + 1}
            y={tankY + 12}
            width={tankWidth - 2}
            height={tankHeight - 13}
            fill="#e0f2fe"
            fillOpacity={0.35}
          />
          {/* Water surface line & liquid level triangle inside tank */}
          <line
            x1={tankX + 4}
            y1={tankY + 12}
            x2={tankRight - 4}
            y2={tankY + 12}
            stroke="#0369a1"
            strokeWidth={1}
            strokeDasharray="4 2"
          />
          <polygon
            points={`${tankRight - 14},${tankY + 8} ${tankRight - 8},${tankY + 8} ${tankRight - 11},${tankY + 12}`}
            fill="#0369a1"
          />
          <text
            x={tankX + tankWidth / 2}
            y={tankY + 26}
            fontSize={9}
            fontWeight={700}
            textAnchor="middle"
            fontFamily="Space Mono, monospace"
            fill="#121212"
          >
            ROOF STORAGE TANK
          </text>
          <text
            x={tankX + tankWidth / 2}
            y={tankY + 38}
            fontSize={7.8}
            fontWeight={500}
            textAnchor="middle"
            fontFamily="IBM Plex Mono, monospace"
            fill="#555555"
          >
            {tankSpecText}
          </text>
        </g>

        {/* Interactive Click-to-Edit Tank Outlet Flange, Horizontal Pipe Header Bus & Size Label */}
        <g
          data-testid="pipe-header-bus"
          onMouseEnter={() => {
            if (isInteractive) setIsHeaderHovered(true);
          }}
          onMouseLeave={() => setIsHeaderHovered(false)}
          onClick={(e) => {
            if (!isInteractive) return;
            e.stopPropagation();
            openPipeHeaderEditor();
          }}
          style={{ cursor: isInteractive ? 'pointer' : 'default' }}
        >
          <title>
            {pipeHeader.nominalMm
              ? `Roof Pipe Header (${headerSpec.fullName}${
                  pipeHeader.isCustomSize
                    ? ' · Custom Override'
                    : pipeHeader.isFallbackMaterial
                    ? ' · Optional Fallback'
                    : ' · Auto-Sized'
                }): Ø${pipeHeader.nominalMm} mm (di ${formatPipeDim(
                  pipeHeader.innerMm,
                  headerSpec
                )} mm) · ${Math.round(pipeHeader.totalLu)} LU across ${
                  pipeHeader.connectedDropperCount
                } main ${
                  pipeHeader.connectedDropperCount === 1 ? 'dropper' : 'droppers'
                } · Q = ${pipeHeader.flowRateLs.toFixed(2)} L/s · V = ${
                  pipeHeader.velocityMs !== null ? pipeHeader.velocityMs.toFixed(2) : '—'
                } m/s (Header limit ≤ ${pipeHeader.maxVelocityMs.toFixed(
                  1
                )} m/s = Global ${parameters.maxVelocityMs.toFixed(1)} − 0.5 m/s)${
                  isInteractive ? ' — Click to select custom Pipe Header size' : ''
                }`
              : `Roof Pipe Header (${pipeSpec.fullName}): No load assigned${
                  isInteractive ? ' — Click to select custom Pipe Header size' : ''
                }`}
          </title>

          {/* Generous transparent click hit-box spanning both header label and horizontal pipe bus */}
          {isInteractive && (
            <rect
              x={tankRight}
              y={8}
              width={Math.max(headerEndX - tankRight + 8, headerLabelBoxWidth + 16)}
              height={headerBusY + 4}
              fill="transparent"
            />
          )}

          {/* Subtle hover / active framing behind Pipe Header label */}
          {showHeaderHighlight && (
            <rect
              x={headerLabelBoxX}
              y={9}
              width={headerLabelBoxWidth}
              height={31}
              fill={
                pipeHeader.exceedsMaxCapacity
                  ? '#fef2f2'
                  : pipeHeader.isCustomSize
                  ? '#eff6ff'
                  : '#f4f4f5'
              }
              stroke={headerStrokeColor}
              strokeWidth={isHeaderEditorOpen ? 1.3 : 0.85}
              strokeDasharray={isHeaderEditorOpen ? undefined : '3 2'}
            />
          )}

          {/* Flanged outlet nozzle at bottom-right wall of Roof Storage Tank */}
          <line
            x1={tankRight}
            y1={headerBusY - 6}
            x2={tankRight}
            y2={headerBusY + 6}
            stroke={headerStrokeColor}
            strokeWidth={2.6}
          />
          {/* Thick horizontal Pipe Header bus extending across all vertical main droppers */}
          <line
            x1={tankRight}
            y1={headerBusY}
            x2={headerEndX}
            y2={headerBusY}
            stroke={headerStrokeColor}
            strokeWidth={showHeaderHighlight ? 6.5 : 5.5}
            strokeLinecap="butt"
          />
          {/* Blind flange end-cap at right terminus of Pipe Header */}
          <line
            x1={headerEndX}
            y1={headerBusY - 4.5}
            x2={headerEndX}
            y2={headerBusY + 4.5}
            stroke={headerStrokeColor}
            strokeWidth={2}
          />
          {/* Dashed header bus extension preview when dragging a floor to create a new dropper */}
          {isDraggingNewMain && previewHeaderEndX > headerEndX && (
            <line
              x1={headerEndX}
              y1={headerBusY}
              x2={previewHeaderEndX}
              y2={headerBusY}
              stroke="#1d4ed8"
              strokeWidth={4}
              strokeDasharray="5 3"
            />
          )}

          {/* Calculated / Custom Pipe Header Size Label positioned cleanly above the horizontal header line */}
          <g data-testid="pipe-header-label">
            <text
              x={labelX}
              y={22}
              fontSize={10}
              fontWeight={700}
              textAnchor={labelAnchor}
              fontFamily="Space Mono, monospace"
              fill={headerStrokeColor}
            >
              {headerHeadline}
            </text>
            <text
              x={labelX}
              y={35}
              fontSize={8.5}
              fontWeight={500}
              textAnchor={labelAnchor}
              fontFamily="IBM Plex Mono, monospace"
              fill={pipeHeader.exceedsMaxCapacity ? '#b91c1c' : '#555555'}
            >
              {headerSubline}
            </text>
          </g>
        </g>

        {/* Main Dropper Vertical Connections tapping off the Pipe Header Bus */}
        {orderedColumns.map((col, colIdx) => {
          if (col.kind !== 'main') return null;
          const x = columnX(colIdx);
          const breakY = 94;
          return (
            <g key={`tank-conn-${col.dropperIndex}`}>
              <line
                x1={x}
                y1={headerBusY}
                x2={x}
                y2={isStickyHeaderSvg ? tankTopHeight : rowY(0)}
                stroke={col.color}
                strokeWidth={2.5}
              />
              {/* Header-to-dropper tee junction node */}
              <circle
                cx={x}
                cy={headerBusY}
                r={3.4}
                fill={col.color}
                stroke="#ffffff"
                strokeWidth={1}
                pointerEvents="none"
              />
              {col.summary.hasBoosterPump ? (() => {
                const effBoost =
                  col.summary.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                const isCustom = col.summary.isCustomBoosterPressure;
                const isPumpSelected = selectedBoosterPump?.key === col.key;
                const isPumpHovered = isInteractive && hoveredPumpKey === col.key;
                const accentStroke = isCustom ? '#1d4ed8' : '#0369a1';
                const accentFill = isCustom ? '#eef2ff' : '#e0f2fe';
                const hoverFill = isCustom ? '#dbeafe' : '#bae6fd';
                return (
                  <g
                    transform={`translate(${x}, ${mainPumpY})`}
                    onMouseEnter={() => {
                      if (isInteractive) setHoveredPumpKey(col.key);
                    }}
                    onMouseLeave={() => {
                      if (hoveredPumpKey === col.key) setHoveredPumpKey(null);
                    }}
                    onClick={(e) => {
                      if (!isInteractive) return;
                      e.stopPropagation();
                      openBoosterEditor(col.target, `D${col.dropperIndex}`);
                    }}
                    style={{ cursor: isInteractive ? 'pointer' : 'default' }}
                    data-testid={`schematic-pump-D${col.dropperIndex}`}
                  >
                    {isInteractive && (
                      <title>
                        Booster Pump on D{col.dropperIndex} (+{effBoost.toFixed(2)} bar
                        {isCustom
                          ? ` · Custom override; global ${parameters.boosterPumpBoostBar.toFixed(2)} bar`
                          : ' · Global default'}
                        ) — Click to edit boost pressure or remove pump
                      </title>
                    )}
                    <rect
                      x={-11}
                      y={-11}
                      width={76}
                      height={22}
                      fill="transparent"
                    />
                    <circle
                      r={isPumpSelected || isPumpHovered ? 9.2 : 8.5}
                      fill={isPumpSelected || isPumpHovered ? hoverFill : accentFill}
                      stroke={accentStroke}
                      strokeWidth={isCustom || isPumpSelected ? 1.9 : 1.5}
                    />
                    <polygon points="-3,-3.5 4.5,0 -3,3.5" fill={accentStroke} />
                    {isCustom && (
                      <circle
                        cx={6.5}
                        cy={-6.5}
                        r={2.5}
                        fill="#1d4ed8"
                        stroke="#ffffff"
                        strokeWidth={0.9}
                      />
                    )}
                    <rect
                      x={10}
                      y={-7.5}
                      width={isCustom ? 52 : 47}
                      height={14}
                      fill={isPumpSelected || isPumpHovered ? hoverFill : isCustom ? '#eef2ff' : '#ffffff'}
                      stroke={isPumpSelected || isPumpHovered || isCustom ? accentStroke : 'transparent'}
                      strokeWidth={isPumpSelected || isPumpHovered ? 1 : 0.7}
                      opacity={isPumpSelected || isPumpHovered || isCustom ? 0.96 : 0.85}
                    />
                    <text
                      x={13}
                      y={2.5}
                      fontSize={8.5}
                      fontWeight={isCustom || isPumpSelected ? 700 : 600}
                      fontFamily="IBM Plex Mono, monospace"
                      fill={accentStroke}
                    >
                      +{effBoost.toFixed(1)} bar{isCustom ? '*' : ''}
                    </text>
                  </g>
                );
              })() : isInteractive ? (
                <g
                  transform={`translate(${x}, ${mainPumpY})`}
                  onMouseEnter={() => setHoveredPumpKey(col.key)}
                  onMouseLeave={() => {
                    if (hoveredPumpKey === col.key) setHoveredPumpKey(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleBoosterPump(col.target);
                  }}
                  style={{ cursor: 'pointer' }}
                  data-testid={`schematic-add-pump-D${col.dropperIndex}`}
                >
                  <title>
                    Gravity feed on D{col.dropperIndex} — Click to add booster pump (+
                    {parameters.boosterPumpBoostBar.toFixed(2)} bar)
                  </title>
                  <circle
                    r={hoveredPumpKey === col.key ? 8.5 : 6.5}
                    fill={hoveredPumpKey === col.key ? '#e0f2fe' : '#ffffff'}
                    stroke={hoveredPumpKey === col.key ? '#0369a1' : '#bdbdbd'}
                    strokeWidth={hoveredPumpKey === col.key ? 1.5 : 1.1}
                    strokeDasharray={hoveredPumpKey === col.key ? undefined : '2.2 1.8'}
                  />
                  <line
                    x1={-2.8}
                    y1={0}
                    x2={2.8}
                    y2={0}
                    stroke={hoveredPumpKey === col.key ? '#0369a1' : '#888888'}
                    strokeWidth={1.3}
                    strokeLinecap="round"
                  />
                  <line
                    x1={0}
                    y1={-2.8}
                    x2={0}
                    y2={2.8}
                    stroke={hoveredPumpKey === col.key ? '#0369a1' : '#888888'}
                    strokeWidth={1.3}
                    strokeLinecap="round"
                  />
                  {hoveredPumpKey === col.key && (
                    <text
                      x={11.5}
                      y={3}
                      fontSize={8.5}
                      fontWeight={600}
                      fontFamily="IBM Plex Mono, monospace"
                      fill="#0369a1"
                    >
                      +Pump
                    </text>
                  )}
                </g>
              ) : null}
              {/* Engineering Pipe Break / Zigzag Continuation Symbol when scrolled */}
              {isStickyHeaderSvg && isScrolled && (
                <g pointerEvents="none" data-testid={`pipe-break-D${col.dropperIndex}`}>
                  <path
                    d={`M ${x - 7} ${breakY - 2.5} L ${x - 2.5} ${breakY - 5.5} L ${x + 2.5} ${breakY + 0.5} L ${x + 7} ${breakY - 2.5} L ${x + 7} ${breakY + 2} L ${x + 2.5} ${breakY + 5} L ${x - 2.5} ${breakY - 1} L ${x - 7} ${breakY + 2} Z`}
                    fill="#ffffff"
                  />
                  <path
                    d={`M ${x - 7} ${breakY - 2.5} L ${x - 2.5} ${breakY - 5.5} L ${x + 2.5} ${breakY + 0.5} L ${x + 7} ${breakY - 2.5}`}
                    fill="none"
                    stroke={col.color}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d={`M ${x - 7} ${breakY + 2} L ${x - 2.5} ${breakY - 1} L ${x + 2.5} ${breakY + 5} L ${x + 7} ${breakY + 2}`}
                    fill="none"
                    stroke={col.color}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  const renderFloorStackSvgContent = () => {
    const highlightedColIdx = highlightedRiser
      ? colIndexByKey.get(riserKey(highlightedRiser))
      : undefined;

    return (
      <>
        {/* Highlighted Riser Backdrop Column */}
        {highlightedColIdx !== undefined && (
          <rect
            x={columnX(highlightedColIdx) - 26}
            y={useStickyHeader ? 2 : tankTopHeight - 8}
            width={52}
            height={totalSvgHeight - svgTopOffset - bottomPad + (useStickyHeader ? 6 : 16)}
            fill="rgba(18, 18, 18, 0.04)"
            stroke="#121212"
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Roof Water Tank & Header Assembly (inline only in non-sticky report preview mode) */}
        {!useStickyHeader && renderRoofTankAssembly(false)}

        {/* Top pipe entry stubs connecting seamlessly to the sticky Roof Tank header */}
        {useStickyHeader &&
          orderedColumns.map((col, colIdx) => {
            if (col.kind !== 'main') return null;
            const x = columnX(colIdx);
            return (
              <line
                key={`top-stub-${col.dropperIndex}`}
                x1={x}
                y1={0}
                x2={x}
                y2={rowY(0)}
                stroke={col.color}
                strokeWidth={2.5}
              />
            );
          })}

        {/* Floor Elevation Bands */}
        {rows.map((r, rIdx) => {
          const y = rowY(rIdx);
          const isRoof = r.input.supplyMode === SupplyMode.ROOF_HEADER;
          const isSubBranchTargetRow =
            dragState?.started &&
            dragState.kind === 'sub-branch' &&
            dragState.targetBranchRowIdx === rIdx;
          const isSubBranchCrossedRow =
            !isRoof &&
            dragState?.started &&
            dragState.kind === 'sub-branch' &&
            rIdx >= Math.min(dragState.sourceBranchRowIdx, dragState.targetBranchRowIdx) &&
            rIdx <= Math.max(dragState.sourceBranchRowIdx, dragState.targetBranchRowIdx);
          const isDraggedRow =
            isSubBranchTargetRow ||
            (dragState?.started &&
              dragState.kind === 'tapping' &&
              dragState.rowIdx === rIdx) ||
            (dragState?.started &&
              (dragState.kind === 'prv' ||
                (dragState.kind === 'new-prv' && dragState.insideSvg)) &&
              dragState.targetRowIdx === rIdx);
          const isHovered = hoveredRowIdx === rIdx || isDraggedRow;
          return (
            <g
              key={r.input.id}
              onMouseEnter={() => setHoveredRowIdx(rIdx)}
              className="cursor-pointer"
            >
              <rect
                x={4}
                y={y - rowHeight / 2}
                width={schematicSvgWidth - 8}
                height={rowHeight}
                fill={
                  isSubBranchTargetRow
                    ? '#ecfeff'
                    : isSubBranchCrossedRow
                    ? '#f0fdfa'
                    : isDraggedRow
                    ? '#eeeeee'
                    : isHovered
                    ? '#f3f3f3'
                    : rIdx % 2 === 0
                    ? 'transparent'
                    : '#fafafa'
                }
              />
              <line
                x1={8}
                y1={y + rowHeight / 2}
                x2={schematicSvgWidth - 8}
                y2={y + rowHeight / 2}
                stroke={isSubBranchTargetRow ? '#0891b2' : '#e0e0e0'}
                strokeWidth={isSubBranchTargetRow ? 1 : 0.75}
                strokeDasharray={isSubBranchTargetRow ? '3 2' : undefined}
              />
              {/* Floor Name & Static Head */}
              <text
                x={12}
                y={y + 3.5}
                fontSize={10}
                fontWeight={isRoof || isSubBranchTargetRow ? 700 : 600}
                fill={isSubBranchTargetRow ? '#0e7490' : '#121212'}
              >
                {r.input.floorLabel}
              </text>
              <text
                x={leftLabelWidth - 8}
                y={y + 3.5}
                fontSize={9.5}
                textAnchor="end"
                fontFamily="IBM Plex Mono, monospace"
                fill={isSubBranchTargetRow ? '#0891b2' : '#666666'}
              >
                {r.cumulativeHeadM.toFixed(2)}m
              </text>
            </g>
          );
        })}

        {/* Drop-Target Column Guides During Active Drag */}
        {dragState?.started &&
          (dragState.kind !== 'new-prv' || dragState.insideSvg) && (
            <g pointerEvents="none">
              {dragState.kind === 'sub-branch' ? (
                <>
                  {orderedColumns.map((col, colIdx) => {
                    const isParentMain =
                      col.kind === 'main' &&
                      col.dropperIndex === dragState.parentDropperIndex;
                    const isActiveSub =
                      col.kind === 'sub' &&
                      col.subDropperId === dragState.subDropperId;
                    if (!isParentMain && !isActiveSub) return null;
                    const x = columnX(colIdx);
                    const firstNonRoofIdx = rows.findIndex(
                      (r) => r.input.supplyMode !== SupplyMode.ROOF_HEADER
                    );
                    const spanTop =
                      firstNonRoofIdx >= 0
                        ? rowY(firstNonRoofIdx) - rowHeight / 2
                        : svgTopOffset;
                    const spanBottom = rowY(rows.length - 1) + rowHeight / 2;

                    return (
                      <g key={`sub-branch-guide-${col.key}`}>
                        <rect
                          x={x - 20}
                          y={spanTop}
                          width={40}
                          height={Math.max(rowHeight, spanBottom - spanTop)}
                          rx={4}
                          fill={
                            isParentMain
                              ? 'rgba(8, 145, 178, 0.09)'
                              : 'rgba(8, 145, 178, 0.05)'
                          }
                          stroke="#0891b2"
                          strokeWidth={isParentMain ? 1.4 : 0.9}
                          strokeDasharray="4 3"
                        />
                        {isParentMain &&
                          rows.map((r, rIdx) => {
                            if (r.input.supplyMode === SupplyMode.ROOF_HEADER) return null;
                            const ry = rowY(rIdx);
                            const isTargetSnap = rIdx === dragState.targetBranchRowIdx;
                            return (
                              <g key={`snap-tick-${r.input.id}`}>
                                <line
                                  x1={x - 8}
                                  y1={ry}
                                  x2={x + 8}
                                  y2={ry}
                                  stroke={isTargetSnap ? '#0891b2' : '#94a3b8'}
                                  strokeWidth={isTargetSnap ? 1.8 : 0.8}
                                />
                                {isTargetSnap && (
                                  <circle
                                    cx={x}
                                    cy={ry}
                                    r={7}
                                    fill="rgba(8, 145, 178, 0.14)"
                                    stroke="#0891b2"
                                    strokeWidth={1.5}
                                  />
                                )}
                              </g>
                            );
                          })}
                      </g>
                    );
                  })}
                </>
              ) : (
                orderedColumns.map((col, colIdx) => {
                  const x = columnX(colIdx);
                  const isTarget =
                    (dragState.kind !== 'tapping' || !dragState.isNewMainRiser) &&
                    isSameRiser(dragState.targetTarget, col.target);
                  const validRows = validPrvRowsByKey.get(col.key) ?? [];
                  const isPrvDrag =
                    dragState.kind === 'prv' || dragState.kind === 'new-prv';
                  const spanTop =
                    validRows.length > 0
                      ? rowY(validRows[0]) - rowHeight / 2
                      : svgTopOffset;
                  const spanBottom =
                    validRows.length > 0
                      ? rowY(validRows[validRows.length - 1]) + rowHeight / 2
                      : totalSvgHeight - bottomPad;

                  return (
                    <rect
                      key={`drop-col-${col.key}`}
                      x={x - 22}
                      y={spanTop}
                      width={44}
                      height={Math.max(rowHeight, spanBottom - spanTop)}
                      rx={4}
                      fill={
                        isTarget
                          ? isPrvDrag
                            ? 'rgba(217, 119, 6, 0.10)'
                            : 'rgba(29, 78, 216, 0.10)'
                          : 'rgba(148, 163, 184, 0.05)'
                      }
                      stroke={
                        isTarget ? (isPrvDrag ? '#d97706' : '#1d4ed8') : '#cbd5e1'
                      }
                      strokeWidth={isTarget ? 1.5 : 0.8}
                      strokeDasharray="4 3"
                    />
                  );
                })
              )}

              {/* + New Riser Column when dragging a tapping point */}
              {dragState.kind === 'tapping' &&
                canCreateNewRiser &&
                (() => {
                  const newDIdx = numDroppers + 1;
                  const newX = columnX(numColumns);
                  const isTarget = dragState.isNewMainRiser;
                  return (
                    <g>
                      <rect
                        x={newX - 24}
                        y={svgTopOffset}
                        width={48}
                        height={totalSvgHeight - svgTopOffset - bottomPad}
                        rx={4}
                        fill={
                          isTarget
                            ? 'rgba(29, 78, 216, 0.12)'
                            : 'rgba(241, 245, 249, 0.7)'
                        }
                        stroke={isTarget ? '#1d4ed8' : '#94a3b8'}
                        strokeWidth={isTarget ? 1.5 : 1}
                        strokeDasharray="4 3"
                      />
                      <line
                        x1={newX}
                        y1={useStickyHeader ? 0 : headerBusY}
                        x2={newX}
                        y2={totalSvgHeight - bottomPad}
                        stroke={isTarget ? '#1d4ed8' : '#cbd5e1'}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                      <text
                        x={newX}
                        y={totalSvgHeight - 12}
                        fontSize={9.5}
                        fontWeight={700}
                        textAnchor="middle"
                        fill={isTarget ? '#1d4ed8' : '#64748b'}
                      >
                        + New D{newDIdx}
                      </text>
                    </g>
                  );
                })()}
            </g>
          )}
      </>
    );
  };

  return (
    <div
      className={
        useStickyHeader
          ? 'bg-white flex-1 min-h-0 flex flex-col overflow-hidden'
          : 'bg-white'
      }
    >
      {/* Interactive Floor, Selected PRV & Live Drag Telemetry Bar */}
      <div
        className={`bg-[#f8f8f8] border-b border-[#e0e0e0] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs ${
          useStickyHeader ? 'shrink-0' : ''
        }`}
      >
        {dragState?.started && dragState.kind === 'tapping' ? (
          <div className="flex flex-wrap items-center gap-3 w-full justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-[11px] font-bold uppercase text-[#1d4ed8]">
                {dragState.isSplitLeg
                  ? `Moving Level ${dragState.floorLabel} Split Leg`
                  : `Reassigning Level ${dragState.floorLabel} Tapping Point`}
              </span>
              <span className="text-[#999999]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#333333]">
                {dragState.loadingUnits.toFixed(1)} LU
              </span>
              <span className="text-[#999999]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#121212] font-semibold">
                {formatTargetLabel(dragState.sourceTarget)} →{' '}
                {dragState.isNewMainRiser
                  ? `New D${numDroppers + 1}`
                  : formatTargetLabel(dragState.targetTarget)}
              </span>
              {livePreview?.kind === 'tapping' && livePreview.changed && (
                <>
                  <span className="text-[#999999]" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#333333]">
                    Target Riser ({livePreview.targetLabel}):{' '}
                    {livePreview.totalZoneLu.toFixed(0)} LU (
                    {livePreview.peakFlowRateLs.toFixed(2)} L/s · Ø
                    {livePreview.nominalMm ?? '-'} mm)
                  </span>
                </>
              )}
            </div>
            <span className="font-mono text-[11px] text-[#666666]">Release to apply · Esc to cancel</span>
          </div>
        ) : dragState?.started && dragState.kind === 'sub-branch' ? (
          <div className="flex flex-wrap items-center gap-3 w-full justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-[11px] font-bold uppercase text-[#0891b2]">
                Relocating {dragState.subDropperLabel} Branch Takeoff
              </span>
              <span className="text-[#999999]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#121212] font-semibold">
                D{dragState.parentDropperIndex} · L{dragState.sourceBranchFloorLabel} → L
                {dragState.targetBranchFloorLabel}
              </span>
              {livePreview?.kind === 'sub-branch' && livePreview.changed && (
                <>
                  {livePreview.addedFloorLabels.length > 0 && (
                    <>
                      <span className="text-[#999999]" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums font-semibold text-[#0e7490]">
                        +{livePreview.addedFloorLabels.length} Floor
                        {livePreview.addedFloorLabels.length > 1 ? 's' : ''} (
                        {livePreview.addedFloorLabels.join(', ')})
                      </span>
                    </>
                  )}
                  <span className="text-[#999999]" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#333333]">
                    Zone {livePreview.servedFloorRange}: {livePreview.totalZoneLu.toFixed(0)} LU (
                    {livePreview.peakFlowRateLs.toFixed(2)} L/s · Ø
                    {livePreview.baseNominalMm ?? '-'}
                    {livePreview.terminalNominalMm &&
                    livePreview.terminalNominalMm !== livePreview.baseNominalMm
                      ? `→Ø${livePreview.terminalNominalMm}`
                      : ''}{' '}
                    mm)
                  </span>
                </>
              )}
            </div>
            <span className="font-mono text-[11px] text-[#666666]">Release to apply · Esc to cancel</span>
          </div>
        ) : dragState?.started && (dragState.kind === 'prv' || dragState.kind === 'new-prv') ? (
          <div className="flex flex-wrap items-center gap-3 w-full justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-[11px] font-bold uppercase text-[#b45309]">
                {dragState.kind === 'new-prv'
                  ? 'Inserting New PRV Station'
                  : 'Repositioning PRV Station'}
              </span>
              <span className="text-[#999999]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#121212] font-semibold">
                {dragState.kind === 'new-prv'
                  ? `Target ${formatTargetLabel(dragState.targetTarget)} L${dragState.targetFloorLabel}`
                  : `${formatTargetLabel(dragState.sourceTarget)} L${dragState.sourceFloorLabel} → ${formatTargetLabel(dragState.targetTarget)} L${dragState.targetFloorLabel}`}
              </span>
              {(livePreview?.kind === 'prv' || livePreview?.kind === 'new-prv') &&
                livePreview.prvDetail && (
                  <>
                    <span className="text-[#999999]" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-[#121212]">
                      P1 {livePreview.prvDetail.upstreamPressureBar.toFixed(2)} → P2{' '}
                      {livePreview.prvDetail.downstreamPressureBar.toFixed(2)} bar
                    </span>
                    <span className="text-[#999999]" aria-hidden="true">·</span>
                    <span
                      className={`font-mono tabular-nums font-semibold ${
                        livePreview.prvDetail.cavitationWarning
                          ? 'text-[#d90000]'
                          : 'text-[#15803d]'
                      }`}
                    >
                      Ratio {livePreview.prvDetail.pressureRatio.toFixed(2)}{' '}
                      {livePreview.prvDetail.cavitationWarning
                        ? `(Cavitation Risk > ${formatCavitationRatio(
                            getEffectiveCavitationRatioLimit(parameters)
                          )})`
                        : '(OK)'}
                    </span>
                  </>
                )}
            </div>
            <span className="font-mono text-[11px] text-[#666666]">Release on riser to apply · Esc to cancel</span>
          </div>
        ) : isAddPrvMode ? (
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-[11px] font-bold uppercase text-[#b45309]">
                Place PRV Mode Active
              </span>
              <span className="text-[#999999]" aria-hidden="true">·</span>
              {livePreview?.kind === 'hover-add-prv' && livePreview.prvDetail ? (
                <span className="font-mono tabular-nums text-[#121212]">
                  {livePreview.riserLabel} L{livePreview.floorLabel}: P1{' '}
                  {livePreview.prvDetail.upstreamPressureBar.toFixed(2)} → P2{' '}
                  {livePreview.prvDetail.downstreamPressureBar.toFixed(2)} bar (Ratio{' '}
                  {livePreview.prvDetail.pressureRatio.toFixed(2)})
                </span>
              ) : (
                <span className="text-[#555555]">
                  Click any main or sub-dropper riser segment to insert a PRV (Pset{' '}
                  {parameters.prvSetPressureBar.toFixed(2)} bar)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsAddPrvMode(false)}
              className="h-7 px-2.5 text-[10px] font-display font-bold uppercase text-[#121212] bg-white border border-[#121212] hover:bg-[#121212] hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Cancel (Esc)
            </button>
          </div>
        ) : selectedPrv && selectedPrvCell?.prvDetail ? (
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-[11px] font-bold uppercase text-[#b45309]">
                Selected PRV · {selectedPrv.riserLabel} Level {selectedPrv.floorLabel}
              </span>
              {selectedPrvCell.prvDetail.isCustomSetPressure && (
                <span className="px-1.5 py-0.5 bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] font-mono text-[10px] font-bold uppercase leading-none">
                  Custom P2
                </span>
              )}
              <span className="text-[#999999]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#121212]">
                P1 {selectedPrvCell.prvDetail.upstreamPressureBar.toFixed(2)} → P2{' '}
                {selectedPrvCell.prvDetail.downstreamPressureBar.toFixed(2)} bar (DN
                {selectedPrvCell.prvDetail.recommendedValveDn})
              </span>
              <span className="text-[#999999]" aria-hidden="true">·</span>
              <span
                className={`font-mono tabular-nums font-semibold ${
                  selectedPrvCell.prvDetail.cavitationWarning
                    ? 'text-[#d90000]'
                    : 'text-[#15803d]'
                }`}
              >
                Ratio {selectedPrvCell.prvDetail.pressureRatio.toFixed(2)}{' '}
                {selectedPrvCell.prvDetail.cavitationWarning ? '(Cavitation Risk)' : '(OK)'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {selectedPrvCell.prvDetail.isCustomSetPressure && (
                <button
                  type="button"
                  onClick={() =>
                    handleSetPrvPressure(selectedPrv.target, selectedPrv.floorId, null)
                  }
                  className="h-7 px-2.5 text-[10px] font-display font-bold uppercase text-[#121212] bg-white border border-[#121212] hover:bg-[#121212] hover:text-white transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset P2 ({parameters.prvSetPressureBar.toFixed(2)}b)</span>
                </button>
              )}
              {!isPrvPopoverOpen && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedPrvCell.prvDetail) {
                      setPrvP2Draft(selectedPrvCell.prvDetail.downstreamPressureBar.toFixed(2));
                    }
                    setIsPrvPopoverOpen(true);
                  }}
                  className="h-7 px-2.5 text-[10px] font-display font-bold uppercase text-[#121212] bg-white border border-[#121212] hover:bg-[#121212] hover:text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Edit P2
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDeletePrv(selectedPrv.target, selectedPrv.floorId)}
                className="h-7 px-2.5 text-[10px] font-display font-bold uppercase text-white bg-[#d90000] hover:bg-[#b00000] transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete PRV</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPrvPopoverOpen(false);
                  setSelectedPrv(null);
                }}
                aria-label="Clear PRV selection"
                className="h-7 w-7 inline-flex items-center justify-center text-[#555555] hover:text-[#121212] border border-[#e0e0e0] bg-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : inspectedRow ? (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-display text-[11px] font-bold uppercase text-[#121212]">
                Level {inspectedRow.input.floorLabel}
              </span>
              <span className="text-[#999999]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#333333]">
                H {inspectedRow.cumulativeHeadM.toFixed(2)} m (
                {inspectedRow.staticPressureBar.toFixed(2)} bar)
              </span>
              <span className="text-[#999999]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#333333]">
                Working P:{' '}
                <strong className="text-[#121212]">
                  {inspectedRow.primaryWorkingPressureBar !== null
                    ? `${inspectedRow.primaryWorkingPressureBar.toFixed(2)} bar`
                    : 'Tank Header'}
                </strong>
              </span>
              {inspectedRow.isSplitFloor && (
                <>
                  <span className="text-[#999999]" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#1d4ed8] font-semibold">
                    ◐ Split {Math.round(inspectedRow.input.loadingUnits)} LU (
                    {inspectedRow.riserAllocations
                      .map(
                        (a) =>
                          `${a.riserLabel}: ${Math.round(a.assignedLu)} · ${Math.round(
                            a.loadFraction * 100
                          )}%`
                      )
                      .join(', ')}
                    )
                  </span>
                </>
              )}
              {inspectedRow.primaryNominalMm && (
                <>
                  <span className="text-[#999999]" aria-hidden="true">·</span>
                  <span
                    className={`font-mono tabular-nums ${
                      inspectedRow.primaryIsFallbackMaterial
                        ? 'text-[#1d4ed8] font-semibold'
                        : 'text-[#333333]'
                    }`}
                  >
                    {inspectedRow.primaryIsFallbackMaterial
                      ? `${getPipeSpecBadgeLabel(inspectedRow.primarySpecId)} `
                      : ''}
                    Ø{inspectedRow.primaryNominalMm} mm (
                    {formatPipeDim(
                      inspectedRow.primaryInnerMm,
                      PIPE_SPEC_TABLES[inspectedRow.primarySpecId] ?? pipeSpec
                    )}{' '}
                    di) @ {inspectedRow.primaryVelocityMs?.toFixed(2)} m/s
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {isInteractive && nonRoofRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (isSubCreatorOpen) {
                      setIsSubCreatorOpen(false);
                    } else {
                      openSubCreator();
                    }
                  }}
                  aria-expanded={isSubCreatorOpen}
                  className={`h-7 px-2.5 font-display text-[10px] font-bold uppercase border transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    isSubCreatorOpen
                      ? 'bg-[#0891b2] text-white border-[#0891b2]'
                      : 'bg-white text-[#0891b2] border-[#0891b2] hover:bg-[#0891b2] hover:text-white'
                  }`}
                >
                  <GitBranch className="w-3 h-3" />
                  <span>+ Sub-Dropper</span>
                </button>
              )}
              {isInteractive && (
                <button
                  type="button"
                  onPointerDown={startNewPrvToolbarDrag}
                  onClick={() => {
                    if (addPrvBtnClickGuardRef.current) return;
                    setIsAddPrvMode((prev) => !prev);
                  }}
                  title="Click to place a PRV on any riser segment, or drag directly onto the schematic"
                  aria-pressed={isAddPrvMode}
                  className={`h-7 px-2.5 font-display text-[10px] font-bold uppercase border transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-grab active:cursor-grabbing ${
                    isAddPrvMode
                      ? 'bg-[#121212] text-white border-[#121212]'
                      : 'bg-white text-[#121212] border-[#121212] hover:bg-[#121212] hover:text-white'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  <span>{isAddPrvMode ? 'Placing PRV...' : 'Add PRV'}</span>
                </button>
              )}
              {isInteractive && hasManualPrvOverrides && onChangeFloors && floors && (
                <button
                  type="button"
                  onClick={() => {
                    onChangeFloors(resetAllPrvOverrides(floors));
                    setSelectedPrv(null);
                  }}
                  className="h-7 px-2.5 font-display text-[10px] font-bold uppercase text-[#121212] bg-white border border-[#e0e0e0] hover:border-[#121212] transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset PRVs</span>
                </button>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Inline Sub-Dropper Branch Creator Strip */}
      {isInteractive && isSubCreatorOpen && nonRoofRows.length > 0 && (
        <div className="shrink-0 bg-white border-b border-[#e0e0e0] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-display text-[10px] font-bold uppercase text-[#0891b2]">
              New Sub-Dropper
            </span>
            <div className="flex items-center gap-1">
              <label
                htmlFor="sd-create-label"
                className="font-display text-[9px] font-bold uppercase text-[#666666]"
              >
                Label
              </label>
              <input
                id="sd-create-label"
                type="text"
                value={subDraftLabel}
                onChange={(e) => setSubDraftLabel(e.target.value)}
                className="w-16 h-6 px-1.5 text-xs font-mono font-bold text-[#0891b2] bg-[#f8f8f8] border border-[#e0e0e0] focus:bg-white focus:border-[#121212] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1">
              <label
                htmlFor="sd-create-parent"
                className="font-display text-[9px] font-bold uppercase text-[#666666]"
              >
                Feed From
              </label>
              <select
                id="sd-create-parent"
                value={subDraftParent}
                onChange={(e) => setSubDraftParent(Number(e.target.value))}
                className="h-6 px-1.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              >
                {dropperSummaries.map((d) => (
                  <option key={d.dropperIndex} value={d.dropperIndex}>
                    D{d.dropperIndex} ({d.zoneType === 'Booster' ? 'Boost' : 'Grav'})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <label
                htmlFor="sd-create-branch"
                className="font-display text-[9px] font-bold uppercase text-[#666666]"
              >
                Branch @
              </label>
              <select
                id="sd-create-branch"
                value={subDraftBranchId}
                onChange={(e) => setSubDraftBranchId(e.target.value)}
                className="h-6 px-1.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              >
                {nonRoofRows.map((r) => (
                  <option key={r.input.id} value={r.input.id}>
                    {r.input.floorLabel}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="font-display text-[9px] font-bold uppercase text-[#666666]">
                Serve Floors
              </span>
              <select
                value={subDraftFromId}
                onChange={(e) => setSubDraftFromId(e.target.value)}
                aria-label="Sub-dropper start floor"
                className="h-6 px-1.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              >
                {nonRoofRows.map((r) => (
                  <option key={r.input.id} value={r.input.id}>
                    {r.input.floorLabel}
                  </option>
                ))}
              </select>
              <span className="text-[#888888]">–</span>
              <select
                value={subDraftToId}
                onChange={(e) => setSubDraftToId(e.target.value)}
                aria-label="Sub-dropper end floor"
                className="h-6 px-1.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              >
                {nonRoofRows.map((r) => (
                  <option key={r.input.id} value={r.input.id}>
                    {r.input.floorLabel}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#0369a1] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={subDraftBooster}
                onChange={(e) => setSubDraftBooster(e.target.checked)}
                className="accent-[#0369a1]"
              />
              <span>Booster Pump (+{parameters.boosterPumpBoostBar.toFixed(1)}b)</span>
            </label>
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={handleCreateSubDropper}
              className="h-6 px-2.5 font-display text-[10px] font-bold uppercase bg-[#0891b2] text-white hover:bg-[#0e7490] transition-colors whitespace-nowrap"
            >
              Create Branch
            </button>
            <button
              type="button"
              onClick={() => setIsSubCreatorOpen(false)}
              className="h-6 px-2 font-display text-[10px] font-bold uppercase bg-white border border-[#e0e0e0] text-[#555555] hover:border-[#121212] hover:text-[#121212] transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Schematic Tap-Off Symbol Legend Strip */}
      <div
        className={`bg-white border-b border-[#e0e0e0] px-4 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] font-mono text-[#555555] ${
          useStickyHeader ? 'shrink-0' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            disabled={!isInteractive}
            onClick={() => openPipeHeaderEditor()}
            title={
              isInteractive
                ? `Click to edit Pipe Header size (Header velocity limit ≤ ${pipeHeader.maxVelocityMs.toFixed(
                    1
                  )} m/s = Global ${parameters.maxVelocityMs.toFixed(1)} − 0.5 m/s)`
                : undefined
            }
            className={`inline-flex items-center gap-1.5 font-semibold text-left ${
              isInteractive ? 'cursor-pointer hover:underline' : 'cursor-default'
            } ${
              pipeHeader.exceedsMaxCapacity
                ? 'text-[#dc2626]'
                : pipeHeader.isCustomSize || pipeHeader.isFallbackMaterial
                ? 'text-[#1d4ed8]'
                : 'text-[#121212]'
            }`}
          >
            <svg viewBox="0 0 18 10" className="w-4 h-2.5 shrink-0" aria-hidden="true">
              <line
                x1="1"
                y1="5"
                x2="17"
                y2="5"
                stroke={
                  pipeHeader.exceedsMaxCapacity
                    ? '#dc2626'
                    : pipeHeader.isCustomSize || pipeHeader.isFallbackMaterial
                    ? '#1d4ed8'
                    : '#121212'
                }
                strokeWidth="4.2"
              />
            </svg>
            <span>Pipe Header</span>
          </button>
          <span className="inline-flex items-center gap-1.5 text-[#121212]">
            <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0" aria-hidden="true">
              <circle cx="6" cy="6" r="4.2" fill="#121212" />
            </svg>
            <span>Full Load Tap-Off (100% LU)</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#121212]">
            <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0" aria-hidden="true">
              <circle cx="6" cy="6" r="4.2" fill="#ffffff" stroke="#121212" strokeWidth="1.4" />
              <path d="M 6 1.8 A 4.2 4.2 0 0 0 6 10.2 Z" fill="#121212" />
            </svg>
            <span>Fractional Tap-Off</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 18 10" className="w-4 h-2.5 shrink-0" aria-hidden="true">
              <line
                x1="1"
                y1="5"
                x2="17"
                y2="5"
                stroke="#555555"
                strokeWidth="1.8"
                strokeDasharray="3 2"
              />
            </svg>
            <span>Express Pass-Through</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 14 12" className="w-3.5 h-3 shrink-0" aria-hidden="true">
              <polygon points="1,1 13,1 7,6 1,11 13,11" fill="#d97706" />
            </svg>
            <span>PRV Station</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#0369a1]">
            <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="#e0f2fe" stroke="#0369a1" strokeWidth="1.4" />
              <polygon points="5,4.5 10,7 5,9.5" fill="#0369a1" />
            </svg>
            <span>Booster Pump</span>
          </span>
        </div>
        {result.splitFloorCount > 0 && (
          <span className="font-semibold text-[#1d4ed8]">
            {result.splitFloorCount} Split {result.splitFloorCount === 1 ? 'Floor' : 'Floors'} Active
          </span>
        )}
      </div>

      {/* Schematic Diagram Viewport */}
      <div
        className={
          useStickyHeader
            ? 'bg-white flex-1 min-h-0 flex flex-col overflow-hidden'
            : 'bg-white'
        }
      >
        <div
          ref={useStickyHeader ? scrollContainerRef : undefined}
          onScroll={
            useStickyHeader
              ? (e) => {
                  const scrolled = e.currentTarget.scrollTop > 4;
                  if (scrolled !== isScrolled) {
                    setIsScrolled(scrolled);
                  }
                }
              : undefined
          }
          className={
            useStickyHeader
              ? 'flex-1 min-h-0 max-h-[70vh] lg:max-h-none overflow-y-auto overflow-x-auto bg-white relative'
              : 'overflow-x-auto p-4'
          }
        >
          <div
            className={useStickyHeader ? 'px-4 pb-4 mx-auto' : undefined}
            style={
              useStickyHeader
                ? {
                    minWidth: `${Math.max(540, Math.round(schematicSvgWidth * 0.85)) + 32}px`,
                    maxWidth: `${Math.max(960, Math.round(schematicSvgWidth * 1.15)) + 32}px`,
                  }
                : undefined
            }
          >
            {useStickyHeader && (
              <div
                className={`sticky top-0 ${
                  isHeaderEditorOpen || selectedBoosterPump?.target.kind === 'main'
                    ? 'z-30'
                    : 'z-10'
                } bg-white pt-4 transition-shadow ${
                  isScrolled ? 'shadow-[0_1px_0_0_#d4d4d4]' : ''
                }`}
              >
                <svg
                  viewBox={`0 0 ${schematicSvgWidth} ${tankTopHeight}`}
                  className="w-full h-auto block select-none touch-none"
                  aria-hidden="true"
                  onClick={() => {
                    if (!dragState?.started) {
                      setIsPrvPopoverOpen(false);
                      setSelectedPrv(null);
                      setSelectedTapNode(null);
                      setSelectedBoosterPump(null);
                      setIsHeaderEditorOpen(false);
                    }
                  }}
                >
                  {renderRoofTankAssembly(true)}
                </svg>

                {/* Inline Popover for Pipe Header Nominal Size Selection (Sticky Header Context) */}
                {renderPipeHeaderPopover(true)}

                {/* Inline Popover for Main Dropper Booster Pump Pressure Override (Sticky Header Context) */}
                {isInteractive &&
                  selectedBoosterPump &&
                  selectedBoosterPump.target.kind === 'main' &&
                  !dragState?.started &&
                  (() => {
                    const mainIdx = (
                      selectedBoosterPump.target as { kind: 'main'; dropperIndex: number }
                    ).dropperIndex;
                    const summary = dropperSummaries.find((d) => d.dropperIndex === mainIdx);
                    if (!summary || !summary.hasBoosterPump) return null;
                    const effBoost =
                      summary.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                    const pumpX = targetX(selectedBoosterPump.target);
                    const leftPct = (pumpX / schematicSvgWidth) * 100;
                    const placeLeft = leftPct > 62;
                    const translateX = placeLeft ? 'calc(-100% + 14px)' : '-14px';

                    const commitBoosterDraft = () => {
                      const trimmed = boosterDraft.trim();
                      if (trimmed === '') {
                        handleSetBoosterPressure(selectedBoosterPump.target, null);
                        setBoosterDraft(parameters.boosterPumpBoostBar.toFixed(2));
                        return;
                      }
                      const parsed = parseFloat(trimmed);
                      if (Number.isNaN(parsed) || parsed <= 0) {
                        setBoosterDraft(effBoost.toFixed(2));
                        return;
                      }
                      const rounded = Math.round(Math.min(15, Math.max(0.1, parsed)) * 100) / 100;
                      if (
                        !summary.isCustomBoosterPressure &&
                        Math.abs(rounded - parameters.boosterPumpBoostBar) < 1e-6
                      ) {
                        setBoosterDraft(parameters.boosterPumpBoostBar.toFixed(2));
                        return;
                      }
                      handleSetBoosterPressure(selectedBoosterPump.target, rounded);
                      setBoosterDraft(rounded.toFixed(2));
                    };

                    return (
                      <div
                        role="dialog"
                        aria-label={`Edit Booster Pump Pressure for ${selectedBoosterPump.riserLabel}`}
                        data-testid={`booster-popover-${selectedBoosterPump.riserLabel}`}
                        className="absolute z-30 w-[244px] bg-white border-2 border-[#121212] shadow-[4px_4px_0_0_rgba(18,18,18,0.14)] p-2.5 text-xs"
                        style={{
                          left: `${leftPct}%`,
                          top: '100%',
                          marginTop: '4px',
                          transform: `translateX(${translateX})`,
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-[#e0e0e0]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212] truncate">
                              Booster · {selectedBoosterPump.riserLabel}
                            </span>
                            {summary.isCustomBoosterPressure && (
                              <span className="px-1 py-0.5 bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] font-mono text-[9px] font-bold uppercase leading-none shrink-0">
                                Custom
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedBoosterPump(null)}
                            aria-label="Close booster pump editor"
                            className="h-5 w-5 inline-flex items-center justify-center text-[#555555] hover:text-[#121212]"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 mb-2 font-mono tabular-nums text-[10px] bg-[#f8f8f8] border border-[#e0e0e0] px-2 py-1.5">
                          <div>
                            <span className="text-[#666666] block text-[9px] uppercase">
                              Working Range
                            </span>
                            <span className="font-semibold text-[#121212]">
                              {summary.minWorkingPressureBar !== null &&
                              summary.maxWorkingPressureBar !== null
                                ? `${summary.minWorkingPressureBar.toFixed(1)}–${summary.maxWorkingPressureBar.toFixed(1)} bar`
                                : summary.servedFloorRange}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[#666666] block text-[9px] uppercase">
                              PRVs / Vel
                            </span>
                            <span
                              className={`font-semibold ${
                                summary.cavitationRiskCount > 0 ? 'text-[#d90000]' : 'text-[#121212]'
                              }`}
                            >
                              {summary.prvCount} PRV ·{' '}
                              {summary.peakVelocityMs !== null
                                ? `${summary.peakVelocityMs.toFixed(2)}`
                                : '—'}{' '}
                              m/s
                            </span>
                          </div>
                        </div>

                        <label
                          htmlFor="booster-pump-pressure-input"
                          className="block font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] mb-1"
                        >
                          Boost Pressure ΔP (bar)
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            ref={boosterInputRef}
                            id="booster-pump-pressure-input"
                            data-testid={`booster-popover-input-${selectedBoosterPump.riserLabel}`}
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="15.0"
                            value={boosterDraft}
                            onFocus={() => setIsBoosterInputFocused(true)}
                            onBlur={() => {
                              setIsBoosterInputFocused(false);
                              commitBoosterDraft();
                            }}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setBoosterDraft(raw);
                              const parsed = parseFloat(raw);
                              if (!Number.isNaN(parsed) && parsed >= 0.1 && parsed <= 15) {
                                const rounded = Math.round(parsed * 100) / 100;
                                if (
                                  !summary.isCustomBoosterPressure &&
                                  Math.abs(rounded - parameters.boosterPumpBoostBar) < 1e-6
                                ) {
                                  return;
                                }
                                handleSetBoosterPressure(selectedBoosterPump.target, rounded);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitBoosterDraft();
                                setSelectedBoosterPump(null);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedBoosterPump(null);
                              }
                            }}
                            className="flex-1 min-w-0 h-7 px-2 text-xs font-mono tabular-nums bg-white border border-[#121212] text-[#121212] focus:outline-none"
                          />
                          {summary.isCustomBoosterPressure && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                handleSetBoosterPressure(selectedBoosterPump.target, null);
                                setBoosterDraft(parameters.boosterPumpBoostBar.toFixed(2));
                              }}
                              title={`Reset to global default (${parameters.boosterPumpBoostBar.toFixed(
                                2
                              )} bar)`}
                              data-testid={`booster-popover-reset-${selectedBoosterPump.riserLabel}`}
                              className="h-7 px-2 font-display text-[10px] font-bold uppercase bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] inline-flex items-center gap-1 shrink-0"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Reset</span>
                            </button>
                          )}
                        </div>

                        <div className="mt-2 pt-1.5 border-t border-[#e0e0e0] flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-[#666666]">
                          <span>Global: +{parameters.boosterPumpBoostBar.toFixed(2)}b</span>
                          <button
                            type="button"
                            onClick={() => {
                              handleToggleBoosterPump(selectedBoosterPump.target, false);
                              setSelectedBoosterPump(null);
                            }}
                            data-testid={`booster-popover-remove-${selectedBoosterPump.riserLabel}`}
                            className="px-1.5 py-0.5 font-display text-[9px] font-bold uppercase text-[#d90000] border border-[#fca5a5] bg-[#fef2f2] hover:bg-[#fee2e2] transition-colors"
                          >
                            Remove Pump
                          </button>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            )}

            <div className="relative">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${schematicSvgWidth} ${totalSvgHeight}`}
                style={
                  useStickyHeader
                    ? undefined
                    : {
                        minWidth: `${Math.max(540, Math.round(schematicSvgWidth * 0.85))}px`,
                        maxWidth: `${Math.max(960, Math.round(schematicSvgWidth * 1.15))}px`,
                      }
                }
                className={
                  useStickyHeader
                    ? 'w-full h-auto block select-none touch-none'
                    : 'w-full h-auto mx-auto select-none touch-none'
                }
                role="img"
                aria-label="Vertical Domestic Cold Water Riser Diagram"
                onClick={() => {
                  if (!dragState?.started) {
                    setIsPrvPopoverOpen(false);
                    setSelectedPrv(null);
                    setSelectedTapNode(null);
                    setSelectedBoosterPump(null);
                    setIsHeaderEditorOpen(false);
                  }
                }}
              >
                {renderFloorStackSvgContent()}

                {/* Vertical Main & Sub-Dropper Risers, Branch Tees, Pipe Sizes, Takeoffs & PRVs */}
                {orderedColumns.map((col, colIdx) => {
                  const x = columnX(colIdx);
                  const color = col.color;

                  if (col.kind === 'main') {
                    const d = col.summary;
                    return (
                      <g key={`riser-${col.key}`}>
                        {rows.map((r, rIdx) => {
                          const cell = r.dropperCells[d.dropperIndex];
                          if (!cell) return null;
                          const y = rowY(rIdx);
                          const prevCell =
                            rIdx > 0 ? rows[rIdx - 1].dropperCells[d.dropperIndex] : null;
                          const prevY = rIdx > 0 ? rowY(rIdx - 1) : useStickyHeader ? 0 : headerBusY;
                          const isRoof = r.input.supplyMode === SupplyMode.ROOF_HEADER;

                          const strokeW = cell.selectedNominalMm
                            ? Math.max(2, Math.min(5.5, cell.selectedNominalMm / 36))
                            : 2;

                          const sizeChanged =
                            !prevCell ||
                            prevCell.selectedNominalMm !== cell.selectedNominalMm ||
                            prevCell.selectedSpecId !== cell.selectedSpecId;

                          const isSourceTapping =
                            dragState?.started &&
                            dragState.kind === 'tapping' &&
                            dragState.floorId === r.input.id &&
                            isSameRiser(dragState.sourceTarget, col.target);

                          const isSourcePrv =
                            dragState?.started &&
                            dragState.kind === 'prv' &&
                            dragState.sourceFloorId === r.input.id &&
                            isSameRiser(dragState.sourceTarget, col.target);

                          const tapTargetKey = `tap-${col.key}-${r.input.id}`;
                          const prvTargetKey = `prv-${col.key}-${r.input.id}`;
                          const addTargetKey = `add-prv-${col.key}-${r.input.id}`;
                          const isTapHovered = hoveredTargetKey === tapTargetKey;
                          const isPrvHovered = hoveredTargetKey === prvTargetKey;
                          const isAddHovered = hoveredTargetKey === addTargetKey;

                          const isPrvSelected =
                            selectedPrv?.targetKey === col.key &&
                            selectedPrv?.floorId === r.input.id;

                          const overPressure =
                            cell.workingPressureBar !== null &&
                            cell.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;

                          const prvYOffset = getPrvYOffset(col.target, rIdx);
                          const showAddPrvTarget =
                            isInteractive &&
                            !isRoof &&
                            !cell.hasPrv &&
                            !dragState?.started &&
                            isAddPrvMode;

                          return (
                            <g key={`seg-${col.key}-${r.input.id}`}>
                              {rIdx > 0 && prevCell && (
                                <line
                                  x1={x}
                                  y1={prevY}
                                  x2={x}
                                  y2={y}
                                  stroke={cell.exceedsMaxPipeCapacity ? '#dc2626' : color}
                                  strokeWidth={strokeW}
                                  strokeDasharray={cell.isExpressPassThrough ? '4 3' : undefined}
                                />
                              )}

                              {isInteractive && !isRoof && (
                                <rect
                                  x={x - 10}
                                  y={y - rowHeight / 2}
                                  width={20}
                                  height={rowHeight}
                                  fill="transparent"
                                  style={{
                                    cursor: isAddPrvMode && !cell.hasPrv ? 'crosshair' : undefined,
                                  }}
                                  onMouseEnter={() => {
                                    setHoveredRowIdx(rIdx);
                                    setHoveredSegment({
                                      target: col.target,
                                      targetKey: col.key,
                                      rowIdx: rIdx,
                                    });
                                  }}
                                  onMouseLeave={() => {
                                    if (
                                      hoveredSegment?.targetKey === col.key &&
                                      hoveredSegment?.rowIdx === rIdx
                                    ) {
                                      setHoveredSegment(null);
                                    }
                                  }}
                                  onClick={(e) => {
                                    if (isAddPrvMode && !cell.hasPrv) {
                                      e.stopPropagation();
                                      handleAddPrv(col.target, r.input.id);
                                      setIsAddPrvMode(false);
                                    }
                                  }}
                                  onContextMenu={(e) =>
                                    openSegmentContextMenu(
                                      e,
                                      col.target,
                                      r.input.id,
                                      r.input.floorLabel,
                                      cell.hasPrv,
                                      cell.isServed
                                    )
                                  }
                                />
                              )}

                              {cell.isServed && (
                                <g
                                  opacity={isSourceTapping ? 0.3 : 1}
                                  onMouseEnter={() => {
                                    setHoveredRowIdx(rIdx);
                                    if (isInteractive) setHoveredTargetKey(tapTargetKey);
                                  }}
                                  onMouseLeave={() => {
                                    if (hoveredTargetKey === tapTargetKey) {
                                      setHoveredTargetKey(null);
                                    }
                                  }}
                                  onPointerDown={(e) =>
                                    startTappingDrag(
                                      e,
                                      r.input.id,
                                      r.input.floorLabel,
                                      rIdx,
                                      col.target,
                                      cell.assignedFloorLu,
                                      cell.isSplitLoad
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    cursor: isInteractive
                                      ? isAddPrvMode
                                        ? 'crosshair'
                                        : 'grab'
                                      : 'default',
                                  }}
                                  data-split={cell.isSplitLoad ? 'true' : 'false'}
                                  data-testid={`tapping-node-D${d.dropperIndex}-${r.input.floorLabel}`}
                                >
                                  <title>
                                    {`Level ${r.input.floorLabel} · D${d.dropperIndex}: ${cell.assignedFloorLu.toFixed(1)} LU (${
                                      cell.isSplitLoad
                                        ? `${Math.round(cell.loadFraction * 100)}% Split Load`
                                        : '100% Full Load'
                                    }) · Cum ${cell.cumulativeLu.toFixed(1)} LU · Q = ${cell.flowRateLs.toFixed(2)} L/s${
                                      cell.workingPressureBar !== null
                                        ? ` · P = ${cell.workingPressureBar.toFixed(2)} bar`
                                        : ''
                                    }${isInteractive ? ' — Click to configure split or drag to move' : ''}`}
                                  </title>
                                  {isInteractive && (
                                    <rect
                                      x={x + 4}
                                      y={y - 7}
                                      width={28}
                                      height={16}
                                      rx={4}
                                      fill="transparent"
                                    />
                                  )}
                                  <line
                                    x1={x}
                                    y1={y}
                                    x2={x + 19}
                                    y2={y}
                                    stroke={color}
                                    strokeWidth={isTapHovered ? 2.4 : 1.75}
                                  />
                                  {(isTapHovered ||
                                    (selectedTapNode?.floorId === r.input.id &&
                                      selectedTapNode?.targetKey === col.key)) &&
                                    !isAddPrvMode && (
                                      <circle
                                        cx={x + 19}
                                        cy={y}
                                        r={7.5}
                                        fill="none"
                                        stroke={
                                          selectedTapNode?.floorId === r.input.id &&
                                          selectedTapNode?.targetKey === col.key
                                            ? '#1d4ed8'
                                            : color
                                        }
                                        strokeWidth={1.5}
                                        strokeOpacity={0.8}
                                      />
                                    )}
                                  {renderTappingDot(x + 19, y, color, cell.isSplitLoad)}
                                  {cell.workingPressureBar !== null && (
                                    <text
                                      x={x + 26}
                                      y={y + 3}
                                      fontSize={8.5}
                                      fontWeight={
                                        overPressure || cell.prvDetail?.cavitationWarning
                                          ? 700
                                          : 400
                                      }
                                      fontFamily="IBM Plex Mono, monospace"
                                      fill={
                                        overPressure || cell.prvDetail?.cavitationWarning
                                          ? '#dc2626'
                                          : '#334155'
                                      }
                                    >
                                      {cell.hasPrv && cell.prvDetail
                                        ? `${cell.prvDetail.upstreamPressureBar.toFixed(1)}→${cell.prvDetail.downstreamPressureBar.toFixed(1)}b${cell.prvDetail.isCustomSetPressure ? '*' : ''}${overPressure ? '!' : ''}`
                                        : `${cell.workingPressureBar.toFixed(2)}b${overPressure ? '!' : ''}`}
                                      {cell.isSplitLoad && (
                                        <tspan fill="#1d4ed8" fontWeight={600}>
                                          {` ·${Math.round(cell.loadFraction * 100)}%`}
                                        </tspan>
                                      )}
                                    </text>
                                  )}
                                </g>
                              )}

                              {!cell.isServed && cell.hasPrv && cell.prvDetail && (
                                <text
                                  x={x + 12}
                                  y={y + 3}
                                  fontSize={8.5}
                                  fontWeight={cell.prvDetail.cavitationWarning ? 700 : 400}
                                  fontFamily="IBM Plex Mono, monospace"
                                  fill={
                                    cell.prvDetail.cavitationWarning ? '#dc2626' : '#334155'
                                  }
                                >
                                  {cell.prvDetail.upstreamPressureBar.toFixed(1)}→
                                  {cell.prvDetail.downstreamPressureBar.toFixed(1)}b
                                  {cell.prvDetail.isCustomSetPressure ? '*' : ''}
                                </text>
                              )}

                              {sizeChanged && cell.selectedNominalMm && (
                                <g pointerEvents="none">
                                  <text
                                    x={x - 5}
                                    y={rIdx === 0 && cell.hasPrv ? y + 14 : y + 1}
                                    fontSize={8.5}
                                    textAnchor="end"
                                    fontWeight={600}
                                    fontFamily="IBM Plex Mono, monospace"
                                    fill={
                                      cell.exceedsMaxPipeCapacity
                                        ? '#dc2626'
                                        : cell.isFallbackMaterial
                                        ? '#1d4ed8'
                                        : '#0f172a'
                                    }
                                  >
                                    {cell.isFallbackMaterial
                                      ? `${getPipeSpecBadgeLabel(cell.selectedSpecId)} `
                                      : ''}
                                    Ø{cell.selectedNominalMm}
                                    {cell.exceedsMaxPipeCapacity ? '!' : ''}
                                  </text>
                                  {cell.selectedInnerMm !== null && (
                                    <text
                                      x={x - 5}
                                      y={rIdx === 0 && cell.hasPrv ? y + 22 : y + 9}
                                      fontSize={6.5}
                                      textAnchor="end"
                                      fontWeight={400}
                                      fontFamily="IBM Plex Mono, monospace"
                                      fill={
                                        cell.exceedsMaxPipeCapacity
                                          ? '#dc2626'
                                          : cell.isFallbackMaterial
                                          ? '#1d4ed8'
                                          : '#64748b'
                                      }
                                    >
                                      di{' '}
                                      {formatPipeDim(
                                        cell.selectedInnerMm,
                                        PIPE_SPEC_TABLES[cell.selectedSpecId] ?? pipeSpec
                                      )}
                                    </text>
                                  )}
                                </g>
                              )}

                              {showAddPrvTarget && (
                                <g
                                  transform={`translate(${x}, ${y + prvYOffset})`}
                                  onMouseEnter={() => {
                                    setHoveredRowIdx(rIdx);
                                    setHoveredTargetKey(addTargetKey);
                                    setHoveredSegment({
                                      target: col.target,
                                      targetKey: col.key,
                                      rowIdx: rIdx,
                                    });
                                  }}
                                  onMouseLeave={() => {
                                    if (hoveredTargetKey === addTargetKey) {
                                      setHoveredTargetKey(null);
                                    }
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddPrv(col.target, r.input.id);
                                    setIsAddPrvMode(false);
                                  }}
                                  onContextMenu={(e) =>
                                    openSegmentContextMenu(
                                      e,
                                      col.target,
                                      r.input.id,
                                      r.input.floorLabel,
                                      false,
                                      cell.isServed
                                    )
                                  }
                                  style={{ cursor: 'crosshair' }}
                                  data-testid={`add-prv-D${d.dropperIndex}-${r.input.floorLabel}`}
                                >
                                  <title>
                                    Add PRV station on D{d.dropperIndex} at Level {r.input.floorLabel}
                                  </title>
                                  {hoveredSegment?.targetKey === col.key &&
                                  hoveredSegment?.rowIdx === rIdx ? (
                                    <>
                                      <rect
                                        x={-6.5}
                                        y={-6.5}
                                        width={13}
                                        height={13}
                                        rx={3}
                                        fill={isAddHovered ? '#d97706' : '#fffbeb'}
                                        stroke="#d97706"
                                        strokeWidth={1.1}
                                      />
                                      <line
                                        x1={-3}
                                        y1={0}
                                        x2={3}
                                        y2={0}
                                        stroke={isAddHovered ? '#ffffff' : '#b45309'}
                                        strokeWidth={1.4}
                                        strokeLinecap="round"
                                      />
                                      <line
                                        x1={0}
                                        y1={-3}
                                        x2={0}
                                        y2={3}
                                        stroke={isAddHovered ? '#ffffff' : '#b45309'}
                                        strokeWidth={1.4}
                                        strokeLinecap="round"
                                      />
                                    </>
                                  ) : (
                                    <circle
                                      r={3.5}
                                      fill="#fffbeb"
                                      stroke="#d97706"
                                      strokeWidth={1.1}
                                      opacity={0.75}
                                    />
                                  )}
                                </g>
                              )}

                              {cell.hasPrv && cell.prvDetail && (
                                <g
                                  transform={`translate(${x}, ${y + prvYOffset})`}
                                  opacity={isSourcePrv ? 0.28 : 1}
                                  onMouseEnter={() => {
                                    setHoveredRowIdx(rIdx);
                                    if (isInteractive) setHoveredTargetKey(prvTargetKey);
                                  }}
                                  onMouseLeave={() => {
                                    if (hoveredTargetKey === prvTargetKey) {
                                      setHoveredTargetKey(null);
                                    }
                                  }}
                                  onPointerDown={(e) =>
                                    startPrvDrag(
                                      e,
                                      r.input.id,
                                      r.input.floorLabel,
                                      rIdx,
                                      col.target,
                                      prvYOffset
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  onContextMenu={(e) =>
                                    openSegmentContextMenu(
                                      e,
                                      col.target,
                                      r.input.id,
                                      r.input.floorLabel,
                                      true,
                                      cell.isServed
                                    )
                                  }
                                  style={{
                                    cursor: isInteractive
                                      ? dragState?.started
                                        ? 'grabbing'
                                        : 'pointer'
                                      : 'default',
                                  }}
                                  data-testid={`prv-node-D${d.dropperIndex}-${r.input.floorLabel}`}
                                >
                                  <title>
                                    PRV D{d.dropperIndex} Level {r.input.floorLabel}:{' '}
                                    {cell.prvDetail.upstreamPressureBar.toFixed(2)} →{' '}
                                    {cell.prvDetail.downstreamPressureBar.toFixed(2)} bar (DN
                                    {cell.prvDetail.recommendedValveDn})
                                    {cell.prvDetail.isCustomSetPressure
                                      ? ` [Custom P2 Override; Global ${parameters.prvSetPressureBar.toFixed(2)} bar]`
                                      : ''}
                                    {isInteractive ? ' — Click to edit P2 or drag to move' : ''}
                                  </title>
                                  {isInteractive && (
                                    <rect
                                      x={-35}
                                      y={-9.5}
                                      width={isPrvHovered || isPrvSelected ? 61 : 45}
                                      height={19}
                                      rx={3}
                                      fill="transparent"
                                    />
                                  )}
                                  {(isPrvHovered || isPrvSelected) && (
                                    <rect
                                      x={-33.5}
                                      y={-8.5}
                                      width={isPrvHovered || isPrvSelected ? 58.5 : 42}
                                      height={17}
                                      rx={3.5}
                                      fill="none"
                                      stroke={
                                        isPrvSelected
                                          ? '#1d4ed8'
                                          : cell.prvDetail.cavitationWarning
                                          ? '#dc2626'
                                          : '#d97706'
                                      }
                                      strokeWidth={isPrvSelected ? 1.5 : 1.2}
                                      strokeDasharray={isPrvSelected ? undefined : '3 2'}
                                    />
                                  )}
                                  <rect
                                    x={-31}
                                    y={-7}
                                    width={23}
                                    height={14}
                                    rx={2.5}
                                    fill={
                                      cell.prvDetail.cavitationWarning
                                        ? '#fef2f2'
                                        : cell.prvDetail.isCustomSetPressure
                                        ? '#eff6ff'
                                        : '#fffbeb'
                                    }
                                    stroke={
                                      cell.prvDetail.cavitationWarning
                                        ? '#dc2626'
                                        : cell.prvDetail.isCustomSetPressure
                                        ? '#1d4ed8'
                                        : '#d97706'
                                    }
                                    strokeWidth={1}
                                  />
                                  <text
                                    x={-19.5}
                                    y={2.8}
                                    textAnchor="middle"
                                    fontSize={8}
                                    fontWeight={700}
                                    fontFamily="IBM Plex Mono, monospace"
                                    fill={
                                      cell.prvDetail.cavitationWarning
                                        ? '#991b1b'
                                        : cell.prvDetail.isCustomSetPressure
                                        ? '#1e40af'
                                        : '#92400e'
                                    }
                                  >
                                    PRV
                                  </text>
                                  <polygon
                                    points="-6,-5 6,-5 0,0 -6,5 6,5"
                                    fill={
                                      cell.prvDetail.cavitationWarning ? '#dc2626' : '#d97706'
                                    }
                                    stroke="#ffffff"
                                    strokeWidth={0.8}
                                  />
                                  {cell.prvDetail.isCustomSetPressure && (
                                    <circle
                                      cx={-31}
                                      cy={-7}
                                      r={2.4}
                                      fill="#1d4ed8"
                                      stroke="#ffffff"
                                      strokeWidth={0.8}
                                    />
                                  )}

                                  {isInteractive &&
                                    (isPrvHovered || isPrvSelected) &&
                                    !dragState?.started && (
                                      <g
                                        transform="translate(9, -7)"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeletePrv(col.target, r.input.id);
                                        }}
                                        style={{ cursor: 'pointer' }}
                                        data-testid={`delete-prv-D${d.dropperIndex}-${r.input.floorLabel}`}
                                      >
                                        <title>
                                          Remove PRV at D{d.dropperIndex} Level {r.input.floorLabel}
                                        </title>
                                        <rect
                                          x={0}
                                          y={0}
                                          width={14}
                                          height={14}
                                          rx={2.5}
                                          fill="#fef2f2"
                                          stroke="#dc2626"
                                          strokeWidth={1}
                                        />
                                        <line
                                          x1={4}
                                          y1={4}
                                          x2={10}
                                          y2={10}
                                          stroke="#dc2626"
                                          strokeWidth={1.4}
                                          strokeLinecap="round"
                                        />
                                        <line
                                          x1={10}
                                          y1={4}
                                          x2={4}
                                          y2={10}
                                          stroke="#dc2626"
                                          strokeWidth={1.4}
                                          strokeLinecap="round"
                                        />
                                      </g>
                                    )}
                                </g>
                              )}
                            </g>
                          );
                        })}

                        <text
                          x={x}
                          y={totalSvgHeight - 12}
                          fontSize={9.5}
                          fontWeight={700}
                          textAnchor="middle"
                          fill={
                            d.hasBoosterPump
                              ? d.isCustomBoosterPressure
                                ? '#1d4ed8'
                                : '#0369a1'
                              : color
                          }
                          onClick={(e) => {
                            if (!isInteractive) return;
                            e.stopPropagation();
                            if (d.hasBoosterPump) {
                              openBoosterEditor(col.target, `D${d.dropperIndex}`);
                            } else {
                              handleToggleBoosterPump(col.target, true);
                            }
                          }}
                          style={{ cursor: isInteractive ? 'pointer' : 'default' }}
                        >
                          {isInteractive && (
                            <title>
                              {d.hasBoosterPump
                                ? `D${d.dropperIndex} Booster (+${(
                                    d.boosterPressureBar ?? parameters.boosterPumpBoostBar
                                  ).toFixed(2)} bar${
                                    d.isCustomBoosterPressure ? ' · Custom' : ' · Global'
                                  }) — Click to edit boost pressure or remove pump`
                                : `D${d.dropperIndex} Gravity — Click to add Booster Pump (+${parameters.boosterPumpBoostBar.toFixed(
                                    2
                                  )} bar)`}
                            </title>
                          )}
                          D{d.dropperIndex} ({d.hasBoosterPump ? `Boost${d.isCustomBoosterPressure ? '*' : ''}` : 'Grav'})
                        </text>
                      </g>
                    );
                  }

                  // Sub-Dropper Column Rendering
                  const sd = col.summary;
                  const parentX = targetX({
                    kind: 'main',
                    dropperIndex: sd.parentDropperIndex,
                  });
                  const branchY = rowY(sd.branchRowIdx);
                  const branchHasPrv = Boolean(
                    rows[sd.branchRowIdx]?.subDropperCells[sd.id]?.hasPrv
                  );
                  const evalRowIndices: number[] = [];
                  rows.forEach((r, rIdx) => {
                    if (r.subDropperCells[sd.id]) evalRowIndices.push(rIdx);
                  });
                  const minEvalRow = evalRowIndices[0] ?? sd.branchRowIdx;
                  const maxEvalRow =
                    evalRowIndices[evalRowIndices.length - 1] ?? sd.branchRowIdx;

                  const isSourceSubBranch =
                    dragState?.started &&
                    dragState.kind === 'sub-branch' &&
                    dragState.subDropperId === sd.id;
                  const subBranchTargetKey = `sub-branch-${sd.id}`;
                  const isSubBranchHovered = hoveredTargetKey === subBranchTargetKey;

                  return (
                    <g key={`riser-${col.key}`}>
                      {/* Branch Feed Line & Draggable Takeoff Tee from Parent Main Dropper */}
                      <g
                        opacity={isSourceSubBranch ? 0.25 : 1}
                        onMouseEnter={() => {
                          setHoveredRowIdx(sd.branchRowIdx);
                          if (isInteractive) setHoveredTargetKey(subBranchTargetKey);
                        }}
                        onMouseLeave={() => {
                          if (hoveredTargetKey === subBranchTargetKey) {
                            setHoveredTargetKey(null);
                          }
                        }}
                        onPointerDown={(e) => startSubBranchDrag(e, sd)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          cursor: isInteractive
                            ? isAddPrvMode
                              ? 'crosshair'
                              : dragState?.started
                              ? 'grabbing'
                              : 'ns-resize'
                            : 'default',
                        }}
                        data-testid={`sub-branch-node-${sd.label}`}
                      >
                        {isInteractive && (
                          <title>
                            {sd.label} takeoff at D{sd.parentDropperIndex} Level{' '}
                            {sd.branchFloorLabel} — Drag vertically to relocate &amp; extend served
                            floors
                          </title>
                        )}
                        {isInteractive && (
                          <>
                            <rect
                              x={parentX - 10}
                              y={branchY - 10}
                              width={22}
                              height={20}
                              rx={4}
                              fill="transparent"
                            />
                            {x - parentX > 44 && (
                              <rect
                                x={parentX + 34}
                                y={branchY - 8}
                                width={x - parentX - 40}
                                height={16}
                                rx={3}
                                fill="transparent"
                              />
                            )}
                          </>
                        )}
                        <line
                          x1={parentX}
                          y1={branchY}
                          x2={x}
                          y2={branchY}
                          stroke={color}
                          strokeWidth={isSubBranchHovered ? 2.8 : 2.2}
                        />
                        {isSubBranchHovered && !isAddPrvMode && (
                          <>
                            <circle
                              cx={parentX}
                              cy={branchY}
                              r={8.5}
                              fill="rgba(8, 145, 178, 0.12)"
                              stroke={color}
                              strokeWidth={1.3}
                            />
                            <polyline
                              points={`${parentX - 3},${branchY - 10.5} ${parentX},${branchY - 13.5} ${parentX + 3},${branchY - 10.5}`}
                              fill="none"
                              stroke={color}
                              strokeWidth={1.3}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <polyline
                              points={`${parentX - 3},${branchY + 10.5} ${parentX},${branchY + 13.5} ${parentX + 3},${branchY + 10.5}`}
                              fill="none"
                              stroke={color}
                              strokeWidth={1.3}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </>
                        )}
                        <circle
                          cx={parentX}
                          cy={branchY}
                          r={isInteractive ? (isSubBranchHovered ? 5.2 : 4.5) : 3.8}
                          fill={color}
                          stroke="#ffffff"
                          strokeWidth={1.3}
                        />
                        <polyline
                          points={
                            branchHasPrv
                              ? `${x - 42},${branchY - 3} ${x - 36},${branchY} ${x - 42},${branchY + 3}`
                              : `${x - 13},${branchY - 3} ${x - 7},${branchY} ${x - 13},${branchY + 3}`
                          }
                          fill="none"
                          stroke={color}
                          strokeWidth={1.6}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>

                      {/* Sub-Dropper Inline Booster Pump Symbol / Interactive Add-Pump Slot */}
                      {(() => {
                        const subPumpKey = `sub-pump-${sd.id}`;
                        const isSubPumpHovered = hoveredPumpKey === subPumpKey;
                        const spanRight = branchHasPrv ? x - 44 : x - 16;
                        const availSpan = spanRight - parentX;
                        const pumpCx =
                          availSpan >= 32
                            ? Math.round(parentX + availSpan * 0.5)
                            : Math.round((parentX + x) * 0.5);

                        if (sd.hasBoosterPump) {
                          const effSubBoost =
                            sd.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                          const isCustomSub = sd.isCustomBoosterPressure;
                          const isSubPumpSelected = selectedBoosterPump?.key === `sub-${sd.id}`;
                          const accentStroke = isCustomSub ? '#1d4ed8' : '#0369a1';
                          const accentFill = isCustomSub ? '#eef2ff' : '#e0f2fe';
                          const hoverFill = isCustomSub ? '#dbeafe' : '#bae6fd';
                          const badgeWidth = isCustomSub ? 44 : 40;
                          return (
                            <g
                              data-testid={`schematic-pump-${sd.label}`}
                              style={{ cursor: isInteractive ? 'pointer' : 'default' }}
                              onMouseEnter={() => {
                                setHoveredRowIdx(sd.branchRowIdx);
                                if (isInteractive) setHoveredPumpKey(subPumpKey);
                              }}
                              onMouseLeave={() => {
                                if (hoveredPumpKey === subPumpKey) setHoveredPumpKey(null);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isInteractive) return;
                                openBoosterEditor(
                                  { kind: 'sub', subDropperId: sd.id },
                                  sd.label
                                );
                              }}
                            >
                              <title>
                                {sd.label} Inline Booster Pump (+{effSubBoost.toFixed(2)} bar
                                {isCustomSub
                                  ? ` · Custom override; global ${parameters.boosterPumpBoostBar.toFixed(
                                      2
                                    )} bar`
                                  : ' · Global default'}
                                )
                                {isInteractive
                                  ? ' — Click to edit boost pressure or remove pump'
                                  : ''}
                              </title>
                              <circle cx={pumpCx} cy={branchY} r={10.5} fill="#ffffff" />
                              <circle
                                cx={pumpCx}
                                cy={branchY}
                                r={isSubPumpSelected || (isSubPumpHovered && isInteractive) ? 9.2 : 8.5}
                                fill={
                                  isSubPumpSelected || (isSubPumpHovered && isInteractive)
                                    ? hoverFill
                                    : accentFill
                                }
                                stroke={accentStroke}
                                strokeWidth={isCustomSub || isSubPumpSelected ? 1.9 : 1.6}
                              />
                              <polygon
                                points={`${pumpCx - 3},${branchY - 4} ${pumpCx + 4.5},${branchY} ${pumpCx - 3},${branchY + 4}`}
                                fill={accentStroke}
                              />
                              {isCustomSub && (
                                <circle
                                  cx={pumpCx + 6.5}
                                  cy={branchY - 6.5}
                                  r={2.4}
                                  fill="#1d4ed8"
                                  stroke="#ffffff"
                                  strokeWidth={0.9}
                                />
                              )}
                              <rect
                                x={pumpCx - badgeWidth / 2}
                                y={branchY - 22}
                                width={badgeWidth}
                                height={11}
                                fill={
                                  isSubPumpSelected || (isSubPumpHovered && isInteractive)
                                    ? hoverFill
                                    : accentFill
                                }
                                stroke={isCustomSub || isSubPumpSelected ? '#1d4ed8' : '#7dd3fc'}
                                strokeWidth={0.8}
                              />
                              <text
                                x={pumpCx}
                                y={branchY - 14}
                                textAnchor="middle"
                                fontFamily="'IBM Plex Mono', monospace"
                                fontSize="7.5"
                                fontWeight="700"
                                fill={accentStroke}
                              >
                                +{effSubBoost.toFixed(1)}b{isCustomSub ? '*' : ''}
                              </text>
                            </g>
                          );
                        }

                        if (!isInteractive || availSpan < 34) return null;

                        return (
                          <g
                            data-testid={`schematic-add-pump-${sd.label}`}
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => {
                              setHoveredRowIdx(sd.branchRowIdx);
                              setHoveredPumpKey(subPumpKey);
                            }}
                            onMouseLeave={() => {
                              if (hoveredPumpKey === subPumpKey) setHoveredPumpKey(null);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleBoosterPump(
                                { kind: 'sub', subDropperId: sd.id },
                                true
                              );
                            }}
                          >
                            <title>
                              Add inline booster pump (+{parameters.boosterPumpBoostBar.toFixed(1)}{' '}
                              bar) to {sd.label}
                            </title>
                            <circle
                              cx={pumpCx}
                              cy={branchY}
                              r={isSubPumpHovered ? 8 : 6.5}
                              fill={isSubPumpHovered ? '#e0f2fe' : '#ffffff'}
                              stroke={isSubPumpHovered ? '#0369a1' : '#94a3b8'}
                              strokeWidth={1.1}
                              strokeDasharray={isSubPumpHovered ? undefined : '2.2 1.8'}
                              opacity={isSubPumpHovered ? 1 : 0.72}
                            />
                            <line
                              x1={pumpCx - 2.6}
                              y1={branchY}
                              x2={pumpCx + 2.6}
                              y2={branchY}
                              stroke={isSubPumpHovered ? '#0369a1' : '#64748b'}
                              strokeWidth={1.2}
                            />
                            <line
                              x1={pumpCx}
                              y1={branchY - 2.6}
                              x2={pumpCx}
                              y2={branchY + 2.6}
                              stroke={isSubPumpHovered ? '#0369a1' : '#64748b'}
                              strokeWidth={1.2}
                            />
                            {isSubPumpHovered && (
                              <>
                                <rect
                                  x={pumpCx - 20}
                                  y={branchY - 22}
                                  width={40}
                                  height={11}
                                  fill="#e0f2fe"
                                  stroke="#7dd3fc"
                                  strokeWidth={0.8}
                                />
                                <text
                                  x={pumpCx}
                                  y={branchY - 14}
                                  textAnchor="middle"
                                  fontFamily="'IBM Plex Mono', monospace"
                                  fontSize="7.5"
                                  fontWeight="700"
                                  fill="#0369a1"
                                >
                                  +Pump
                                </text>
                              </>
                            )}
                          </g>
                        );
                      })()}

                      {/* Sub-Dropper Vertical Segments between evaluated rows */}
                      {evalRowIndices.map((rIdx, i) => {
                        if (i === 0) return null;
                        const upperR = evalRowIndices[i - 1];
                        const lowerR = rIdx;
                        const segCell =
                          lowerR <= sd.branchRowIdx
                            ? rows[upperR].subDropperCells[sd.id]
                            : rows[lowerR].subDropperCells[sd.id];
                        if (!segCell) return null;
                        const segW = segCell.selectedNominalMm
                          ? Math.max(2, Math.min(5.5, segCell.selectedNominalMm / 36))
                          : 2;
                        return (
                          <line
                            key={`sd-seg-${sd.id}-${upperR}-${lowerR}`}
                            x1={x}
                            y1={rowY(upperR)}
                            x2={x}
                            y2={rowY(lowerR)}
                            stroke={segCell.exceedsMaxPipeCapacity ? '#dc2626' : color}
                            strokeWidth={segW}
                            strokeDasharray={segCell.isExpressPassThrough ? '4 3' : undefined}
                          />
                        );
                      })}

                      {/* Terminal End Caps */}
                      {minEvalRow < sd.branchRowIdx && (
                        <line
                          x1={x - 5}
                          y1={rowY(minEvalRow)}
                          x2={x + 5}
                          y2={rowY(minEvalRow)}
                          stroke={color}
                          strokeWidth={2.2}
                        />
                      )}
                      {maxEvalRow > sd.branchRowIdx && (
                        <line
                          x1={x - 5}
                          y1={rowY(maxEvalRow)}
                          x2={x + 5}
                          y2={rowY(maxEvalRow)}
                          stroke={color}
                          strokeWidth={2.2}
                        />
                      )}

                      {/* Floor Nodes, Telescoping Size Callouts, Takeoffs, and PRVs on Sub-Dropper */}
                      {evalRowIndices.map((rIdx) => {
                        const r = rows[rIdx];
                        const cell = r.subDropperCells[sd.id];
                        if (!cell) return null;
                        const y = rowY(rIdx);
                        const isRoof = r.input.supplyMode === SupplyMode.ROOF_HEADER;

                        const showSizeCallout = (() => {
                          if (!cell.selectedNominalMm) return false;
                          if (rIdx === sd.branchRowIdx) return true;
                          if (rIdx < sd.branchRowIdx) {
                            const below = rows[rIdx + 1]?.subDropperCells[sd.id];
                            return (
                              rIdx === minEvalRow ||
                              !below ||
                              below.selectedNominalMm !== cell.selectedNominalMm ||
                              below.selectedSpecId !== cell.selectedSpecId
                            );
                          }
                          const above = rows[rIdx - 1]?.subDropperCells[sd.id];
                          return (
                            rIdx === maxEvalRow ||
                            !above ||
                            above.selectedNominalMm !== cell.selectedNominalMm ||
                            above.selectedSpecId !== cell.selectedSpecId
                          );
                        })();

                        const isSourceTapping =
                          dragState?.started &&
                          dragState.kind === 'tapping' &&
                          dragState.floorId === r.input.id &&
                          isSameRiser(dragState.sourceTarget, col.target);

                        const isSourcePrv =
                          dragState?.started &&
                          dragState.kind === 'prv' &&
                          dragState.sourceFloorId === r.input.id &&
                          isSameRiser(dragState.sourceTarget, col.target);

                        const tapTargetKey = `tap-${col.key}-${r.input.id}`;
                        const prvTargetKey = `prv-${col.key}-${r.input.id}`;
                        const addTargetKey = `add-prv-${col.key}-${r.input.id}`;
                        const isTapHovered = hoveredTargetKey === tapTargetKey;
                        const isPrvHovered = hoveredTargetKey === prvTargetKey;
                        const isAddHovered = hoveredTargetKey === addTargetKey;

                        const isPrvSelected =
                          selectedPrv?.targetKey === col.key &&
                          selectedPrv?.floorId === r.input.id;

                        const overPressure =
                          cell.workingPressureBar !== null &&
                          cell.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;

                        const prvYOffset = getPrvYOffset(col.target, rIdx, cell.flowDirection);
                        const showAddPrvTarget =
                          isInteractive &&
                          !isRoof &&
                          !cell.hasPrv &&
                          !dragState?.started &&
                          isAddPrvMode;

                        return (
                          <g key={`sd-node-${sd.id}-${r.input.id}`}>
                            {isInteractive && !isRoof && (
                              <rect
                                x={x - 10}
                                y={y - rowHeight / 2}
                                width={20}
                                height={rowHeight}
                                fill="transparent"
                                style={{
                                  cursor: isAddPrvMode && !cell.hasPrv ? 'crosshair' : undefined,
                                }}
                                onMouseEnter={() => {
                                  setHoveredRowIdx(rIdx);
                                  setHoveredSegment({
                                    target: col.target,
                                    targetKey: col.key,
                                    rowIdx: rIdx,
                                  });
                                }}
                                onMouseLeave={() => {
                                  if (
                                    hoveredSegment?.targetKey === col.key &&
                                    hoveredSegment?.rowIdx === rIdx
                                  ) {
                                    setHoveredSegment(null);
                                  }
                                }}
                                onClick={(e) => {
                                  if (isAddPrvMode && !cell.hasPrv) {
                                    e.stopPropagation();
                                    handleAddPrv(col.target, r.input.id);
                                    setIsAddPrvMode(false);
                                  }
                                }}
                                onContextMenu={(e) =>
                                  openSegmentContextMenu(
                                    e,
                                    col.target,
                                    r.input.id,
                                    r.input.floorLabel,
                                    cell.hasPrv,
                                    cell.isServed
                                  )
                                }
                              />
                            )}

                            {cell.isServed && (
                              <g
                                opacity={isSourceTapping ? 0.3 : 1}
                                onMouseEnter={() => {
                                  setHoveredRowIdx(rIdx);
                                  if (isInteractive) setHoveredTargetKey(tapTargetKey);
                                }}
                                onMouseLeave={() => {
                                  if (hoveredTargetKey === tapTargetKey) {
                                    setHoveredTargetKey(null);
                                  }
                                }}
                                onPointerDown={(e) =>
                                  startTappingDrag(
                                    e,
                                    r.input.id,
                                    r.input.floorLabel,
                                    rIdx,
                                    col.target,
                                    cell.assignedFloorLu,
                                    cell.isSplitLoad
                                  )
                                }
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  cursor: isInteractive
                                    ? isAddPrvMode
                                      ? 'crosshair'
                                      : 'grab'
                                    : 'default',
                                }}
                                data-split={cell.isSplitLoad ? 'true' : 'false'}
                                data-testid={`tapping-node-${sd.label}-${r.input.floorLabel}`}
                              >
                                <title>
                                  {`Level ${r.input.floorLabel} · ${sd.label}: ${cell.assignedFloorLu.toFixed(1)} LU (${
                                    cell.isSplitLoad
                                      ? `${Math.round(cell.loadFraction * 100)}% Split Load`
                                      : '100% Full Load'
                                  }) · Cum ${cell.cumulativeLu.toFixed(1)} LU · Q = ${cell.flowRateLs.toFixed(2)} L/s${
                                    cell.workingPressureBar !== null
                                      ? ` · P = ${cell.workingPressureBar.toFixed(2)} bar`
                                      : ''
                                  }${isInteractive ? ' — Click to configure split or drag to move' : ''}`}
                                </title>
                                {isInteractive && (
                                  <rect
                                    x={x + 4}
                                    y={y - 7}
                                    width={28}
                                    height={16}
                                    rx={4}
                                    fill="transparent"
                                  />
                                )}
                                <line
                                  x1={x}
                                  y1={y}
                                  x2={x + 19}
                                  y2={y}
                                  stroke={color}
                                  strokeWidth={isTapHovered ? 2.4 : 1.75}
                                />
                                {(isTapHovered ||
                                  (selectedTapNode?.floorId === r.input.id &&
                                    selectedTapNode?.targetKey === col.key)) &&
                                  !isAddPrvMode && (
                                    <circle
                                      cx={x + 19}
                                      cy={y}
                                      r={7.5}
                                      fill="none"
                                      stroke={
                                        selectedTapNode?.floorId === r.input.id &&
                                        selectedTapNode?.targetKey === col.key
                                          ? '#1d4ed8'
                                          : color
                                      }
                                      strokeWidth={1.5}
                                      strokeOpacity={0.8}
                                    />
                                  )}
                                {renderTappingDot(x + 19, y, color, cell.isSplitLoad)}
                                {cell.workingPressureBar !== null && (
                                  <text
                                    x={x + 26}
                                    y={y + 3}
                                    fontSize={8.5}
                                    fontWeight={
                                      overPressure || cell.prvDetail?.cavitationWarning
                                        ? 700
                                        : 400
                                    }
                                    fontFamily="IBM Plex Mono, monospace"
                                    fill={
                                      overPressure || cell.prvDetail?.cavitationWarning
                                        ? '#dc2626'
                                        : '#0e7490'
                                    }
                                  >
                                    {cell.hasPrv && cell.prvDetail
                                      ? `${cell.prvDetail.upstreamPressureBar.toFixed(1)}→${cell.prvDetail.downstreamPressureBar.toFixed(1)}b${cell.prvDetail.isCustomSetPressure ? '*' : ''}${overPressure ? '!' : ''}`
                                      : `${cell.workingPressureBar.toFixed(2)}b${overPressure ? '!' : ''}`}
                                    {cell.isSplitLoad && (
                                      <tspan fill="#1d4ed8" fontWeight={600}>
                                        {` ·${Math.round(cell.loadFraction * 100)}%`}
                                      </tspan>
                                    )}
                                  </text>
                                )}
                              </g>
                            )}

                            {!cell.isServed && cell.hasPrv && cell.prvDetail && (
                              <text
                                x={x + 12}
                                y={y + 3}
                                fontSize={8.5}
                                fontWeight={cell.prvDetail.cavitationWarning ? 700 : 400}
                                fontFamily="IBM Plex Mono, monospace"
                                fill={cell.prvDetail.cavitationWarning ? '#dc2626' : '#0e7490'}
                              >
                                {cell.prvDetail.upstreamPressureBar.toFixed(1)}→
                                {cell.prvDetail.downstreamPressureBar.toFixed(1)}b
                                {cell.prvDetail.isCustomSetPressure ? '*' : ''}
                              </text>
                            )}

                            {showSizeCallout &&
                              cell.selectedNominalMm &&
                              (() => {
                                const isBranchRow = rIdx === sd.branchRowIdx;
                                const aboveSubCell = rows[rIdx - 1]?.subDropperCells[sd.id];
                                const belowSubCell = rows[rIdx + 1]?.subDropperCells[sd.id];
                                const aboveHasUpPrv = Boolean(
                                  aboveSubCell?.hasPrv && aboveSubCell.flowDirection === 'up'
                                );
                                const belowHasDownPrv = Boolean(
                                  belowSubCell?.hasPrv && belowSubCell.flowDirection === 'down'
                                );

                                let calloutX = x - 5;
                                let calloutY = y + 3;
                                if (isBranchRow) {
                                  if (cell.hasPrv || (aboveHasUpPrv && belowHasDownPrv)) {
                                    // Place cleanly above the horizontal branch pipe to the left of the [PRV] badge
                                    calloutX = x - 38;
                                    calloutY = y - 6;
                                  } else if (aboveHasUpPrv) {
                                    // Place below the horizontal branch line to clear an up-arm PRV badge directly above
                                    calloutX = x - 5;
                                    calloutY = y + 12;
                                  } else {
                                    calloutX = x - 5;
                                    calloutY = y - 5.5;
                                  }
                                }

                                return (
                                  <g pointerEvents="none">
                                    <text
                                      x={calloutX}
                                      y={isBranchRow ? calloutY : calloutY - 2}
                                      fontSize={8.5}
                                      textAnchor="end"
                                      fontWeight={600}
                                      fontFamily="IBM Plex Mono, monospace"
                                      fill={
                                        cell.exceedsMaxPipeCapacity
                                          ? '#dc2626'
                                          : cell.isFallbackMaterial
                                          ? '#1d4ed8'
                                          : '#0f172a'
                                      }
                                    >
                                      {cell.isFallbackMaterial
                                        ? `${getPipeSpecBadgeLabel(cell.selectedSpecId)} `
                                        : ''}
                                      Ø{cell.selectedNominalMm}
                                      {cell.exceedsMaxPipeCapacity ? '!' : ''}
                                    </text>
                                    {!isBranchRow && cell.selectedInnerMm !== null && (
                                      <text
                                        x={calloutX}
                                        y={calloutY + 6}
                                        fontSize={6.5}
                                        textAnchor="end"
                                        fontWeight={400}
                                        fontFamily="IBM Plex Mono, monospace"
                                        fill={
                                          cell.exceedsMaxPipeCapacity
                                            ? '#dc2626'
                                            : cell.isFallbackMaterial
                                            ? '#1d4ed8'
                                            : '#64748b'
                                        }
                                      >
                                        di{' '}
                                        {formatPipeDim(
                                          cell.selectedInnerMm,
                                          PIPE_SPEC_TABLES[cell.selectedSpecId] ?? pipeSpec
                                        )}
                                      </text>
                                    )}
                                  </g>
                                );
                              })()}

                            {showAddPrvTarget && (
                              <g
                                transform={`translate(${x}, ${y + prvYOffset})`}
                                onMouseEnter={() => {
                                  setHoveredRowIdx(rIdx);
                                  setHoveredTargetKey(addTargetKey);
                                  setHoveredSegment({
                                    target: col.target,
                                    targetKey: col.key,
                                    rowIdx: rIdx,
                                  });
                                }}
                                onMouseLeave={() => {
                                  if (hoveredTargetKey === addTargetKey) {
                                    setHoveredTargetKey(null);
                                  }
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddPrv(col.target, r.input.id);
                                  setIsAddPrvMode(false);
                                }}
                                onContextMenu={(e) =>
                                  openSegmentContextMenu(
                                    e,
                                    col.target,
                                    r.input.id,
                                    r.input.floorLabel,
                                    false,
                                    cell.isServed
                                  )
                                }
                                style={{ cursor: 'crosshair' }}
                                data-testid={`add-prv-${sd.label}-${r.input.floorLabel}`}
                              >
                                <title>
                                  Add PRV station on {sd.label} at Level {r.input.floorLabel}
                                </title>
                                {hoveredSegment?.targetKey === col.key &&
                                hoveredSegment?.rowIdx === rIdx ? (
                                  <>
                                    <rect
                                      x={-6.5}
                                      y={-6.5}
                                      width={13}
                                      height={13}
                                      rx={3}
                                      fill={isAddHovered ? '#d97706' : '#fffbeb'}
                                      stroke="#d97706"
                                      strokeWidth={1.1}
                                    />
                                    <line
                                      x1={-3}
                                      y1={0}
                                      x2={3}
                                      y2={0}
                                      stroke={isAddHovered ? '#ffffff' : '#b45309'}
                                      strokeWidth={1.4}
                                      strokeLinecap="round"
                                    />
                                    <line
                                      x1={0}
                                      y1={-3}
                                      x2={0}
                                      y2={3}
                                      stroke={isAddHovered ? '#ffffff' : '#b45309'}
                                      strokeWidth={1.4}
                                      strokeLinecap="round"
                                    />
                                  </>
                                ) : (
                                  <circle
                                    r={3.5}
                                    fill="#fffbeb"
                                    stroke="#d97706"
                                    strokeWidth={1.1}
                                    opacity={0.75}
                                  />
                                )}
                              </g>
                            )}

                            {cell.hasPrv && cell.prvDetail && (
                              <g
                                transform={`translate(${x}, ${y + prvYOffset})`}
                                opacity={isSourcePrv ? 0.28 : 1}
                                onMouseEnter={() => {
                                  setHoveredRowIdx(rIdx);
                                  if (isInteractive) setHoveredTargetKey(prvTargetKey);
                                }}
                                onMouseLeave={() => {
                                  if (hoveredTargetKey === prvTargetKey) {
                                    setHoveredTargetKey(null);
                                  }
                                }}
                                onPointerDown={(e) =>
                                  startPrvDrag(
                                    e,
                                    r.input.id,
                                    r.input.floorLabel,
                                    rIdx,
                                    col.target,
                                    prvYOffset
                                  )
                                }
                                onClick={(e) => e.stopPropagation()}
                                onContextMenu={(e) =>
                                  openSegmentContextMenu(
                                    e,
                                    col.target,
                                    r.input.id,
                                    r.input.floorLabel,
                                    true,
                                    cell.isServed
                                  )
                                }
                                style={{
                                  cursor: isInteractive
                                    ? dragState?.started
                                      ? 'grabbing'
                                      : 'pointer'
                                    : 'default',
                                }}
                                data-testid={`prv-node-${sd.label}-${r.input.floorLabel}`}
                              >
                                <title>
                                  PRV {sd.label} Level {r.input.floorLabel}:{' '}
                                  {cell.prvDetail.upstreamPressureBar.toFixed(2)} →{' '}
                                  {cell.prvDetail.downstreamPressureBar.toFixed(2)} bar (DN
                                  {cell.prvDetail.recommendedValveDn})
                                  {cell.prvDetail.isCustomSetPressure
                                    ? ` [Custom P2 Override; Global ${parameters.prvSetPressureBar.toFixed(2)} bar]`
                                    : ''}
                                  {isInteractive ? ' — Click to edit P2 or drag to move' : ''}
                                </title>
                                {isInteractive && (
                                  <rect
                                    x={-35}
                                    y={-9.5}
                                    width={isPrvHovered || isPrvSelected ? 61 : 45}
                                    height={19}
                                    rx={3}
                                    fill="transparent"
                                  />
                                )}
                                {(isPrvHovered || isPrvSelected) && (
                                  <rect
                                    x={-33.5}
                                    y={-8.5}
                                    width={isPrvHovered || isPrvSelected ? 58.5 : 42}
                                    height={17}
                                    rx={3.5}
                                    fill="none"
                                    stroke={
                                      isPrvSelected
                                        ? '#1d4ed8'
                                        : cell.prvDetail.cavitationWarning
                                        ? '#dc2626'
                                        : '#d97706'
                                    }
                                    strokeWidth={isPrvSelected ? 1.5 : 1.2}
                                    strokeDasharray={isPrvSelected ? undefined : '3 2'}
                                  />
                                )}
                                <rect
                                  x={-31}
                                  y={-7}
                                  width={23}
                                  height={14}
                                  rx={2.5}
                                  fill={
                                    cell.prvDetail.cavitationWarning
                                      ? '#fef2f2'
                                      : cell.prvDetail.isCustomSetPressure
                                      ? '#eff6ff'
                                      : '#fffbeb'
                                  }
                                  stroke={
                                    cell.prvDetail.cavitationWarning
                                      ? '#dc2626'
                                      : cell.prvDetail.isCustomSetPressure
                                      ? '#1d4ed8'
                                      : '#d97706'
                                  }
                                  strokeWidth={1}
                                />
                                <text
                                  x={-19.5}
                                  y={2.8}
                                  textAnchor="middle"
                                  fontSize={8}
                                  fontWeight={700}
                                  fontFamily="IBM Plex Mono, monospace"
                                  fill={
                                    cell.prvDetail.cavitationWarning
                                      ? '#991b1b'
                                      : cell.prvDetail.isCustomSetPressure
                                      ? '#1e40af'
                                      : '#92400e'
                                  }
                                >
                                  PRV
                                </text>
                                <polygon
                                  points="-6,-5 6,-5 0,0 -6,5 6,5"
                                  fill={
                                    cell.prvDetail.cavitationWarning ? '#dc2626' : '#d97706'
                                  }
                                  stroke="#ffffff"
                                  strokeWidth={0.8}
                                />
                                {cell.prvDetail.isCustomSetPressure && (
                                  <circle
                                    cx={-31}
                                    cy={-7}
                                    r={2.4}
                                    fill="#1d4ed8"
                                    stroke="#ffffff"
                                    strokeWidth={0.8}
                                  />
                                )}

                                {isInteractive &&
                                  (isPrvHovered || isPrvSelected) &&
                                  !dragState?.started && (
                                    <g
                                      transform="translate(9, -7)"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeletePrv(col.target, r.input.id);
                                      }}
                                      style={{ cursor: 'pointer' }}
                                      data-testid={`delete-prv-${sd.label}-${r.input.floorLabel}`}
                                    >
                                      <title>
                                        Remove PRV at {sd.label} Level {r.input.floorLabel}
                                      </title>
                                      <rect
                                        x={0}
                                        y={0}
                                        width={14}
                                        height={14}
                                        rx={2.5}
                                        fill="#fef2f2"
                                        stroke="#dc2626"
                                        strokeWidth={1}
                                      />
                                      <line
                                        x1={4}
                                        y1={4}
                                        x2={10}
                                        y2={10}
                                        stroke="#dc2626"
                                        strokeWidth={1.4}
                                        strokeLinecap="round"
                                      />
                                      <line
                                        x1={10}
                                        y1={4}
                                        x2={4}
                                        y2={10}
                                        stroke="#dc2626"
                                        strokeWidth={1.4}
                                        strokeLinecap="round"
                                      />
                                    </g>
                                  )}
                              </g>
                            )}
                          </g>
                        );
                      })}

                      {/* Sub-Dropper Footer Label */}
                      <text
                        x={x}
                        y={totalSvgHeight - 12}
                        fontSize={9}
                        fontWeight={700}
                        textAnchor="middle"
                        fill={
                          sd.hasBoosterPump
                            ? sd.isCustomBoosterPressure
                              ? '#1d4ed8'
                              : '#0369a1'
                            : color
                        }
                        onClick={(e) => {
                          if (!isInteractive) return;
                          e.stopPropagation();
                          if (sd.hasBoosterPump) {
                            openBoosterEditor(col.target, sd.label);
                          } else {
                            handleToggleBoosterPump(col.target, true);
                          }
                        }}
                        style={{ cursor: isInteractive ? 'pointer' : 'default' }}
                      >
                        {isInteractive && (
                          <title>
                            {sd.hasBoosterPump
                              ? `${sd.label} Inline Booster (+${(
                                  sd.boosterPressureBar ?? parameters.boosterPumpBoostBar
                                ).toFixed(2)} bar${
                                  sd.isCustomBoosterPressure ? ' · Custom' : ' · Global'
                                }) — Click to edit boost pressure or remove pump`
                              : `${sd.label} — Click to add inline booster pump (+${parameters.boosterPumpBoostBar.toFixed(
                                  2
                                )} bar)`}
                          </title>
                        )}
                        {sd.label} (
                        {sd.hasBoosterPump
                          ? `Boost${sd.isCustomBoosterPressure ? '*' : ''}`
                          : sd.zoneType === 'Booster'
                          ? '←Boost'
                          : 'Grav'}{' '}
                        · ←D{sd.parentDropperIndex}@{sd.branchFloorLabel})
                      </text>
                    </g>
                  );
                })}

                {/* Live Drag Ghost Overlay */}
                {dragState?.started &&
                  dragState.kind === 'tapping' &&
                  (() => {
                    const srcX = targetX(dragState.sourceTarget);
                    const tgtX = dragState.isNewMainRiser
                      ? columnX(numColumns)
                      : targetX(dragState.targetTarget);
                    const y = rowY(dragState.rowIdx);
                    const tgtCol = orderedColumns.find((c) =>
                      isSameRiser(c.target, dragState.targetTarget)
                    );
                    const tgtColor = dragState.isNewMainRiser
                      ? '#1d4ed8'
                      : tgtCol?.color ?? '#1d4ed8';
                    const isChanged =
                      dragState.isNewMainRiser ||
                      !isSameRiser(dragState.targetTarget, dragState.sourceTarget);

                    return (
                      <g pointerEvents="none">
                        <line
                          x1={srcX}
                          y1={y}
                          x2={dragState.pointerX}
                          y2={y}
                          stroke="#1d4ed8"
                          strokeWidth={1.6}
                          strokeDasharray="4 3"
                        />
                        {isChanged && (
                          <g>
                            <line
                              x1={tgtX}
                              y1={y}
                              x2={tgtX + 19}
                              y2={y}
                              stroke={tgtColor}
                              strokeWidth={2.2}
                            />
                            <circle
                              cx={tgtX + 19}
                              cy={y}
                              r={7}
                              fill="none"
                              stroke={tgtColor}
                              strokeWidth={1.8}
                            />
                          </g>
                        )}
                        <circle
                          cx={dragState.pointerX}
                          cy={y}
                          r={5.5}
                          fill={tgtColor}
                          stroke="#ffffff"
                          strokeWidth={2}
                        />
                        <rect
                          x={dragState.pointerX + 10}
                          y={y - 10}
                          width={84}
                          height={18}
                          rx={3}
                          fill="#0f172a"
                        />
                        <text
                          x={dragState.pointerX + 15}
                          y={y + 2}
                          fontSize={8.5}
                          fontWeight={600}
                          fontFamily="IBM Plex Mono, monospace"
                          fill="#ffffff"
                        >
                          L{dragState.floorLabel} →{' '}
                          {dragState.isNewMainRiser
                            ? `D${numDroppers + 1}`
                            : formatTargetLabel(dragState.targetTarget)}
                        </text>
                      </g>
                    );
                  })()}

                {dragState?.started &&
                  (dragState.kind === 'prv' ||
                    (dragState.kind === 'new-prv' && dragState.insideSvg)) &&
                  (() => {
                    const tgtX = targetX(dragState.targetTarget);
                    const tgtCell = getCellForTarget(
                      dragState.targetRowIdx,
                      dragState.targetTarget
                    );
                    const flowDir =
                      dragState.targetTarget.kind === 'sub' &&
                      tgtCell &&
                      'flowDirection' in tgtCell
                        ? tgtCell.flowDirection
                        : undefined;
                    const tgtY =
                      rowY(dragState.targetRowIdx) +
                      getPrvYOffset(dragState.targetTarget, dragState.targetRowIdx, flowDir);
                    const previewPrv =
                      livePreview?.kind === 'prv' || livePreview?.kind === 'new-prv'
                        ? livePreview.prvDetail
                        : null;
                    const isCavitation = Boolean(previewPrv?.cavitationWarning);
                    const accent = isCavitation ? '#dc2626' : '#d97706';

                    return (
                      <g pointerEvents="none">
                        <circle
                          cx={tgtX}
                          cy={tgtY}
                          r={8}
                          fill={
                            isCavitation
                              ? 'rgba(220,38,38,0.12)'
                              : 'rgba(217,119,6,0.12)'
                          }
                          stroke={accent}
                          strokeWidth={1.6}
                          strokeDasharray="3 2"
                        />
                        <line
                          x1={dragState.pointerX}
                          y1={dragState.pointerY}
                          x2={tgtX}
                          y2={tgtY}
                          stroke={accent}
                          strokeWidth={1.2}
                          strokeDasharray="3 2"
                        />
                        <g transform={`translate(${dragState.pointerX}, ${dragState.pointerY})`}>
                          <polygon
                            points="-6,-5 6,-5 0,0 -6,5 6,5"
                            fill={accent}
                            stroke="#ffffff"
                            strokeWidth={1}
                          />
                          <rect
                            x={9}
                            y={-9}
                            width={126}
                            height={18}
                            rx={3}
                            fill={isCavitation ? '#991b1b' : '#0f172a'}
                            stroke={accent}
                            strokeWidth={1}
                          />
                          <text
                            x={14}
                            y={3}
                            fontSize={8.5}
                            fontWeight={700}
                            fontFamily="IBM Plex Mono, monospace"
                            fill="#ffffff"
                          >
                            {previewPrv
                              ? `PRV ${previewPrv.upstreamPressureBar.toFixed(1)}→${previewPrv.downstreamPressureBar.toFixed(1)}b (${previewPrv.pressureRatio.toFixed(2)}x)`
                              : `${formatTargetLabel(dragState.targetTarget)} L${dragState.targetFloorLabel}`}
                          </text>
                        </g>
                      </g>
                    );
                  })()}

                {dragState?.started &&
                  dragState.kind === 'sub-branch' &&
                  (() => {
                    const parentX = targetX({
                      kind: 'main',
                      dropperIndex: dragState.parentDropperIndex,
                    });
                    const subX = targetX({
                      kind: 'sub',
                      subDropperId: dragState.subDropperId,
                    });
                    const subCol = orderedColumns.find(
                      (c) =>
                        c.kind === 'sub' && c.subDropperId === dragState.subDropperId
                    );
                    const accent = subCol?.color ?? '#0891b2';
                    const srcY = rowY(dragState.sourceBranchRowIdx);
                    const tgtY = rowY(dragState.targetBranchRowIdx);
                    const previewData =
                      livePreview?.kind === 'sub-branch' && livePreview.changed
                        ? livePreview
                        : null;
                    const minSpanRow = previewData
                      ? Math.min(previewData.minEvalRow, dragState.targetBranchRowIdx)
                      : Math.min(
                          dragState.sourceBranchRowIdx,
                          dragState.targetBranchRowIdx
                        );
                    const maxSpanRow = previewData
                      ? Math.max(previewData.maxEvalRow, dragState.targetBranchRowIdx)
                      : Math.max(
                          dragState.sourceBranchRowIdx,
                          dragState.targetBranchRowIdx
                        );
                    const addedRows = previewData ? previewData.addedRowIndices : [];
                    const badgeText = previewData
                      ? `${dragState.subDropperLabel} @ ${dragState.targetBranchFloorLabel} (${
                          previewData.addedFloorLabels.length > 0
                            ? `+${previewData.addedFloorLabels.length} flr${
                                previewData.addedFloorLabels.length > 1 ? 's' : ''
                              } · `
                            : ''
                        }${previewData.totalZoneLu.toFixed(0)} LU · Ø${
                          previewData.baseNominalMm ?? '-'
                        }${
                          previewData.terminalNominalMm &&
                          previewData.terminalNominalMm !== previewData.baseNominalMm
                            ? `→${previewData.terminalNominalMm}`
                            : ''
                        })`
                      : `${dragState.subDropperLabel} @ ${dragState.targetBranchFloorLabel}`;
                    const badgeWidth = Math.max(108, badgeText.length * 5.4 + 14);

                    return (
                      <g pointerEvents="none">
                        {/* Vertical relocation path along Parent Main Dropper */}
                        {dragState.sourceBranchRowIdx !== dragState.targetBranchRowIdx && (
                          <line
                            x1={parentX}
                            y1={srcY}
                            x2={parentX}
                            y2={tgtY}
                            stroke={accent}
                            strokeWidth={2.4}
                            strokeDasharray="4 3"
                          />
                        )}

                        {/* Highlighted extended Sub-Dropper vertical branch span */}
                        <line
                          x1={subX}
                          y1={rowY(minSpanRow)}
                          x2={subX}
                          y2={rowY(maxSpanRow)}
                          stroke={accent}
                          strokeWidth={3}
                          strokeOpacity={0.55}
                          strokeDasharray="5 3"
                        />

                        {/* Newly incorporated intermediate floors along Sub-Dropper */}
                        {addedRows.map((rIdx) => {
                          const ay = rowY(rIdx);
                          const lbl = rows[rIdx]?.input.floorLabel ?? '';
                          return (
                            <g key={`added-sd-floor-${rIdx}`}>
                              <line
                                x1={subX}
                                y1={ay}
                                x2={subX + 19}
                                y2={ay}
                                stroke={accent}
                                strokeWidth={2}
                              />
                              <circle
                                cx={subX + 19}
                                cy={ay}
                                r={5}
                                fill={accent}
                                stroke="#ffffff"
                                strokeWidth={1.5}
                              />
                              <text
                                x={subX + 27}
                                y={ay + 3}
                                fontSize={8.5}
                                fontWeight={700}
                                fontFamily="IBM Plex Mono, monospace"
                                fill={accent}
                              >
                                +{lbl}
                              </text>
                            </g>
                          );
                        })}

                        {/* Snapped new branch horizontal connection at Target Floor */}
                        <line
                          x1={parentX}
                          y1={tgtY}
                          x2={subX}
                          y2={tgtY}
                          stroke={accent}
                          strokeWidth={2.6}
                        />
                        <circle
                          cx={parentX}
                          cy={tgtY}
                          r={6.5}
                          fill="none"
                          stroke={accent}
                          strokeWidth={1.8}
                        />
                        <circle
                          cx={parentX}
                          cy={tgtY}
                          r={3.8}
                          fill={accent}
                          stroke="#ffffff"
                          strokeWidth={1.2}
                        />
                        <polyline
                          points={`${subX - 13},${tgtY - 3} ${subX - 7},${tgtY} ${subX - 13},${tgtY + 3}`}
                          fill="none"
                          stroke={accent}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* Active dragging handle & telemetry pill at pointerY */}
                        <circle
                          cx={parentX}
                          cy={dragState.pointerY}
                          r={5.5}
                          fill={accent}
                          stroke="#ffffff"
                          strokeWidth={2}
                        />
                        <rect
                          x={parentX + 10}
                          y={dragState.pointerY - 10}
                          width={badgeWidth}
                          height={18}
                          rx={3}
                          fill="#0f172a"
                          stroke={accent}
                          strokeWidth={1}
                        />
                        <text
                          x={parentX + 16}
                          y={dragState.pointerY + 2}
                          fontSize={8.5}
                          fontWeight={700}
                          fontFamily="IBM Plex Mono, monospace"
                          fill="#ffffff"
                        >
                          {badgeText}
                        </text>
                      </g>
                    );
                  })()}
              </svg>

              {/* Inline Popover for Pipe Header Nominal Size Selection (Non-Sticky Context) */}
              {!useStickyHeader && renderPipeHeaderPopover(false)}

              {/* Inline Popover for Booster Pump Pressure Override (Sub-Droppers, or Main Droppers when non-sticky) */}
              {isInteractive &&
                selectedBoosterPump &&
                (!useStickyHeader || selectedBoosterPump.target.kind === 'sub') &&
                !dragState?.started &&
                (() => {
                  const isMain = selectedBoosterPump.target.kind === 'main';
                  const summary = isMain
                    ? dropperSummaries.find(
                        (d) =>
                          d.dropperIndex ===
                          (selectedBoosterPump.target as { kind: 'main'; dropperIndex: number })
                            .dropperIndex
                      )
                    : subDropperSummaries.find(
                        (sd) =>
                          sd.id ===
                          (selectedBoosterPump.target as { kind: 'sub'; subDropperId: string })
                            .subDropperId
                      );
                  if (!summary || !summary.hasBoosterPump) return null;

                  const effBoost =
                    summary.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                  let anchorX = targetX(selectedBoosterPump.target);
                  let anchorY = mainPumpY;
                  let translateY = '18px';
                  if (!isMain) {
                    const sdSummary = summary as SubDropperSummary;
                    const parentX = targetX({
                      kind: 'main',
                      dropperIndex: sdSummary.parentDropperIndex,
                    });
                    const x = targetX(selectedBoosterPump.target);
                    const branchHasPrv = Boolean(
                      rows[sdSummary.branchRowIdx]?.subDropperCells[sdSummary.id]?.hasPrv
                    );
                    const spanRight = branchHasPrv ? x - 44 : x - 16;
                    const availSpan = spanRight - parentX;
                    anchorX =
                      availSpan >= 32
                        ? Math.round(parentX + availSpan * 0.5)
                        : Math.round((parentX + x) * 0.5);
                    anchorY = rowY(sdSummary.branchRowIdx);
                    translateY =
                      sdSummary.branchRowIdx <= 1
                        ? '-10%'
                        : sdSummary.branchRowIdx >= rows.length - 3
                        ? '-88%'
                        : '-50%';
                  }

                  const leftPct = (anchorX / schematicSvgWidth) * 100;
                  const topPct = (anchorY / totalSvgHeight) * 100;
                  const placeLeft = leftPct > 58;
                  const translateX = placeLeft ? 'calc(-100% - 22px)' : '22px';

                  const commitBoosterDraft = () => {
                    const trimmed = boosterDraft.trim();
                    if (trimmed === '') {
                      handleSetBoosterPressure(selectedBoosterPump.target, null);
                      setBoosterDraft(parameters.boosterPumpBoostBar.toFixed(2));
                      return;
                    }
                    const parsed = parseFloat(trimmed);
                    if (Number.isNaN(parsed) || parsed <= 0) {
                      setBoosterDraft(effBoost.toFixed(2));
                      return;
                    }
                    const rounded = Math.round(Math.min(15, Math.max(0.1, parsed)) * 100) / 100;
                    if (
                      !summary.isCustomBoosterPressure &&
                      Math.abs(rounded - parameters.boosterPumpBoostBar) < 1e-6
                    ) {
                      setBoosterDraft(parameters.boosterPumpBoostBar.toFixed(2));
                      return;
                    }
                    handleSetBoosterPressure(selectedBoosterPump.target, rounded);
                    setBoosterDraft(rounded.toFixed(2));
                  };

                  return (
                    <div
                      role="dialog"
                      aria-label={`Edit Booster Pump Pressure for ${selectedBoosterPump.riserLabel}`}
                      data-testid={`booster-popover-${selectedBoosterPump.riserLabel}`}
                      className="absolute z-30 w-[244px] bg-white border-2 border-[#121212] shadow-[4px_4px_0_0_rgba(18,18,18,0.14)] p-2.5 text-xs"
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        transform: `translate(${translateX}, ${translateY})`,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-[#e0e0e0]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212] truncate">
                            Booster · {selectedBoosterPump.riserLabel}
                          </span>
                          {summary.isCustomBoosterPressure && (
                            <span className="px-1 py-0.5 bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] font-mono text-[9px] font-bold uppercase leading-none shrink-0">
                              Custom
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedBoosterPump(null)}
                          aria-label="Close booster pump editor"
                          className="h-5 w-5 inline-flex items-center justify-center text-[#555555] hover:text-[#121212]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 mb-2 font-mono tabular-nums text-[10px] bg-[#f8f8f8] border border-[#e0e0e0] px-2 py-1.5">
                        <div>
                          <span className="text-[#666666] block text-[9px] uppercase">
                            Working Range
                          </span>
                          <span className="font-semibold text-[#121212]">
                            {summary.minWorkingPressureBar !== null &&
                            summary.maxWorkingPressureBar !== null
                              ? `${summary.minWorkingPressureBar.toFixed(1)}–${summary.maxWorkingPressureBar.toFixed(1)} bar`
                              : summary.servedFloorRange}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[#666666] block text-[9px] uppercase">
                            PRVs / Vel
                          </span>
                          <span
                            className={`font-semibold ${
                              summary.cavitationRiskCount > 0 ? 'text-[#d90000]' : 'text-[#121212]'
                            }`}
                          >
                            {summary.prvCount} PRV ·{' '}
                            {summary.peakVelocityMs !== null
                              ? `${summary.peakVelocityMs.toFixed(2)}`
                              : '—'}{' '}
                            m/s
                          </span>
                        </div>
                      </div>

                      <label
                        htmlFor="booster-pump-pressure-input-canvas"
                        className="block font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] mb-1"
                      >
                        Boost Pressure ΔP (bar)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          ref={boosterInputRef}
                          id="booster-pump-pressure-input-canvas"
                          data-testid={`booster-popover-input-${selectedBoosterPump.riserLabel}`}
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="15.0"
                          value={boosterDraft}
                          onFocus={() => setIsBoosterInputFocused(true)}
                          onBlur={() => {
                            setIsBoosterInputFocused(false);
                            commitBoosterDraft();
                          }}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setBoosterDraft(raw);
                            const parsed = parseFloat(raw);
                            if (!Number.isNaN(parsed) && parsed >= 0.1 && parsed <= 15) {
                              const rounded = Math.round(parsed * 100) / 100;
                              if (
                                !summary.isCustomBoosterPressure &&
                                Math.abs(rounded - parameters.boosterPumpBoostBar) < 1e-6
                              ) {
                                return;
                              }
                              handleSetBoosterPressure(selectedBoosterPump.target, rounded);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitBoosterDraft();
                              setSelectedBoosterPump(null);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedBoosterPump(null);
                            }
                          }}
                          className="flex-1 min-w-0 h-7 px-2 text-xs font-mono tabular-nums bg-white border border-[#121212] text-[#121212] focus:outline-none"
                        />
                        {summary.isCustomBoosterPressure && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              handleSetBoosterPressure(selectedBoosterPump.target, null);
                              setBoosterDraft(parameters.boosterPumpBoostBar.toFixed(2));
                            }}
                            title={`Reset to global default (${parameters.boosterPumpBoostBar.toFixed(
                              2
                            )} bar)`}
                            data-testid={`booster-popover-reset-${selectedBoosterPump.riserLabel}`}
                            className="h-7 px-2 font-display text-[10px] font-bold uppercase bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] inline-flex items-center gap-1 shrink-0"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Reset</span>
                          </button>
                        )}
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-[#e0e0e0] flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-[#666666]">
                        <span>Global: +{parameters.boosterPumpBoostBar.toFixed(2)}b</span>
                        <button
                          type="button"
                          onClick={() => {
                            handleToggleBoosterPump(selectedBoosterPump.target, false);
                            setSelectedBoosterPump(null);
                          }}
                          data-testid={`booster-popover-remove-${selectedBoosterPump.riserLabel}`}
                          className="px-1.5 py-0.5 font-display text-[9px] font-bold uppercase text-[#d90000] border border-[#fca5a5] bg-[#fef2f2] hover:bg-[#fee2e2] transition-colors"
                        >
                          Remove Pump
                        </button>
                      </div>
                    </div>
                  );
                })()}

              {/* Inline Popover for Per-Station PRV Downstream Set Pressure (P2) */}
              {isInteractive &&
                isPrvPopoverOpen &&
                selectedPrv &&
                selectedPrvCell?.prvDetail &&
                !dragState?.started &&
                (() => {
                  const rIdx = rows.findIndex((r) => r.input.id === selectedPrv.floorId);
                  if (rIdx < 0) return null;
                  const prvDetail = selectedPrvCell.prvDetail;
                  const prvX = targetX(selectedPrv.target);
                  const flowDir =
                    selectedPrv.target.kind === 'sub' && 'flowDirection' in selectedPrvCell
                      ? selectedPrvCell.flowDirection
                      : undefined;
                  const prvY =
                    rowY(rIdx) + getPrvYOffset(selectedPrv.target, rIdx, flowDir);
                  const leftPct = (prvX / schematicSvgWidth) * 100;
                  const topPct = (prvY / totalSvgHeight) * 100;
                  const placeLeft = leftPct > 58;
                  const translateX = placeLeft ? 'calc(-100% - 38px)' : '26px';
                  const translateY =
                    rIdx <= 1 ? '-12%' : rIdx >= rows.length - 3 ? '-88%' : '-50%';

                  const commitDraftOrReset = () => {
                    const trimmed = prvP2Draft.trim();
                    if (trimmed === '') {
                      handleSetPrvPressure(selectedPrv.target, selectedPrv.floorId, null);
                      setPrvP2Draft(parameters.prvSetPressureBar.toFixed(2));
                      return;
                    }
                    const parsed = parseFloat(trimmed);
                    if (Number.isNaN(parsed) || parsed <= 0) {
                      setPrvP2Draft(prvDetail.downstreamPressureBar.toFixed(2));
                      return;
                    }
                    const rounded = Math.round(parsed * 100) / 100;
                    if (
                      !prvDetail.isCustomSetPressure &&
                      Math.abs(rounded - parameters.prvSetPressureBar) < 1e-6
                    ) {
                      setPrvP2Draft(parameters.prvSetPressureBar.toFixed(2));
                      return;
                    }
                    handleSetPrvPressure(selectedPrv.target, selectedPrv.floorId, rounded);
                    setPrvP2Draft(rounded.toFixed(2));
                  };

                  return (
                    <div
                      role="dialog"
                      aria-label={`Edit PRV P2 at ${selectedPrv.riserLabel} ${selectedPrv.floorLabel}`}
                      data-testid={`prv-popover-${selectedPrv.riserLabel}-${selectedPrv.floorLabel}`}
                      className="absolute z-30 w-[238px] bg-white border-2 border-[#121212] shadow-[4px_4px_0_0_rgba(18,18,18,0.14)] p-2.5 text-xs"
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        transform: `translate(${translateX}, ${translateY})`,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-[#e0e0e0]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212] truncate">
                            PRV · {selectedPrv.riserLabel} {selectedPrv.floorLabel}
                          </span>
                          {prvDetail.isCustomSetPressure && (
                            <span className="px-1 py-0.5 bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] font-mono text-[9px] font-bold uppercase leading-none shrink-0">
                              Custom
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsPrvPopoverOpen(false)}
                          aria-label="Close PRV editor"
                          className="h-5 w-5 inline-flex items-center justify-center text-[#555555] hover:text-[#121212]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 mb-2 font-mono tabular-nums text-[10px] bg-[#f8f8f8] border border-[#e0e0e0] px-2 py-1.5">
                        <div>
                          <span className="text-[#666666] block text-[9px] uppercase">
                            Upstream P1
                          </span>
                          <span className="font-semibold text-[#121212]">
                            {prvDetail.upstreamPressureBar.toFixed(2)} bar
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[#666666] block text-[9px] uppercase">
                            P1/P2 Ratio
                          </span>
                          <span
                            className={`font-semibold ${
                              prvDetail.cavitationWarning ? 'text-[#d90000]' : 'text-[#15803d]'
                            }`}
                          >
                            {prvDetail.pressureRatio.toFixed(2)}x{' '}
                            {prvDetail.cavitationWarning ? '(!)' : '(OK)'}
                          </span>
                        </div>
                      </div>

                      <label
                        htmlFor="prv-station-p2-input"
                        className="block font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] mb-1"
                      >
                        Downstream Set P2 (bar)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          ref={prvInputRef}
                          id="prv-station-p2-input"
                          type="number"
                          step="0.05"
                          min="0.20"
                          max="12.00"
                          value={prvP2Draft}
                          onFocus={() => setIsPrvInputFocused(true)}
                          onBlur={() => {
                            setIsPrvInputFocused(false);
                            commitDraftOrReset();
                          }}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setPrvP2Draft(raw);
                            const parsed = parseFloat(raw);
                            if (!Number.isNaN(parsed) && parsed >= 0.1 && parsed <= 20) {
                              const rounded = Math.round(parsed * 100) / 100;
                              if (
                                !prvDetail.isCustomSetPressure &&
                                Math.abs(rounded - parameters.prvSetPressureBar) < 1e-6
                              ) {
                                return;
                              }
                              handleSetPrvPressure(
                                selectedPrv.target,
                                selectedPrv.floorId,
                                rounded
                              );
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitDraftOrReset();
                              setIsPrvPopoverOpen(false);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsPrvPopoverOpen(false);
                            }
                          }}
                          className="flex-1 min-w-0 h-7 px-2 text-xs font-mono tabular-nums bg-white border border-[#121212] text-[#121212] focus:outline-none"
                        />
                        {prvDetail.isCustomSetPressure && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              handleSetPrvPressure(
                                selectedPrv.target,
                                selectedPrv.floorId,
                                null
                              );
                              setPrvP2Draft(parameters.prvSetPressureBar.toFixed(2));
                            }}
                            title={`Reset to global default (${parameters.prvSetPressureBar.toFixed(2)} bar)`}
                            className="h-7 px-2 font-display text-[10px] font-bold uppercase bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] inline-flex items-center gap-1 shrink-0"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Reset</span>
                          </button>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono tabular-nums text-[#666666]">
                        <span>Global: {parameters.prvSetPressureBar.toFixed(2)} bar</span>
                        <span>
                          ΔP {prvDetail.deltaPressureBar.toFixed(2)}b · DN
                          {prvDetail.recommendedValveDn}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              {/* Inline Popover for Floor Tap-Off Multi-Dropper Load Splitting */}
              {isInteractive &&
                selectedTapNode &&
                floors &&
                onChangeFloors &&
                !dragState?.started &&
                (() => {
                  const rIdx = rows.findIndex((r) => r.input.id === selectedTapNode.floorId);
                  if (rIdx < 0) return null;
                  const row = rows[rIdx];
                  const floorObj = floors.find((f) => f.id === selectedTapNode.floorId);
                  if (!floorObj || floorObj.supplyMode === SupplyMode.ROOF_HEADER) return null;

                  const nodeX = targetX(selectedTapNode.target) + 19;
                  const nodeY = rowY(rIdx);
                  const leftPct = (nodeX / schematicSvgWidth) * 100;
                  const topPct = (nodeY / totalSvgHeight) * 100;
                  const placeLeft = leftPct > 55;
                  const translateX = placeLeft ? 'calc(-100% - 28px)' : '24px';
                  const translateY =
                    rIdx <= 1 ? '-10%' : rIdx >= rows.length - 3 ? '-88%' : '-50%';

                  const explicitSplits =
                    floorObj.loadSplits && floorObj.loadSplits.length >= 2
                      ? floorObj.loadSplits
                      : null;
                  const effectiveSplits: FloorRiserAllocation[] | null =
                    explicitSplits ??
                    (row.isSplitFloor
                      ? row.riserAllocations.map((a) => ({
                          target: a.target,
                          loadingUnits: Math.round(a.assignedLu * 10) / 10,
                        }))
                      : null);

                  const maxMainDropperIdx = Math.min(
                    12,
                    Math.max(
                      dropperSummaries.reduce((m, d) => Math.max(m, d.dropperIndex), 1),
                      ...(effectiveSplits ?? []).map((s) =>
                        s.target.kind === 'main' ? s.target.dropperIndex : 1
                      )
                    )
                  );

                  const applySplits = (nextSplits: FloorRiserAllocation[] | undefined) => {
                    onChangeFloors(setFloorLoadSplits(floors, floorObj.id, nextSplits));
                  };

                  return (
                    <div
                      role="dialog"
                      aria-label={`Tap-off load split for Level ${floorObj.floorLabel}`}
                      data-testid={`tap-split-popover-${floorObj.floorLabel}`}
                      className="absolute z-30 w-[290px] bg-white border-2 border-[#121212] shadow-[4px_4px_0_0_rgba(18,18,18,0.14)] p-2.5 text-xs"
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        transform: `translate(${translateX}, ${translateY})`,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-[#e0e0e0]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <svg
                            viewBox="0 0 12 12"
                            className="w-3 h-3 shrink-0 text-[#1d4ed8]"
                            aria-hidden="true"
                          >
                            {effectiveSplits ? (
                              <>
                                <circle
                                  cx="6"
                                  cy="6"
                                  r="4.2"
                                  fill="#ffffff"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                />
                                <path d="M 6 1.8 A 4.2 4.2 0 0 0 6 10.2 Z" fill="currentColor" />
                              </>
                            ) : (
                              <circle cx="6" cy="6" r="4.2" fill="#121212" />
                            )}
                          </svg>
                          <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212] truncate">
                            Level {floorObj.floorLabel} · {effectiveSplits ? 'Split Load' : 'Full Tap-Off'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedTapNode(null)}
                          aria-label="Close tap-off load split editor"
                          className="h-5 w-5 inline-flex items-center justify-center text-[#555555] hover:text-[#121212]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {!effectiveSplits ? (
                        <div className="space-y-2">
                          <div className="bg-[#f8f8f8] border border-[#e0e0e0] px-2 py-1.5 font-mono tabular-nums text-[11px] flex items-center justify-between">
                            <span className="text-[#555555]">
                              {selectedTapNode.riserLabel} (100% Full)
                            </span>
                            <strong className="text-[#121212]">
                              {floorObj.loadingUnits.toFixed(1).replace(/\.0$/, '')} LU
                            </strong>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const initial = buildDefaultSplitForFloor(
                                floorObj,
                                row,
                                dropperSummaries,
                                subDropperSummaries
                              );
                              applySplits(initial);
                            }}
                            className="w-full h-7 px-2.5 font-display text-[10px] font-bold uppercase bg-[#121212] text-white hover:bg-[#2a2a2a] transition-colors"
                          >
                            Split Floor Load Across Risers (50 / 50)
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between font-mono tabular-nums text-[10px] text-[#555555]">
                            <span>
                              Total:{' '}
                              <strong className="text-[#121212]">
                                {floorObj.loadingUnits.toFixed(1).replace(/\.0$/, '')} LU
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const total = effectiveSplits.reduce(
                                  (sum, s) => sum + Math.max(0, s.loadingUnits),
                                  0
                                );
                                const shares = splitLuEvenly(total, effectiveSplits.length);
                                applySplits(
                                  effectiveSplits.map((s, idx) => ({
                                    ...s,
                                    loadingUnits: shares[idx] ?? 0,
                                  }))
                                );
                              }}
                              className="px-1.5 py-0.5 bg-[#f8f8f8] border border-[#cccccc] hover:border-[#121212] text-[#121212] font-display text-[9px] font-bold uppercase"
                            >
                              Equalize
                            </button>
                          </div>

                          <div className="space-y-1.5">
                            {effectiveSplits.map((leg, legIdx) => {
                              const encodedVal =
                                leg.target.kind === 'main'
                                  ? `main:${leg.target.dropperIndex}`
                                  : `sub:${leg.target.subDropperId}`;
                              const totalSplit = effectiveSplits.reduce(
                                (sum, s) => sum + Math.max(0, s.loadingUnits),
                                0
                              );
                              const pct =
                                totalSplit > 0
                                  ? Math.round((leg.loadingUnits / totalSplit) * 100)
                                  : Math.round(100 / effectiveSplits.length);
                              const alloc = row.riserAllocations.find((a) =>
                                isSameRiser(a.target, leg.target)
                              );

                              return (
                                <div
                                  key={`pop-leg-${riserKey(leg.target)}-${legIdx}`}
                                  className="bg-[#f8f8f8] border border-[#e0e0e0] px-1.5 py-1 space-y-1"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <select
                                      value={encodedVal}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const nextTarget: RiserTarget = val.startsWith('main:')
                                          ? { kind: 'main', dropperIndex: Number(val.slice(5)) || 1 }
                                          : { kind: 'sub', subDropperId: val.slice(4) };
                                        if (
                                          effectiveSplits.some(
                                            (s, i) =>
                                              i !== legIdx && isSameRiser(s.target, nextTarget)
                                          )
                                        ) {
                                          return;
                                        }
                                        applySplits(
                                          effectiveSplits.map((s, i) =>
                                            i === legIdx ? { ...s, target: nextTarget } : s
                                          )
                                        );
                                      }}
                                      aria-label={`Riser for split leg ${legIdx + 1}`}
                                      className="h-6 px-1 text-[11px] font-mono font-semibold bg-white border border-[#cccccc] text-[#121212] focus:border-[#121212] focus:outline-none"
                                    >
                                      {Array.from(
                                        { length: maxMainDropperIdx },
                                        (_, i) => i + 1
                                      ).map((dIdx) => {
                                        const t: RiserTarget = { kind: 'main', dropperIndex: dIdx };
                                        const used = effectiveSplits.some(
                                          (s, i) => i !== legIdx && isSameRiser(s.target, t)
                                        );
                                        return (
                                          <option key={`pm-${dIdx}`} value={`main:${dIdx}`} disabled={used}>
                                            D{dIdx}
                                          </option>
                                        );
                                      })}
                                      {maxMainDropperIdx < 12 && (
                                        <option value={`main:${maxMainDropperIdx + 1}`}>
                                          +D{maxMainDropperIdx + 1}
                                        </option>
                                      )}
                                      {subDropperSummaries.map((sd) => {
                                        const t: RiserTarget = { kind: 'sub', subDropperId: sd.id };
                                        const used = effectiveSplits.some(
                                          (s, i) => i !== legIdx && isSameRiser(s.target, t)
                                        );
                                        return (
                                          <option key={`ps-${sd.id}`} value={`sub:${sd.id}`} disabled={used}>
                                            {sd.label}
                                          </option>
                                        );
                                      })}
                                    </select>

                                    <input
                                      type="number"
                                      step="1"
                                      min="0"
                                      value={leg.loadingUnits}
                                      onChange={(e) => {
                                        const nextVal = Math.max(0, parseFloat(e.target.value) || 0);
                                        applySplits(
                                          effectiveSplits.map((s, i) =>
                                            i === legIdx ? { ...s, loadingUnits: nextVal } : s
                                          )
                                        );
                                      }}
                                      aria-label={`LU for split leg ${legIdx + 1}`}
                                      className="flex-1 min-w-0 h-6 px-1.5 text-right text-[11px] font-mono tabular-nums bg-white border border-[#121212] text-[#121212] focus:outline-none"
                                    />
                                    <span className="font-mono text-[10px] text-[#1d4ed8] font-semibold w-8 text-right shrink-0">
                                      {pct}%
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const rem = effectiveSplits.filter((_, i) => i !== legIdx);
                                        if (rem.length <= 1) {
                                          applySplits(rem);
                                          setSelectedTapNode(null);
                                        } else {
                                          const shares = splitLuEvenly(
                                            floorObj.loadingUnits,
                                            rem.length
                                          );
                                          applySplits(
                                            rem.map((s, i) => ({
                                              ...s,
                                              loadingUnits: shares[i] ?? 0,
                                            }))
                                          );
                                        }
                                      }}
                                      aria-label={`Remove split leg ${legIdx + 1}`}
                                      className="h-5 w-5 inline-flex items-center justify-center text-[#666666] hover:text-[#d90000] shrink-0"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                  {alloc && (
                                    <div className="font-mono tabular-nums text-[9.5px] text-[#555555] flex items-center justify-between">
                                      <span>
                                        Q {alloc.flowRateLs.toFixed(2)} L/s · Ø
                                        {alloc.nominalMm ?? '-'}
                                      </span>
                                      <span
                                        className={
                                          alloc.velocityMs !== null &&
                                          alloc.velocityMs > parameters.maxVelocityMs + 1e-4
                                            ? 'text-[#d90000] font-semibold'
                                            : ''
                                        }
                                      >
                                        {alloc.velocityMs !== null
                                          ? `${alloc.velocityMs.toFixed(2)} m/s`
                                          : '—'}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-[#e0e0e0]">
                            <button
                              type="button"
                              onClick={() => {
                                let candidate: RiserTarget | null = null;
                                for (let dIdx = 1; dIdx <= maxMainDropperIdx; dIdx++) {
                                  const t: RiserTarget = { kind: 'main', dropperIndex: dIdx };
                                  if (!effectiveSplits.some((s) => isSameRiser(s.target, t))) {
                                    candidate = t;
                                    break;
                                  }
                                }
                                if (!candidate && maxMainDropperIdx < 12) {
                                  candidate = {
                                    kind: 'main',
                                    dropperIndex: maxMainDropperIdx + 1,
                                  };
                                }
                                if (!candidate) return;
                                const shares = splitLuEvenly(
                                  floorObj.loadingUnits,
                                  effectiveSplits.length + 1
                                );
                                applySplits([
                                  ...effectiveSplits.map((s, i) => ({
                                    ...s,
                                    loadingUnits: shares[i] ?? 0,
                                  })),
                                  {
                                    target: candidate,
                                    loadingUnits: shares[effectiveSplits.length] ?? 0,
                                  },
                                ]);
                              }}
                              className="h-6 px-2 font-display text-[9px] font-bold uppercase bg-white border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white inline-flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Riser</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                applySplits(effectiveSplits[0] ? [effectiveSplits[0]] : undefined);
                                setSelectedTapNode(null);
                              }}
                              className="h-6 px-2 font-display text-[9px] font-bold uppercase bg-white border border-[#e0e0e0] text-[#666666] hover:border-[#d90000] hover:text-[#d90000]"
                            >
                              Revert to Full
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          </div>
        </div>
      </div>

      {/* Right-Click Context Menu for PRV, Load Splitting & Sub-Dropper Branching */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border-2 border-[#121212] py-1 min-w-[240px] text-xs"
          style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.hasPrv ? (
            <button
              type="button"
              onClick={() => handleDeletePrv(contextMenu.target, contextMenu.floorId)}
              className="w-full px-3 py-2 text-left text-red-700 hover:bg-red-50 font-medium flex items-center gap-2 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Delete PRV ({contextMenu.riserLabel} · L{contextMenu.floorLabel})
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleAddPrv(contextMenu.target, contextMenu.floorId)}
              className="w-full px-3 py-2 text-left text-slate-800 hover:bg-amber-50 hover:text-amber-900 font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>
                Insert PRV ({contextMenu.riserLabel} · L{contextMenu.floorLabel})
              </span>
            </button>
          )}
          {!contextMenu.isServed && floors && onChangeFloors && (
            <button
              type="button"
              onClick={() => {
                onChangeFloors(
                  splitFloorWithRiserTarget(
                    floors,
                    result,
                    contextMenu.floorId,
                    contextMenu.target
                  )
                );
                setSelectedTapNode({
                  target: contextMenu.target,
                  targetKey: riserKey(contextMenu.target),
                  riserLabel: contextMenu.riserLabel,
                  floorId: contextMenu.floorId,
                  floorLabel: contextMenu.floorLabel,
                });
                setContextMenu(null);
              }}
              className="w-full px-3 py-2 text-left text-[#1d4ed8] hover:bg-[#eff6ff] font-medium flex items-center gap-2 border-t border-[#e0e0e0] transition-colors"
            >
              <svg viewBox="0 0 12 12" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                <circle cx="6" cy="6" r="4.2" fill="#ffffff" stroke="currentColor" strokeWidth="1.4" />
                <path d="M 6 1.8 A 4.2 4.2 0 0 0 6 10.2 Z" fill="currentColor" />
              </svg>
              <span>
                Split L{contextMenu.floorLabel} Load with {contextMenu.riserLabel}
              </span>
            </button>
          )}
          {(() => {
            const targetSummary =
              contextMenu.target.kind === 'main'
                ? dropperSummaries.find(
                    (d) =>
                      d.dropperIndex ===
                      (contextMenu.target as { kind: 'main'; dropperIndex: number }).dropperIndex
                  )
                : subDropperSummaries.find(
                    (sd) =>
                      sd.id ===
                      (contextMenu.target as { kind: 'sub'; subDropperId: string }).subDropperId
                  );
            const hasPump = Boolean(targetSummary?.hasBoosterPump);
            const effBoost =
              targetSummary?.boosterPressureBar ?? parameters.boosterPumpBoostBar;
            return (
              <>
                {hasPump && (
                  <button
                    type="button"
                    onClick={() =>
                      openBoosterEditor(contextMenu.target, contextMenu.riserLabel)
                    }
                    className="w-full px-3 py-2 text-left text-[#1d4ed8] hover:bg-[#eff6ff] font-medium flex items-center gap-2 border-t border-[#e0e0e0] transition-colors"
                  >
                    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                      <circle
                        cx="7"
                        cy="7"
                        r="5.5"
                        fill="#eef2ff"
                        stroke="currentColor"
                        strokeWidth="1.4"
                      />
                      <polygon points="5.2,4.5 10,7 5.2,9.5" fill="currentColor" />
                    </svg>
                    <span>
                      Edit Booster Pressure ({contextMenu.riserLabel} · +{effBoost.toFixed(1)}b
                      {targetSummary?.isCustomBoosterPressure ? '*' : ''})
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleToggleBoosterPump(contextMenu.target)}
                  className={`w-full px-3 py-2 text-left font-medium flex items-center gap-2 border-t border-[#e0e0e0] transition-colors ${
                    hasPump
                      ? 'text-red-700 hover:bg-red-50'
                      : 'text-[#0369a1] hover:bg-[#f0f9ff]'
                  }`}
                >
                  <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                    <circle
                      cx="7"
                      cy="7"
                      r="5.5"
                      fill={hasPump ? '#fee2e2' : '#e0f2fe'}
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                    {hasPump ? (
                      <path
                        d="M4.8 4.8L9.2 9.2M9.2 4.8L4.8 9.2"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                    ) : (
                      <polygon points="5.2,4.5 10,7 5.2,9.5" fill="currentColor" />
                    )}
                  </svg>
                  <span>
                    {hasPump
                      ? `Remove Booster Pump (${contextMenu.riserLabel})`
                      : `Add Booster Pump (${contextMenu.riserLabel} · +${parameters.boosterPumpBoostBar.toFixed(
                          1
                        )} bar)`}
                  </span>
                </button>
              </>
            );
          })()}
          {contextMenu.target.kind === 'main' && (
            <button
              type="button"
              onClick={() => {
                if (contextMenu.target.kind === 'main') {
                  openSubCreator(contextMenu.target.dropperIndex, contextMenu.floorId);
                }
              }}
              className="w-full px-3 py-2 text-left text-[#0891b2] hover:bg-[#ecfeff] font-medium flex items-center gap-2 border-t border-[#e0e0e0] transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              <span>
                Branch Sub-Dropper ({contextMenu.riserLabel} · L{contextMenu.floorLabel})
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

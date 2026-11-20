import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { formatPipeDim, getPipeSpecBadgeLabel, PIPE_SPEC_TABLES } from '../data/pipeSpecs';
import {
  CalculatedFloorRow,
  PrvOverrideMode,
  RiserTarget,
  SupplyMode,
  SystemCalculationResult,
} from '../types/hydraulics';
import {
  formatLuDisplay,
  formatRowDeltaPDisplay,
} from '../utils/calculations';

interface ScheduleTableProps {
  result: SystemCalculationResult;
  onCyclePrvOverride: (floorId: string) => void;
  onSetPrvPressure?: (
    floorId: string,
    target: number | RiserTarget,
    downstreamPressureBar: number | null
  ) => void;
  onSetBoosterPressure?: (target: RiserTarget, pressureBar: number | null) => void;
  onOpenFloorInputs?: () => void;
}

type ZoneFilter = 'ALL' | 'BOOSTER' | 'GRAVITY' | 'PRV_ONLY';

type ScheduleRiserCol =
  | {
      kind: 'main';
      key: string;
      target: RiserTarget;
      dropperIndex: number;
      shortLabel: string;
      zoneType: 'Booster' | 'Gravity';
      hasBoosterPump: boolean;
      boosterPressureBar: number | null;
      isCustomBoosterPressure: boolean;
    }
  | {
      kind: 'sub';
      key: string;
      target: RiserTarget;
      subDropperId: string;
      shortLabel: string;
      zoneType: 'Booster' | 'Gravity';
      hasBoosterPump: boolean;
      boosterPressureBar: number | null;
      isCustomBoosterPressure: boolean;
      parentDropperIndex: number;
    };

export const ScheduleTable: React.FC<ScheduleTableProps> = ({
  result,
  onCyclePrvOverride,
  onSetPrvPressure,
  onSetBoosterPressure,
  onOpenFloorInputs,
}) => {
  const { rows, dropperSummaries, subDropperSummaries, parameters, pipeSpec, optionalPipeSpec } =
    result;
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showExpressDiameters, setShowExpressDiameters] = useState(true);
  const [editingPrvCell, setEditingPrvCell] = useState<{
    floorId: string;
    target: RiserTarget;
    targetKey: string;
    initialValue: number;
    wasCustom: boolean;
  } | null>(null);
  const [prvDraft, setPrvDraft] = useState('');
  const [editingBoostCol, setEditingBoostCol] = useState<{
    key: string;
    target: RiserTarget;
    shortLabel: string;
    initialValue: number;
    wasCustom: boolean;
  } | null>(null);
  const [boostColDraft, setBoostColDraft] = useState('');

  const riserColumns = useMemo<ScheduleRiserCol[]>(() => {
    const cols: ScheduleRiserCol[] = [];
    for (const d of dropperSummaries) {
      cols.push({
        kind: 'main',
        key: `main-${d.dropperIndex}`,
        target: { kind: 'main', dropperIndex: d.dropperIndex },
        dropperIndex: d.dropperIndex,
        shortLabel: `D${d.dropperIndex}`,
        zoneType: d.zoneType,
        hasBoosterPump: d.hasBoosterPump,
        boosterPressureBar: d.boosterPressureBar,
        isCustomBoosterPressure: d.isCustomBoosterPressure,
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
          shortLabel: sd.label,
          zoneType: sd.zoneType,
          hasBoosterPump: sd.hasBoosterPump,
          boosterPressureBar: sd.boosterPressureBar,
          isCustomBoosterPressure: sd.isCustomBoosterPressure,
          parentDropperIndex: sd.parentDropperIndex,
        });
      }
    }
    return cols;
  }, [dropperSummaries, subDropperSummaries]);

  const filteredRows = useMemo(() => {
    const mainZoneByIdx = new Map(dropperSummaries.map((d) => [d.dropperIndex, d.zoneType]));
    const subZoneById = new Map(subDropperSummaries.map((sd) => [sd.id, sd.zoneType]));

    return rows.filter((r) => {
      if (zoneFilter === 'BOOSTER') {
        const isRoofWithBooster =
          r.input.supplyMode === SupplyMode.ROOF_HEADER &&
          (result.boosterDropperPipes > 0 || result.boosterSubDropperPipes > 0);
        const servedByBoostedMain = Object.values(r.dropperCells).some(
          (c) => c.isServed && mainZoneByIdx.get(c.dropperIndex) === 'Booster'
        );
        const servedByBoostedSub = Object.values(r.subDropperCells).some(
          (c) => c.isServed && subZoneById.get(c.subDropperId) === 'Booster'
        );
        if (!isRoofWithBooster && !servedByBoostedMain && !servedByBoostedSub) {
          return false;
        }
      }
      if (zoneFilter === 'GRAVITY') {
        if (r.input.supplyMode === SupplyMode.ROOF_HEADER) return false;
        const servedByGravityMain = Object.values(r.dropperCells).some(
          (c) => c.isServed && mainZoneByIdx.get(c.dropperIndex) === 'Gravity'
        );
        const servedByGravitySub = Object.values(r.subDropperCells).some(
          (c) => c.isServed && subZoneById.get(c.subDropperId) === 'Gravity'
        );
        if (!servedByGravityMain && !servedByGravitySub) {
          return false;
        }
      }
      if (zoneFilter === 'PRV_ONLY') {
        const hasMainPrv = Object.values(r.dropperCells).some((c) => c.hasPrv);
        const hasSubPrv = Object.values(r.subDropperCells).some((c) => c.hasPrv);
        if (!hasMainPrv && !hasSubPrv) return false;
      }
      if (searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        const labelMatch = r.input.floorLabel.toLowerCase().includes(q);
        const tagMatch = r.equipmentTag.toLowerCase().includes(q);
        const subMatch = subDropperSummaries.some(
          (sd) =>
            (r.subDropperCells[sd.id]?.isServed || r.subDropperCells[sd.id]?.hasPrv) &&
            sd.label.toLowerCase().includes(q)
        );
        if (!labelMatch && !tagMatch && !subMatch) return false;
      }
      return true;
    });
  }, [
    rows,
    zoneFilter,
    searchQuery,
    dropperSummaries,
    subDropperSummaries,
    result.boosterDropperPipes,
    result.boosterSubDropperPipes,
  ]);

  return (
    <div className="bg-white flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Schedule Filter & Search Toolbar */}
      <div className="shrink-0 px-3.5 py-2.5 bg-[#f8f8f8] border-b border-[#e0e0e0] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center border border-[#e0e0e0] bg-white">
            {(
              [
                { id: 'ALL', label: 'All Levels' },
                { id: 'BOOSTER', label: 'Booster' },
                { id: 'GRAVITY', label: 'Gravity' },
                { id: 'PRV_ONLY', label: 'PRVs' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setZoneFilter(tab.id)}
                className={`px-2.5 py-1 font-display text-[10px] font-bold uppercase transition-colors whitespace-nowrap shrink-0 border-r last:border-r-0 border-[#e0e0e0] ${
                  zoneFilter === tab.id
                    ? 'bg-[#121212] text-white'
                    : 'bg-white text-[#555555] hover:text-[#121212]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {riserColumns.length > 1 && (
            <label className="flex items-center gap-1.5 text-[11px] text-[#555555] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showExpressDiameters}
                onChange={(e) => setShowExpressDiameters(e.target.checked)}
                className="accent-[#121212]"
              />
              <span>Express diameters</span>
            </label>
          )}

          {result.pipeHeader.nominalMm && (
            <div
              data-testid="schedule-pipe-header-badge"
              title={`Roof Pipe Header (${
                PIPE_SPEC_TABLES[result.pipeHeader.specId]?.fullName ?? pipeSpec.fullName
              }${
                result.pipeHeader.isCustomSize ? ' · Custom Override' : ' · Auto-Sized'
              }): Ø${result.pipeHeader.nominalMm} mm (di ${formatPipeDim(
                result.pipeHeader.innerMm,
                PIPE_SPEC_TABLES[result.pipeHeader.specId] ?? pipeSpec
              )} mm) · ${result.pipeHeader.flowRateLs.toFixed(2)} L/s · V = ${
                result.pipeHeader.velocityMs?.toFixed(2) ?? '—'
              } / ≤ ${result.pipeHeader.maxVelocityMs.toFixed(1)} m/s`}
              className={`px-2 py-0.5 bg-white border font-mono tabular-nums text-[10px] font-semibold whitespace-nowrap ${
                result.pipeHeader.exceedsMaxCapacity
                  ? 'border-[#dc2626] text-[#d90000] bg-[#fef2f2]'
                  : result.pipeHeader.isCustomSize || result.pipeHeader.isFallbackMaterial
                  ? 'border-[#1d4ed8] text-[#1d4ed8] bg-[#eff6ff]'
                  : 'border-[#cccccc] text-[#121212]'
              }`}
            >
              Header:{' '}
              {result.pipeHeader.isFallbackMaterial
                ? `${getPipeSpecBadgeLabel(result.pipeHeader.specId)} `
                : ''}
              Ø{result.pipeHeader.nominalMm}
              {result.pipeHeader.isCustomSize ? '*' : ''}
              {' · '}
              {result.pipeHeader.velocityMs !== null
                ? `${result.pipeHeader.velocityMs.toFixed(2)}/${result.pipeHeader.maxVelocityMs.toFixed(
                    1
                  )} m/s`
                : '—'}
              {result.pipeHeader.exceedsMaxCapacity ? ' !' : ''}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden xl:inline text-[11px] text-[#666666]">
            Click Equip. to toggle PRV pin · Click amber P2 cell to edit set pressure
          </span>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter floor or PRV..."
              aria-label="Filter floor or equipment"
              className="h-7 pl-7 pr-2.5 text-xs font-mono bg-white border border-[#e0e0e0] text-[#121212] placeholder:text-[#888888] focus:border-[#121212] focus:outline-none w-40"
            />
          </div>
        </div>
      </div>

      {/* Main Engineering Calculation Schedule Table */}
      <div className="flex-1 min-h-0 max-h-[70vh] lg:max-h-none overflow-y-auto overflow-x-auto bg-white">
        <table className="w-full text-[11px] border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#eeeeee] text-[#121212] font-display text-[10px] uppercase">
              <th
                rowSpan={2}
                className="w-px py-2 px-2 text-left font-bold bg-[#eeeeee] border-r border-[#e0e0e0] border-b-2 border-b-[#121212] whitespace-nowrap"
              >
                Level
              </th>
              <th className="w-px py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-r border-b border-[#e0e0e0] whitespace-nowrap">
                Height
              </th>
              <th
                colSpan={2}
                className="py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-r border-b border-[#e0e0e0] whitespace-nowrap"
              >
                Static Head
              </th>
              <th
                rowSpan={2}
                className="w-[144px] min-w-[144px] max-w-[144px] py-2 px-2 text-center font-bold bg-[#eeeeee] border-r border-[#e0e0e0] border-b-2 border-b-[#121212] whitespace-nowrap"
              >
                Equip. / Fitting
              </th>
              <th className="py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-r border-b border-[#e0e0e0] whitespace-nowrap">
                Flow
              </th>
              <th className="py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-r border-b border-[#e0e0e0] whitespace-nowrap">
                ΔP
              </th>
              <th className="py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-r border-b border-[#e0e0e0] whitespace-nowrap">
                Ratio
              </th>
              <th
                colSpan={2}
                className="py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-r border-b border-[#e0e0e0] whitespace-nowrap"
              >
                Loading Units
              </th>
              <th
                colSpan={Math.max(1, riserColumns.length)}
                className={`py-1.5 px-2 text-center font-bold border-r border-b border-[#e0e0e0] bg-[#e5e5e5] text-[#121212] ${
                  riserColumns.length >= 3 ? 'whitespace-nowrap' : 'leading-tight'
                }`}
              >
                Working Pressure
              </th>
              <th
                colSpan={showExpressDiameters && riserColumns.length > 1 ? riserColumns.length : 1}
                className="py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-r border-b border-[#e0e0e0] whitespace-nowrap"
              >
                Nominal Size ({pipeSpec.materialFamily}
                {optionalPipeSpec && result.usesFallbackMaterial
                  ? ` / ${optionalPipeSpec.materialFamily}`
                  : ''}
                )
              </th>
              <th className="py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-r border-b border-[#e0e0e0] whitespace-nowrap">
                di
              </th>
              <th className="py-1.5 px-2 text-center font-bold bg-[#eeeeee] border-b border-[#e0e0e0] whitespace-nowrap">
                Vel.
              </th>
            </tr>

            <tr className="bg-[#f8f8f8] text-[10px] text-[#555555] font-mono">
              <th className="w-px py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212] whitespace-nowrap">
                m
              </th>
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                m
              </th>
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                bar
              </th>
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                L/s
              </th>
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                bar
              </th>
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                P1/P2
              </th>
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                Flr
              </th>
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                Cum
              </th>
              {riserColumns.length > 0 ? (
                riserColumns.map((col) => {
                  const effBoost =
                    col.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                  const isEditingThisBoost = editingBoostCol?.key === col.key;

                  const commitBoostCol = () => {
                    if (!editingBoostCol) return;
                    const trimmed = boostColDraft.trim();
                    if (onSetBoosterPressure) {
                      if (trimmed === '') {
                        onSetBoosterPressure(editingBoostCol.target, null);
                      } else {
                        const parsed = parseFloat(trimmed);
                        if (!Number.isNaN(parsed) && parsed > 0) {
                          const rounded =
                            Math.round(Math.min(15, Math.max(0.1, parsed)) * 100) / 100;
                          if (
                            editingBoostCol.wasCustom ||
                            Math.abs(rounded - parameters.boosterPumpBoostBar) >= 1e-6
                          ) {
                            onSetBoosterPressure(editingBoostCol.target, rounded);
                          }
                        }
                      }
                    }
                    setEditingBoostCol(null);
                  };

                  const cancelBoostCol = () => {
                    if (editingBoostCol && onSetBoosterPressure) {
                      onSetBoosterPressure(
                        editingBoostCol.target,
                        editingBoostCol.wasCustom ? editingBoostCol.initialValue : null
                      );
                    }
                    setEditingBoostCol(null);
                  };

                  return (
                    <th
                      key={`p-head-${col.key}`}
                      className={`w-[78px] min-w-[78px] max-w-[78px] py-1 px-1.5 text-right font-semibold border-r border-[#e0e0e0] border-b-2 border-b-[#121212] whitespace-nowrap leading-tight relative ${
                        col.kind === 'sub'
                          ? 'bg-[#ecfeff] text-[#0891b2]'
                          : col.hasBoosterPump
                          ? col.isCustomBoosterPressure
                            ? 'bg-[#eef2ff] text-[#1d4ed8]'
                            : 'bg-[#eff6ff] text-[#0369a1]'
                          : 'bg-[#efefef] text-[#121212]'
                      }`}
                    >
                      <div>{col.shortLabel} (b)</div>
                      {col.hasBoosterPump && onSetBoosterPressure ? (
                        isEditingThisBoost ? (
                          <div className="relative mt-0.5">
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              max="15.0"
                              autoFocus
                              onFocus={(e) => e.currentTarget.select()}
                              value={boostColDraft}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setBoostColDraft(raw);
                                const parsed = parseFloat(raw);
                                if (!Number.isNaN(parsed) && parsed >= 0.1 && parsed <= 15) {
                                  const rounded = Math.round(parsed * 100) / 100;
                                  if (
                                    !editingBoostCol.wasCustom &&
                                    Math.abs(rounded - parameters.boosterPumpBoostBar) < 1e-6
                                  ) {
                                    return;
                                  }
                                  onSetBoosterPressure(col.target, rounded);
                                }
                              }}
                              onBlur={commitBoostCol}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitBoostCol();
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelBoostCol();
                                }
                              }}
                              aria-label={`Set booster pressure bar for ${col.shortLabel}`}
                              data-testid={`schedule-boost-input-${col.shortLabel}`}
                              className="w-full h-5 px-1 text-right text-[10px] font-mono tabular-nums bg-white text-[#121212] border border-[#121212] focus:outline-none"
                            />
                            {col.isCustomBoosterPressure && (
                              <div
                                className="absolute right-0 top-full mt-0.5 z-20 bg-white border border-[#121212] px-1.5 py-0.5 shadow-sm"
                                onMouseDown={(e) => e.preventDefault()}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSetBoosterPressure(col.target, null);
                                    setEditingBoostCol(null);
                                  }}
                                  className="text-[9px] font-display font-bold uppercase text-[#121212] hover:underline whitespace-nowrap"
                                >
                                  Reset +{parameters.boosterPumpBoostBar.toFixed(1)}b
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBoostCol({
                                key: col.key,
                                target: col.target,
                                shortLabel: col.shortLabel,
                                initialValue: effBoost,
                                wasCustom: col.isCustomBoosterPressure,
                              });
                              setBoostColDraft(effBoost.toFixed(2));
                            }}
                            title={
                              col.isCustomBoosterPressure
                                ? `${col.shortLabel} custom booster +${effBoost.toFixed(
                                    2
                                  )} bar (Global +${parameters.boosterPumpBoostBar.toFixed(
                                    2
                                  )} bar) — Click to edit or reset`
                                : `${col.shortLabel} booster +${effBoost.toFixed(
                                    2
                                  )} bar (Global default) — Click to override`
                            }
                            data-testid={`schedule-boost-header-${col.shortLabel}`}
                            className={`text-[9px] font-mono font-semibold px-1 py-0 border transition-colors cursor-pointer ${
                              col.isCustomBoosterPressure
                                ? 'bg-[#dbeafe] text-[#1d4ed8] border-[#1d4ed8]/60 hover:bg-[#bfdbfe]'
                                : 'bg-white/80 text-[#0369a1] border-[#0369a1]/40 hover:bg-[#e0f2fe]'
                            }`}
                          >
                            +{effBoost.toFixed(1)}b{col.isCustomBoosterPressure ? '*' : ''}
                          </button>
                        )
                      ) : (
                        <div
                          className={`text-[9px] font-normal ${
                            col.hasBoosterPump ? 'text-[#0369a1]' : 'text-[#666666]'
                          }`}
                        >
                          {col.hasBoosterPump
                            ? `+${effBoost.toFixed(1)}b${col.isCustomBoosterPressure ? '*' : ''}`
                            : col.zoneType === 'Booster'
                            ? '←Boost'
                            : 'Grav'}
                        </div>
                      )}
                    </th>
                  );
                })
              ) : (
                <th className="w-[74px] min-w-[74px] py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                  bar
                </th>
              )}
              {showExpressDiameters && riserColumns.length > 1 ? (
                riserColumns.map((col) => (
                  <th
                    key={`d-head-${col.key}`}
                    className={`w-[70px] min-w-[70px] max-w-[70px] py-1 px-2 text-right font-semibold border-r border-[#e0e0e0] border-b-2 border-b-[#121212] whitespace-nowrap ${
                      col.kind === 'sub'
                        ? 'bg-[#f0fdfa] text-[#0891b2]'
                        : 'bg-[#f8f8f8] text-[#121212]'
                    }`}
                  >
                    {col.shortLabel} (mm)
                  </th>
                ))
              ) : (
                <th className="w-[70px] min-w-[70px] py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                  mm
                </th>
              )}
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-r border-[#e0e0e0] border-b-2 border-b-[#121212]">
                mm
              </th>
              <th className="py-1 px-2 text-right font-semibold bg-[#f8f8f8] border-b-2 border-b-[#121212]">
                m/s
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={13 + Math.max(1, riserColumns.length) * 2}
                  className="py-12 px-4 text-center border-b border-[#e0e0e0]"
                >
                  <div className="text-xs font-semibold text-[#121212]">
                    No building floors configured yet.
                  </div>
                  <p className="text-xs text-[#666666] mt-1">
                    Add floors manually, run the parametric tower generator, or load a template.
                  </p>
                  {onOpenFloorInputs && (
                    <button
                      type="button"
                      onClick={onOpenFloorInputs}
                      className="mt-3 px-3.5 py-2 font-display text-[10px] font-bold uppercase text-white bg-[#121212] hover:bg-[#2a2a2a] transition-colors"
                    >
                      Open Floor Data Input
                    </button>
                  )}
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={13 + Math.max(1, riserColumns.length) * 2}
                  className="py-10 text-center text-xs text-[#666666] border-b border-[#e0e0e0]"
                >
                  No floor rows match the current filter.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setZoneFilter('ALL');
                      setSearchQuery('');
                    }}
                    className="text-[#121212] font-semibold underline ml-1"
                  >
                    Reset filters
                  </button>
                </td>
              </tr>
            ) : (
              filteredRows.map((row, filteredIdx) => (
                <ScheduleRowItem
                  key={row.input.id}
                  row={row}
                  isNearBottom={filteredIdx >= filteredRows.length - 3}
                  result={result}
                  riserColumns={riserColumns}
                  showExpressDiameters={showExpressDiameters}
                  onCyclePrvOverride={onCyclePrvOverride}
                  onSetPrvPressure={onSetPrvPressure}
                  editingPrvCell={editingPrvCell}
                  prvDraft={prvDraft}
                  onStartEditPrv={(floorId, target, targetKey, currentP2, wasCustom) => {
                    setEditingPrvCell({
                      floorId,
                      target,
                      targetKey,
                      initialValue: currentP2,
                      wasCustom,
                    });
                    setPrvDraft(currentP2.toFixed(2));
                  }}
                  onChangePrvDraft={(raw) => {
                    setPrvDraft(raw);
                    if (!editingPrvCell || !onSetPrvPressure) return;
                    const parsed = parseFloat(raw);
                    if (!Number.isNaN(parsed) && parsed >= 0.1 && parsed <= 20) {
                      const rounded = Math.round(parsed * 100) / 100;
                      if (
                        !editingPrvCell.wasCustom &&
                        Math.abs(rounded - parameters.prvSetPressureBar) < 1e-6
                      ) {
                        return;
                      }
                      onSetPrvPressure(
                        editingPrvCell.floorId,
                        editingPrvCell.target,
                        rounded
                      );
                    }
                  }}
                  onCommitPrvEdit={() => {
                    if (!editingPrvCell) return;
                    const trimmed = prvDraft.trim();
                    if (onSetPrvPressure) {
                      if (trimmed === '') {
                        onSetPrvPressure(
                          editingPrvCell.floorId,
                          editingPrvCell.target,
                          null
                        );
                      } else {
                        const parsed = parseFloat(trimmed);
                        if (!Number.isNaN(parsed) && parsed > 0) {
                          const rounded = Math.round(parsed * 100) / 100;
                          if (
                            editingPrvCell.wasCustom ||
                            Math.abs(rounded - parameters.prvSetPressureBar) >= 1e-6
                          ) {
                            onSetPrvPressure(
                              editingPrvCell.floorId,
                              editingPrvCell.target,
                              rounded
                            );
                          }
                        }
                      }
                    }
                    setEditingPrvCell(null);
                  }}
                  onCancelPrvEdit={() => {
                    if (editingPrvCell && onSetPrvPressure) {
                      onSetPrvPressure(
                        editingPrvCell.floorId,
                        editingPrvCell.target,
                        editingPrvCell.wasCustom ? editingPrvCell.initialValue : null
                      );
                    }
                    setEditingPrvCell(null);
                  }}
                  onResetPrvToGlobal={(floorId, target) => {
                    if (onSetPrvPressure) {
                      onSetPrvPressure(floorId, target, null);
                    }
                    setEditingPrvCell(null);
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 px-3.5 py-2 bg-[#f8f8f8] border-t border-[#e0e0e0] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#555555]">
        <div>
          <span>Primary: {pipeSpec.fullName}</span>
          {optionalPipeSpec && (
            <>
              <span className="mx-2" aria-hidden="true">·</span>
              <span className={result.usesFallbackMaterial ? 'text-[#1d4ed8] font-medium' : ''}>
                Optional: {optionalPipeSpec.fullName}
              </span>
            </>
          )}
          <span className="mx-2" aria-hidden="true">·</span>
          <span>Vmax ≤ {parameters.maxVelocityMs.toFixed(1)} m/s</span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>Pmax ≤ {parameters.maxStaticPressureBar.toFixed(2)} bar</span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>Pset = {parameters.prvSetPressureBar.toFixed(2)} bar</span>
        </div>
        <div>
          <span>* Express or pass-through riser pipe segment</span>
          {result.usesFallbackMaterial && (
            <>
              <span className="mx-2" aria-hidden="true">·</span>
              <span className="text-[#1d4ed8]">Blue = Optional fallback material</span>
            </>
          )}
          {result.splitFloorCount > 0 && (
            <>
              <span className="mx-2" aria-hidden="true">·</span>
              <span className="text-[#1d4ed8]">◐ Split floor load across multiple risers</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface ScheduleRowItemProps {
  row: CalculatedFloorRow;
  isNearBottom: boolean;
  result: SystemCalculationResult;
  riserColumns: ScheduleRiserCol[];
  showExpressDiameters: boolean;
  onCyclePrvOverride: (floorId: string) => void;
  onSetPrvPressure?: (
    floorId: string,
    target: number | RiserTarget,
    downstreamPressureBar: number | null
  ) => void;
  editingPrvCell: {
    floorId: string;
    target: RiserTarget;
    targetKey: string;
    initialValue: number;
    wasCustom: boolean;
  } | null;
  prvDraft: string;
  onStartEditPrv: (
    floorId: string,
    target: RiserTarget,
    targetKey: string,
    currentP2: number,
    wasCustom: boolean
  ) => void;
  onChangePrvDraft: (raw: string) => void;
  onCommitPrvEdit: () => void;
  onCancelPrvEdit: () => void;
  onResetPrvToGlobal: (floorId: string, target: RiserTarget) => void;
}

const ScheduleRowItem: React.FC<ScheduleRowItemProps> = ({
  row,
  isNearBottom,
  result,
  riserColumns,
  showExpressDiameters,
  onCyclePrvOverride,
  onSetPrvPressure,
  editingPrvCell,
  prvDraft,
  onStartEditPrv,
  onChangePrvDraft,
  onCommitPrvEdit,
  onCancelPrvEdit,
  onResetPrvToGlobal,
}) => {
  const { subDropperSummaries, parameters } = result;
  const isRoof = row.input.supplyMode === SupplyMode.ROOF_HEADER;

  const subPrvCells = Object.values(row.subDropperCells).filter((c) => c.hasPrv && c.prvDetail);
  const mainPrvCells = Object.values(row.dropperCells).filter((c) => c.hasPrv && c.prvDetail);
  const allPrvCells = [...subPrvCells, ...mainPrvCells];
  const firstPrv =
    subPrvCells.find((c) => c.isServed)?.prvDetail ??
    mainPrvCells.find((c) => c.isServed)?.prvDetail ??
    allPrvCells[0]?.prvDetail;
  const firstPrvIsServed =
    subPrvCells.find((c) => c.isServed)?.isServed ??
    mainPrvCells.find((c) => c.isServed)?.isServed ??
    allPrvCells[0]?.isServed ??
    false;

  const hasCustomSet = allPrvCells.some((c) => c.prvDetail?.isCustomSetPressure);
  const hasCavitation = allPrvCells.some((c) => c.prvDetail?.cavitationWarning);

  const velExceeded =
    row.primaryVelocityMs !== null && row.primaryVelocityMs > parameters.maxVelocityMs + 1e-4;

  const primarySdSummary = row.primarySubDropperId
    ? subDropperSummaries.find((s) => s.id === row.primarySubDropperId)
    : undefined;
  const firstPrvSubLabel = firstPrv?.subDropperId
    ? subDropperSummaries.find((s) => s.id === firstPrv.subDropperId)?.label
    : undefined;

  const rowBg = isRoof
    ? 'bg-[#eeeeee]'
    : firstPrv
    ? 'bg-amber-50/50 hover:bg-amber-50'
    : 'hover:bg-[#f8f8f8]';

  const effectiveOverride = row.primarySubDropperId
    ? row.input.subDropperPrvOverrides?.[row.primarySubDropperId] ?? row.input.prvOverride
    : row.input.prvOverride;

  return (
    <tr className={`${rowBg} transition-colors`}>
      <td className="w-px py-1.5 px-2 font-semibold text-[#121212] border-r border-b border-[#e0e0e0] whitespace-nowrap">
        {row.input.floorLabel}
      </td>

      <td className="w-px py-1.5 px-2 text-right font-mono tabular-nums text-[#555555] border-r border-b border-[#e0e0e0] whitespace-nowrap">
        {row.input.floorHeightM.toFixed(2)}
      </td>

      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[#121212] border-r border-b border-[#e0e0e0]">
        {row.cumulativeHeadM.toFixed(2)}
      </td>

      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[#121212] border-r border-b border-[#e0e0e0]">
        {row.staticPressureBar.toFixed(2)}
      </td>

      <td className="w-[144px] min-w-[144px] max-w-[144px] py-1 px-1.5 text-center border-r border-b border-[#e0e0e0] overflow-hidden">
        {isRoof ? (
          <span
            className={`block w-full truncate font-mono font-semibold ${
              row.equipmentTag === 'Pump'
                ? row.boostedRiserDetails?.some((d) => d.isCustom)
                  ? 'text-[#1d4ed8]'
                  : 'text-[#0369a1]'
                : 'text-[#121212]'
            }`}
            title={
              row.equipmentTag === 'Pump' && row.boostedRiserDetails?.length
                ? `Booster Pumps: ${row.boostedRiserDetails
                    .map(
                      (d) =>
                        `${d.label} +${d.boostBar.toFixed(2)} bar${d.isCustom ? ' (Custom)' : ''}`
                    )
                    .join(', ')}`
                : 'Roof Storage Tank Header (Gravity)'
            }
          >
            {row.equipmentTag === 'Pump'
              ? row.boostedRiserDetails && row.boostedRiserDetails.length > 0
                ? `Pump (${row.boostedRiserDetails
                    .map((d) => `${d.label}${d.isCustom ? '*' : ''}`)
                    .join(',')})`
                : 'Pump'
              : row.equipmentTag || 'Tank'}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onCyclePrvOverride(row.input.id)}
            title={
              firstPrv
                ? `${
                    firstPrvSubLabel
                      ? `${firstPrvSubLabel} PRV (DN${firstPrv.recommendedValveDn})`
                      : allPrvCells.length > 1 || !firstPrvIsServed
                      ? `D${firstPrv.dropperIndex} PRV (DN${firstPrv.recommendedValveDn})`
                      : `PRV (DN${firstPrv.recommendedValveDn})`
                  }${firstPrv.isManualOverride ? ' [Pin]' : ''}${
                    row.boostedRiserLabels?.length
                      ? ` · Booster Pump (${row.boostedRiserLabels.join(', ')})`
                      : ''
                  } — Click to cycle PRV mode`
                : 'Click to cycle PRV mode: Auto -> Force PRV -> Suppress PRV'
            }
            className="block w-full truncate px-1 py-0.5 text-[11px] font-mono transition-colors hover:bg-[#eeeeee] focus:outline-none focus:ring-1 focus:ring-[#121212]"
          >
            {firstPrv ? (
              <span className="font-semibold text-[#b45309]">
                {firstPrvSubLabel
                  ? `${firstPrvSubLabel} PRV (DN${firstPrv.recommendedValveDn})`
                  : allPrvCells.length > 1 || !firstPrvIsServed
                  ? `D${firstPrv.dropperIndex} PRV (DN${firstPrv.recommendedValveDn})`
                  : `PRV (DN${firstPrv.recommendedValveDn})`}
                {firstPrv.isManualOverride ? ' [Pin]' : ''}
                {hasCustomSet && (
                  <span className="text-[#1d4ed8]" title="Custom P2 override">
                    *
                  </span>
                )}
              </span>
            ) : row.equipmentTag === 'Gravity' ? (
              <span className="font-medium text-[#121212]">Gravity</span>
            ) : row.equipmentTag === 'Pump' ? (
              <span className="font-medium text-[#0369a1]">
                {row.boostedRiserLabels && row.boostedRiserLabels.length > 0
                  ? `Pump (${row.boostedRiserLabels.join(',')})`
                  : 'Pump'}
              </span>
            ) : effectiveOverride === PrvOverrideMode.NO_PRV ? (
              <span className="text-[#888888]">No PRV</span>
            ) : row.isSplitFloor ? (
              <span className="text-[#1d4ed8] font-medium">
                ◐ Split ({row.riserAllocations.map((a) => a.riserLabel).join(', ')})
              </span>
            ) : primarySdSummary ? (
              <span className="text-[#0891b2] font-medium">{primarySdSummary.label}</span>
            ) : (
              <span className="text-[#bbbbbb] hover:text-[#121212]">—</span>
            )}
          </button>
        )}
      </td>

      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[#121212] border-r border-b border-[#e0e0e0]">
        {row.primaryFlowRateLs !== null && row.primaryFlowRateLs > 0
          ? row.primaryFlowRateLs.toFixed(2)
          : '—'}
      </td>

      <td
        className={`py-1.5 px-2 text-right font-mono tabular-nums border-r border-b border-[#e0e0e0] whitespace-nowrap ${
          row.primaryDeltaPBar !== null && row.primaryDeltaPBar < 0
            ? 'text-[#b45309] font-medium'
            : row.primaryDeltaPBar !== null && row.primaryDeltaPBar > 0
            ? row.boostedRiserDetails?.some((d) => d.isCustom)
              ? 'text-[#1d4ed8] font-semibold'
              : 'text-[#0369a1] font-medium'
            : 'text-[#888888]'
        }`}
        title={
          row.primaryDeltaPBar !== null &&
          row.primaryDeltaPBar > 0 &&
          row.boostedRiserDetails?.length
            ? row.boostedRiserDetails
                .map(
                  (d) =>
                    `${d.label}: +${d.boostBar.toFixed(2)} bar${d.isCustom ? ' (Custom)' : ' (Global)'}`
                )
                .join(' · ')
            : undefined
        }
      >
        {formatRowDeltaPDisplay(row)}
      </td>

      <td
        className={`py-1.5 px-2 text-right font-mono tabular-nums border-r border-b border-[#e0e0e0] whitespace-nowrap ${
          hasCavitation
            ? 'text-[#d90000] font-bold bg-red-50'
            : row.primaryPrvRatio !== null
            ? 'text-[#121212] font-medium'
            : 'text-[#888888]'
        }`}
      >
        {row.primaryPrvRatio !== null ? (
          <>
            {row.primaryPrvRatio.toFixed(2)}
            {hasCavitation ? ' !' : ''}
          </>
        ) : (
          ''
        )}
      </td>

      <td
        className={`py-1.5 px-2 text-right font-mono tabular-nums border-r border-b border-[#e0e0e0] whitespace-nowrap ${
          row.isSplitFloor ? 'text-[#1d4ed8] font-semibold' : 'text-[#555555]'
        }`}
        title={
          row.isSplitFloor
            ? `Split Load: ${row.riserAllocations
                .map(
                  (a) =>
                    `${a.riserLabel} ${a.assignedLu.toFixed(1)} LU (${Math.round(
                      a.loadFraction * 100
                    )}%)`
                )
                .join(' · ')}`
            : undefined
        }
      >
        {isRoof
          ? formatLuDisplay(row.primaryCumulativeLu)
          : row.isSplitFloor
          ? `◐ ${formatLuDisplay(row.input.loadingUnits)}`
          : formatLuDisplay(row.input.loadingUnits)}
      </td>

      <td
        className="py-1.5 px-2 text-right font-mono tabular-nums text-[#121212] border-r border-b border-[#e0e0e0]"
        title={
          row.isSplitFloor
            ? `Branch Cum. LU: ${row.riserAllocations
                .map(
                  (a) =>
                    `${a.riserLabel} ${formatLuDisplay(a.cumulativeLu)} LU (${a.flowRateLs.toFixed(
                      2
                    )} L/s · Ø${a.nominalMm ?? '-'})`
                )
                .join(' · ')}`
            : undefined
        }
      >
        {row.primaryCumulativeLu > 0 ? formatLuDisplay(row.primaryCumulativeLu) : '—'}
      </td>

      {riserColumns.length > 0 ? (
        riserColumns.map((col) => {
          const cell =
            col.kind === 'main'
              ? row.dropperCells[col.dropperIndex]
              : row.subDropperCells[col.subDropperId];
          const isPrvCell = Boolean(cell?.hasPrv && cell.prvDetail);

          if (!isPrvCell && (!cell || !cell.isServed || cell.workingPressureBar === null)) {
            return (
              <td
                key={`p-${col.key}`}
                className="w-[74px] min-w-[74px] max-w-[74px] py-1.5 px-2 text-right font-mono tabular-nums text-[#bbbbbb] border-r border-b border-[#e0e0e0] bg-[#fafafa] whitespace-nowrap"
              >
                {cell?.isExpressPassThrough ? '┆' : ''}
              </td>
            );
          }

          if (isPrvCell && cell.prvDetail && onSetPrvPressure) {
            const prvDetail = cell.prvDetail;
            const isEditing =
              editingPrvCell?.floorId === row.input.id &&
              editingPrvCell?.targetKey === col.key;
            const overPressure =
              cell.isServed &&
              cell.workingPressureBar !== null &&
              cell.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;

            return (
              <td
                key={`p-${col.key}`}
                className={`w-[74px] min-w-[74px] max-w-[74px] p-0 text-right font-mono tabular-nums font-semibold border-r border-b border-[#e0e0e0] whitespace-nowrap ${
                  overPressure
                    ? 'text-[#d90000] bg-red-50'
                    : prvDetail.isCustomSetPressure
                    ? 'text-[#1e40af] bg-amber-100/60 shadow-[inset_2px_0_0_#1d4ed8]'
                    : 'text-[#92400e] bg-amber-100/50'
                }`}
              >
                <div className="relative">
                  {isEditing ? (
                    <>
                      <input
                        type="number"
                        step="0.05"
                        min="0.20"
                        max="12.00"
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        value={prvDraft}
                        onChange={(e) => onChangePrvDraft(e.target.value)}
                        onBlur={onCommitPrvEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            onCommitPrvEdit();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            onCancelPrvEdit();
                          }
                        }}
                        aria-label={`Set PRV P2 pressure bar for ${col.shortLabel} ${row.input.floorLabel}`}
                        data-testid={`schedule-p2-input-${col.shortLabel}-${row.input.floorLabel}`}
                        className="w-full h-7 px-1.5 text-right text-[11px] font-mono tabular-nums bg-white text-[#121212] border-2 border-[#121212] focus:outline-none"
                      />
                      <div
                        className={`absolute right-0 z-20 bg-white border border-[#121212] shadow-sm px-2 py-1 flex items-center gap-2 text-[10px] font-mono text-[#121212] whitespace-nowrap ${
                          isNearBottom ? 'bottom-full mb-0.5' : 'top-full mt-0.5'
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <span>
                          P1 {prvDetail.upstreamPressureBar.toFixed(2)}b · Ratio{' '}
                          <strong
                            className={
                              prvDetail.cavitationWarning ? 'text-[#d90000]' : 'text-[#15803d]'
                            }
                          >
                            {prvDetail.pressureRatio.toFixed(2)}x
                          </strong>
                        </span>
                        {prvDetail.isCustomSetPressure && (
                          <button
                            type="button"
                            onClick={() => onResetPrvToGlobal(row.input.id, col.target)}
                            className="px-1.5 py-0.5 bg-[#f8f8f8] border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white font-display text-[9px] font-bold uppercase"
                          >
                            Reset {parameters.prvSetPressureBar.toFixed(2)}b
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        onStartEditPrv(
                          row.input.id,
                          col.target,
                          col.key,
                          prvDetail.downstreamPressureBar,
                          prvDetail.isCustomSetPressure
                        )
                      }
                      title={`PRV ${col.shortLabel} P2 = ${prvDetail.downstreamPressureBar.toFixed(2)} bar${
                        prvDetail.isCustomSetPressure
                          ? ` (Custom override; global ${parameters.prvSetPressureBar.toFixed(2)} bar)`
                          : ' (Global default)'
                      } — Click to edit`}
                      data-testid={`schedule-p2-cell-${col.shortLabel}-${row.input.floorLabel}`}
                      className="w-full py-1.5 px-2 text-right font-mono tabular-nums font-semibold hover:ring-1 hover:ring-inset hover:ring-[#121212] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#121212] cursor-pointer transition-shadow relative"
                    >
                      {prvDetail.isCustomSetPressure && (
                        <span
                          aria-hidden="true"
                          className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-[#1d4ed8]"
                        />
                      )}
                      {cell.isServed ? (
                        <>
                          {prvDetail.downstreamPressureBar.toFixed(2)}
                          {overPressure ? ' !' : ''}
                        </>
                      ) : (
                        <span className="text-[10px]">
                          PRV {prvDetail.downstreamPressureBar.toFixed(2)}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </td>
            );
          }

          const overPressure =
            cell.workingPressureBar !== null &&
            cell.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;
          return (
            <td
              key={`p-${col.key}`}
              className={`w-[74px] min-w-[74px] max-w-[74px] py-1.5 px-2 text-right font-mono tabular-nums font-semibold border-r border-b border-[#e0e0e0] whitespace-nowrap ${
                overPressure
                  ? 'text-[#d90000] bg-red-50'
                  : cell.hasPrv
                  ? 'text-[#92400e] bg-amber-100/50'
                  : col.kind === 'sub'
                  ? 'text-[#0891b2] bg-[#f0fdfa]'
                  : col.zoneType === 'Booster'
                  ? 'text-[#0369a1] bg-[#f8f8f8]'
                  : 'text-[#121212] bg-[#f8f8f8]'
              }`}
            >
              {cell.workingPressureBar !== null ? cell.workingPressureBar.toFixed(2) : ''}
              {overPressure ? ' !' : ''}
            </td>
          );
        })
      ) : (
        <td className="w-[74px] min-w-[74px] py-1.5 px-2 text-right font-mono tabular-nums border-r border-b border-[#e0e0e0]">—</td>
      )}

      {showExpressDiameters && riserColumns.length > 1 ? (
        riserColumns.map((col) => {
          const cell =
            col.kind === 'main'
              ? row.dropperCells[col.dropperIndex]
              : row.subDropperCells[col.subDropperId];
          if (!cell || cell.selectedNominalMm === null) {
            return (
              <td
                key={`d-${col.key}`}
                className="w-[70px] min-w-[70px] max-w-[70px] py-1.5 px-2 text-right font-mono tabular-nums text-[#bbbbbb] border-r border-b border-[#e0e0e0] whitespace-nowrap"
              >
                {''}
              </td>
            );
          }
          const cellSpec = PIPE_SPEC_TABLES[cell.selectedSpecId] ?? result.pipeSpec;
          const fallbackTag = cell.isFallbackMaterial
            ? `${getPipeSpecBadgeLabel(cell.selectedSpecId)} `
            : '';
          return (
            <td
              key={`d-${col.key}`}
              title={
                cell.isFallbackMaterial
                  ? `Fallback Material: ${cellSpec.fullName} ${cell.selectedNominalMm} mm (di ${formatPipeDim(
                      cell.selectedInnerMm,
                      cellSpec
                    )} mm, req di ≥ ${cell.requiredInnerDiaMm?.toFixed(1) ?? '?'} mm)`
                  : cell.exceedsMaxPipeCapacity
                  ? `Sizing shortfall: requires di ≥ ${
                      cell.requiredInnerDiaMm?.toFixed(1) ?? '?'
                    } mm; showing largest primary ${cellSpec.fullName} (${cell.selectedNominalMm} mm, di ${formatPipeDim(
                      cell.selectedInnerMm,
                      cellSpec
                    )} mm)`
                  : undefined
              }
              className={`min-w-[70px] py-1.5 px-2 text-right font-mono tabular-nums border-r border-b border-[#e0e0e0] whitespace-nowrap ${
                cell.exceedsMaxPipeCapacity
                  ? 'text-[#d90000] font-bold bg-red-50'
                  : cell.isFallbackMaterial
                  ? 'text-[#1d4ed8] font-semibold bg-blue-50/50'
                  : cell.isExpressPassThrough
                  ? 'text-[#666666]'
                  : col.kind === 'sub'
                  ? 'text-[#0891b2] font-semibold'
                  : 'text-[#121212] font-semibold'
              }`}
            >
              {fallbackTag}
              {cell.selectedNominalMm}
              {cell.isExpressPassThrough && !isRoof ? '*' : ''}
              {cell.exceedsMaxPipeCapacity ? ' !' : ''}
            </td>
          );
        })
      ) : (
        <td
          className={`min-w-[70px] py-1.5 px-2 text-right font-mono tabular-nums font-semibold border-r border-b border-[#e0e0e0] whitespace-nowrap ${
            velExceeded
              ? 'text-[#d90000] bg-red-50'
              : row.primaryIsFallbackMaterial
              ? 'text-[#1d4ed8] bg-blue-50/50'
              : 'text-[#121212]'
          }`}
        >
          {row.primaryNominalMm !== null ? (
            <>
              {row.primaryIsFallbackMaterial
                ? `${getPipeSpecBadgeLabel(row.primarySpecId)} `
                : ''}
              {row.primaryNominalMm}
              {velExceeded ? ' !' : ''}
            </>
          ) : (
            '—'
          )}
        </td>
      )}

      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[#555555] border-r border-b border-[#e0e0e0]">
        {row.primaryInnerMm !== null
          ? formatPipeDim(
              row.primaryInnerMm,
              PIPE_SPEC_TABLES[row.primarySpecId] ?? result.pipeSpec
            )
          : '—'}
      </td>

      <td
        className={`py-1.5 px-2 text-right font-mono tabular-nums font-medium border-b border-[#e0e0e0] whitespace-nowrap ${
          velExceeded ? 'text-[#d90000] bg-red-50' : 'text-[#121212]'
        }`}
      >
        {row.primaryVelocityMs !== null ? row.primaryVelocityMs.toFixed(2) : '—'}
      </td>
    </tr>
  );
};

import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { formatPipeDim, getPipeSpecBadgeLabel, PIPE_SPEC_TABLES } from '../data/pipeSpecs';
import { RiserTarget, SystemCalculationResult } from '../types/hydraulics';

interface SummaryDashboardProps {
  result: SystemCalculationResult;
  selectedRiser: RiserTarget | null;
  onSelectRiser: (target: RiserTarget) => void;
  onToggleBoosterPump?: (target: RiserTarget) => void;
  onSetBoosterPressure?: (target: RiserTarget, pressureBar: number | null) => void;
}

const PumpBadgeGlyph: React.FC<{ active: boolean; custom?: boolean }> = ({
  active,
  custom = false,
}) => (
  <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 shrink-0" aria-hidden="true">
    <circle
      cx="6"
      cy="6"
      r="4.6"
      fill={active ? (custom ? '#eef2ff' : '#e0f2fe') : 'none'}
      stroke="currentColor"
      strokeWidth="1.2"
    />
    {active ? (
      <polygon points="4.5,3.7 8.8,6 4.5,8.3" fill="currentColor" />
    ) : (
      <path d="M6 3.5V8.5M3.5 6H8.5" stroke="currentColor" strokeWidth="1.2" />
    )}
  </svg>
);

export const SummaryDashboard: React.FC<SummaryDashboardProps> = ({
  result,
  selectedRiser,
  onSelectRiser,
  onToggleBoosterPump,
  onSetBoosterPressure,
}) => {
  const {
    parameters,
    dropperSummaries,
    subDropperSummaries,
    prvList,
    totalBuildingLu,
    peakSystemFlowLs,
    totalBuildingHeightM,
    maxStaticHeadBar,
    totalPhysicalDropperPipes,
    totalSubDropperPipes,
    boosterDropperPipes,
    gravityDropperPipes,
  } = result;

  const [editingBoost, setEditingBoost] = useState<{
    key: string;
    target: RiserTarget;
    label: string;
    initialValue: number;
    wasCustom: boolean;
  } | null>(null);
  const [boostDraft, setBoostDraft] = useState<string>('');

  const totalCavitationCount = prvList.filter((p) => p.cavitationWarning).length;
  const customPrvCount = prvList.filter((p) => p.isCustomSetPressure).length;
  const customBoosterCount =
    dropperSummaries.filter((d) => d.isCustomBoosterPressure).length +
    subDropperSummaries.filter((sd) => sd.isCustomBoosterPressure).length;

  const startEditingBoost = (
    key: string,
    target: RiserTarget,
    label: string,
    currentBar: number,
    wasCustom: boolean
  ) => {
    setEditingBoost({ key, target, label, initialValue: currentBar, wasCustom });
    setBoostDraft(currentBar.toFixed(2));
  };

  const handleBoostDraftChange = (raw: string) => {
    setBoostDraft(raw);
    if (!editingBoost || !onSetBoosterPressure) return;
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed) && parsed >= 0.1 && parsed <= 15) {
      const rounded = Math.round(parsed * 100) / 100;
      if (
        !editingBoost.wasCustom &&
        Math.abs(rounded - parameters.boosterPumpBoostBar) < 1e-6
      ) {
        return;
      }
      onSetBoosterPressure(editingBoost.target, rounded);
    }
  };

  const commitBoostEdit = () => {
    if (!editingBoost) return;
    const trimmed = boostDraft.trim();
    if (onSetBoosterPressure) {
      if (trimmed === '') {
        onSetBoosterPressure(editingBoost.target, null);
      } else {
        const parsed = parseFloat(trimmed);
        if (!Number.isNaN(parsed) && parsed > 0) {
          const rounded = Math.round(Math.min(15, Math.max(0.1, parsed)) * 100) / 100;
          if (
            editingBoost.wasCustom ||
            Math.abs(rounded - parameters.boosterPumpBoostBar) >= 1e-6
          ) {
            onSetBoosterPressure(editingBoost.target, rounded);
          }
        }
      }
    }
    setEditingBoost(null);
  };

  const cancelBoostEdit = () => {
    if (editingBoost && onSetBoosterPressure) {
      onSetBoosterPressure(
        editingBoost.target,
        editingBoost.wasCustom ? editingBoost.initialValue : null
      );
    }
    setEditingBoost(null);
  };

  const resetBoostToGlobal = (target: RiserTarget) => {
    if (onSetBoosterPressure) {
      onSetBoosterPressure(target, null);
    }
    setEditingBoost(null);
  };

  const renderInlineBoostEditor = (
    key: string,
    target: RiserTarget,
    label: string,
    isCustom: boolean
  ) => {
    if (editingBoost?.key !== key) return null;
    return (
      <div
        className="mt-1 flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[9px] font-mono text-[#555555]">+</span>
        <input
          type="number"
          step="0.1"
          min="0.1"
          max="15.0"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={boostDraft}
          onChange={(e) => handleBoostDraftChange(e.target.value)}
          onBlur={commitBoostEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitBoostEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelBoostEdit();
            }
          }}
          aria-label={`Booster pump pressure bar for ${label}`}
          data-testid={`booster-pressure-input-${label}`}
          className="w-14 h-5 px-1 text-[10px] font-mono tabular-nums bg-white border border-[#121212] text-[#121212] focus:outline-none"
        />
        <span className="text-[9px] font-mono text-[#666666]">bar</span>
        {isCustom && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => resetBoostToGlobal(target)}
            title={`Reset ${label} booster to global default (${parameters.boosterPumpBoostBar.toFixed(
              2
            )} bar)`}
            data-testid={`reset-booster-pressure-${label}`}
            className="h-5 px-1 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] inline-flex items-center gap-0.5 text-[9px] font-display font-bold uppercase"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Dropper Schedule" className="border-t border-[#e0e0e0] bg-[#f8f8f8]">
      {/* Section Header */}
      <div className="px-2.5 py-1.5 bg-[#eeeeee] border-b border-[#e0e0e0] flex items-center justify-between gap-2">
        <h3 className="font-display text-[10px] font-bold uppercase tracking-[0.08em] text-[#121212] whitespace-nowrap">
          Dropper Schedule
        </h3>
        <span className="font-mono tabular-nums text-[10px] text-[#555555] whitespace-nowrap">
          {totalPhysicalDropperPipes} Main ({boosterDropperPipes}B · {gravityDropperPipes}G)
          {totalSubDropperPipes > 0
            ? ` · ${totalSubDropperPipes} Sub${
                result.boosterSubDropperPipes > 0 ? ` (${result.boosterSubDropperPipes}B)` : ''
              }`
            : ''}
        </span>
      </div>

      {/* Dropper Summary Table */}
      <div className="bg-white border-b border-[#e0e0e0]">
        <table className="w-full text-left border-collapse font-mono tabular-nums">
          <thead>
            <tr className="border-b border-[#121212] text-[10px] font-display uppercase text-[#555555] bg-[#f8f8f8]">
              <th className="py-1 px-2 font-bold">Dropper</th>
              <th className="py-1 px-1 font-bold">Levels</th>
              <th className="py-1 px-1 font-bold text-right">LU</th>
              <th className="py-1 px-1 font-bold text-right">Size</th>
              <th className="py-1 px-2 font-bold text-right">m/s</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e0e0e0]">
            {dropperSummaries.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 px-2.5 text-center font-sans text-xs text-[#666666]">
                  No dropper risers calculated yet. Add floors in Floor Data.
                </td>
              </tr>
            ) : (
              dropperSummaries.map((d) => {
                const velExceeded =
                  d.peakVelocityMs !== null &&
                  d.peakVelocityMs > parameters.maxVelocityMs + 1e-4;
                const isSelected =
                  selectedRiser?.kind === 'main' &&
                  selectedRiser.dropperIndex === d.dropperIndex;
                const attachedSubs = subDropperSummaries.filter(
                  (sd) => sd.parentDropperIndex === d.dropperIndex
                );
                const mainKey = `main-${d.dropperIndex}`;
                const mainTarget: RiserTarget = { kind: 'main', dropperIndex: d.dropperIndex };
                const effectiveBoostBar =
                  d.boosterPressureBar ?? parameters.boosterPumpBoostBar;

                return (
                  <React.Fragment key={mainKey}>
                    <tr
                      onClick={() => onSelectRiser(mainTarget)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#eeeeee]' : 'hover:bg-[#f8f8f8]'
                      }`}
                    >
                      <td className="py-1 px-2 align-top leading-tight">
                        <div className="text-[11px] font-semibold text-[#121212] whitespace-nowrap flex items-center gap-1">
                          <span>D{d.dropperIndex}</span>
                          {onToggleBoosterPump ? (
                            <span className="inline-flex items-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (editingBoost?.key === mainKey) setEditingBoost(null);
                                  onToggleBoosterPump(mainTarget);
                                }}
                                aria-pressed={d.hasBoosterPump}
                                aria-label={
                                  d.hasBoosterPump
                                    ? `Remove booster pump from D${d.dropperIndex}`
                                    : `Add booster pump to D${d.dropperIndex}`
                                }
                                title={
                                  d.hasBoosterPump
                                    ? `Booster pump active (+${effectiveBoostBar.toFixed(
                                        2
                                      )} bar${
                                        d.isCustomBoosterPressure ? ' · Custom' : ' · Global'
                                      }) on D${d.dropperIndex} — Click to remove booster pump`
                                    : `Gravity feed on D${d.dropperIndex} — Click to add booster pump (+${parameters.boosterPumpBoostBar.toFixed(
                                        2
                                      )} bar)`
                                }
                                data-testid={`toggle-booster-D${d.dropperIndex}`}
                                className={`inline-flex items-center gap-0.5 px-1 py-0 text-[10px] font-mono font-medium border transition-colors leading-tight ${
                                  d.hasBoosterPump
                                    ? d.isCustomBoosterPressure
                                      ? 'bg-[#eef2ff] text-[#1d4ed8] border-[#1d4ed8]/50 hover:bg-[#fee2e2] hover:text-[#d90000] hover:border-[#d90000]/50'
                                      : 'bg-[#e0f2fe] text-[#0369a1] border-[#0369a1]/40 hover:bg-[#fee2e2] hover:text-[#d90000] hover:border-[#d90000]/50'
                                    : 'bg-[#f4f4f4] text-[#555555] border-[#d4d4d4] hover:bg-[#e0f2fe] hover:text-[#0369a1] hover:border-[#0369a1]'
                                }`}
                              >
                                <PumpBadgeGlyph
                                  active={d.hasBoosterPump}
                                  custom={d.isCustomBoosterPressure}
                                />
                                <span>({d.hasBoosterPump ? 'Boost' : 'Grav'})</span>
                              </button>
                              {d.hasBoosterPump && onSetBoosterPressure && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditingBoost(
                                      mainKey,
                                      mainTarget,
                                      `D${d.dropperIndex}`,
                                      effectiveBoostBar,
                                      d.isCustomBoosterPressure
                                    );
                                  }}
                                  title={
                                    d.isCustomBoosterPressure
                                      ? `Custom booster pressure (+${effectiveBoostBar.toFixed(
                                          2
                                        )} bar; global ${parameters.boosterPumpBoostBar.toFixed(
                                          2
                                        )} bar) — Click to edit or reset`
                                      : `Global default booster pressure (+${effectiveBoostBar.toFixed(
                                          2
                                        )} bar) — Click to override for D${d.dropperIndex}`
                                  }
                                  data-testid={`edit-booster-pressure-D${d.dropperIndex}`}
                                  className={`-ml-px px-1 py-0 text-[10px] font-mono font-semibold border transition-colors leading-tight ${
                                    d.isCustomBoosterPressure
                                      ? 'bg-[#dbeafe] text-[#1d4ed8] border-[#1d4ed8]/60 hover:bg-[#bfdbfe]'
                                      : 'bg-white text-[#0369a1] border-[#0369a1]/40 hover:bg-[#e0f2fe]'
                                  }`}
                                >
                                  +{effectiveBoostBar.toFixed(1)}b
                                  {d.isCustomBoosterPressure ? '*' : ''}
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="font-normal text-[#555555]">
                              ({d.zoneType === 'Booster' ? 'Boost' : 'Grav'})
                            </span>
                          )}
                        </div>
                        {renderInlineBoostEditor(
                          mainKey,
                          mainTarget,
                          `D${d.dropperIndex}`,
                          d.isCustomBoosterPressure
                        )}
                        <div className="text-[10px] text-[#666666] whitespace-nowrap">
                          {d.peakFlowRateLs.toFixed(2)} L/s
                          {d.prvCount > 0 && (
                            <span className="text-[#b45309] font-medium">
                              {' '}
                              · {d.prvCount} PRV
                            </span>
                          )}
                          {d.splitFloorCount > 0 && (
                            <span className="text-[#1d4ed8] font-medium">
                              {' '}
                              · ◐{d.splitFloorCount}
                            </span>
                          )}
                          {d.cavitationRiskCount > 0 && (
                            <span className="text-[#d90000] font-semibold">
                              {' '}
                              · Cav!
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-1 px-1 align-top leading-tight text-[11px] text-[#333333] whitespace-nowrap">
                        <div>{d.servedFloorRange}</div>
                        <div className="text-[10px] text-[#666666]">
                          {d.minWorkingPressureBar !== null && d.maxWorkingPressureBar !== null
                            ? `${d.minWorkingPressureBar.toFixed(1)}–${d.maxWorkingPressureBar.toFixed(1)}b`
                            : `${d.servedFloorCount} flrs`}
                        </div>
                      </td>
                      <td className="py-1 px-1 align-top leading-tight text-right text-[11px] text-[#121212] whitespace-nowrap">
                        {Math.round(d.totalZoneLu)}
                      </td>
                      <td
                        className={`py-1 px-1 align-top leading-tight text-right text-[11px] whitespace-nowrap ${
                          d.exceedsCapacity
                            ? 'text-[#d90000] font-semibold'
                            : d.headerIsFallbackMaterial
                            ? 'text-[#1d4ed8] font-semibold'
                            : 'text-[#121212]'
                        }`}
                        title={
                          d.headerIsFallbackMaterial
                            ? `Fallback Material: ${
                                PIPE_SPEC_TABLES[d.headerSpecId]?.fullName ?? d.headerSpecId
                              } Ø${d.headerNominalMm} mm (Primary ${
                                result.pipeSpec.fullName
                              } insufficient)`
                            : d.exceedsCapacity
                            ? `Sizing shortfall: requires di ≥ ${
                                d.maxRequiredInnerDiaMm?.toFixed(1) ?? '?'
                              } mm; displaying largest primary size ${getPipeSpecBadgeLabel(
                                d.headerSpecId
                              )} (${d.headerNominalMm ?? '—'} mm)`
                            : undefined
                        }
                      >
                        <div>
                          {d.headerNominalMm ? (
                            <>
                              {d.headerIsFallbackMaterial && (
                                <span className="text-[9px] mr-0.5">
                                  {getPipeSpecBadgeLabel(d.headerSpecId)}
                                </span>
                              )}
                              Ø{d.headerNominalMm}
                              {d.exceedsCapacity ? ' !' : ''}
                            </>
                          ) : (
                            '—'
                          )}
                        </div>
                        {d.headerInnerMm !== null && (
                          <div
                            className={`text-[10px] font-normal ${
                              d.exceedsCapacity
                                ? 'text-[#d90000]/80'
                                : d.headerIsFallbackMaterial
                                ? 'text-[#1d4ed8]/80'
                                : 'text-[#666666]'
                            }`}
                          >
                            di{' '}
                            {formatPipeDim(
                              d.headerInnerMm,
                              PIPE_SPEC_TABLES[d.headerSpecId] ?? result.pipeSpec
                            )}
                          </div>
                        )}
                      </td>
                      <td
                        className={`py-1 px-2 align-top leading-tight text-right text-[11px] font-semibold whitespace-nowrap ${
                          velExceeded ? 'text-[#d90000]' : 'text-[#121212]'
                        }`}
                      >
                        {d.peakVelocityMs !== null ? d.peakVelocityMs.toFixed(2) : '—'}
                      </td>
                    </tr>

                    {attachedSubs.map((sd) => {
                      const sdVelExceeded =
                        sd.peakVelocityMs !== null &&
                        sd.peakVelocityMs > parameters.maxVelocityMs + 1e-4;
                      const isSdSelected =
                        selectedRiser?.kind === 'sub' &&
                        selectedRiser.subDropperId === sd.id;
                      const odLabel =
                        sd.baseNominalMm && sd.terminalNominalMm && sd.baseNominalMm !== sd.terminalNominalMm
                          ? `Ø${sd.baseNominalMm}→${sd.terminalNominalMm}`
                          : sd.baseNominalMm
                          ? `Ø${sd.baseNominalMm}`
                          : '—';
                      const subKey = `sub-${sd.id}`;
                      const subTarget: RiserTarget = { kind: 'sub', subDropperId: sd.id };
                      const effectiveSubBoostBar =
                        sd.boosterPressureBar ?? parameters.boosterPumpBoostBar;

                      return (
                        <tr
                          key={subKey}
                          onClick={() => onSelectRiser(subTarget)}
                          className={`cursor-pointer transition-colors ${
                            isSdSelected
                              ? 'bg-[#e0f2fe]'
                              : 'bg-[#fafafa] hover:bg-[#f0f9ff]'
                          }`}
                        >
                          <td className="py-1 pl-3.5 pr-2 align-top leading-tight">
                            <div className="text-[11px] font-semibold text-[#0891b2] whitespace-nowrap flex items-center gap-1">
                              <span>↳ {sd.label}</span>
                              {onToggleBoosterPump ? (
                                <span className="inline-flex items-center">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (editingBoost?.key === subKey) setEditingBoost(null);
                                      onToggleBoosterPump(subTarget);
                                    }}
                                    aria-pressed={sd.hasBoosterPump}
                                    aria-label={
                                      sd.hasBoosterPump
                                        ? `Remove booster pump from ${sd.label}`
                                        : `Add booster pump to ${sd.label}`
                                    }
                                    title={
                                      sd.hasBoosterPump
                                        ? `Inline booster pump active (+${effectiveSubBoostBar.toFixed(
                                            2
                                          )} bar${
                                            sd.isCustomBoosterPressure ? ' · Custom' : ' · Global'
                                          }) on ${sd.label} @ ${sd.branchFloorLabel} — Click to remove`
                                        : `${
                                            sd.zoneType === 'Booster'
                                              ? `Fed by boosted D${sd.parentDropperIndex}`
                                              : `Gravity branch off D${sd.parentDropperIndex}`
                                          } @ ${sd.branchFloorLabel} — Click to add inline booster pump (+${parameters.boosterPumpBoostBar.toFixed(
                                            2
                                          )} bar)`
                                    }
                                    data-testid={`toggle-booster-${sd.label}`}
                                    className={`inline-flex items-center gap-0.5 px-1 py-0 text-[10px] font-mono font-medium border transition-colors leading-tight ${
                                      sd.hasBoosterPump
                                        ? sd.isCustomBoosterPressure
                                          ? 'bg-[#eef2ff] text-[#1d4ed8] border-[#1d4ed8]/50 hover:bg-[#fee2e2] hover:text-[#d90000] hover:border-[#d90000]/50'
                                          : 'bg-[#e0f2fe] text-[#0369a1] border-[#0369a1]/40 hover:bg-[#fee2e2] hover:text-[#d90000] hover:border-[#d90000]/50'
                                        : 'bg-[#f4f4f4] text-[#555555] border-[#d4d4d4] hover:bg-[#e0f2fe] hover:text-[#0369a1] hover:border-[#0369a1]'
                                    }`}
                                  >
                                    <PumpBadgeGlyph
                                      active={sd.hasBoosterPump}
                                      custom={sd.isCustomBoosterPressure}
                                    />
                                    <span>
                                      (
                                      {sd.hasBoosterPump
                                        ? 'Boost'
                                        : sd.zoneType === 'Booster'
                                        ? '←Boost'
                                        : 'Grav'}
                                      )
                                    </span>
                                  </button>
                                  {sd.hasBoosterPump && onSetBoosterPressure && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startEditingBoost(
                                          subKey,
                                          subTarget,
                                          sd.label,
                                          effectiveSubBoostBar,
                                          sd.isCustomBoosterPressure
                                        );
                                      }}
                                      title={
                                        sd.isCustomBoosterPressure
                                          ? `Custom inline booster (+${effectiveSubBoostBar.toFixed(
                                              2
                                            )} bar; global ${parameters.boosterPumpBoostBar.toFixed(
                                              2
                                            )} bar) — Click to edit or reset`
                                          : `Global default inline booster (+${effectiveSubBoostBar.toFixed(
                                              2
                                            )} bar) — Click to override for ${sd.label}`
                                      }
                                      data-testid={`edit-booster-pressure-${sd.label}`}
                                      className={`-ml-px px-1 py-0 text-[10px] font-mono font-semibold border transition-colors leading-tight ${
                                        sd.isCustomBoosterPressure
                                          ? 'bg-[#dbeafe] text-[#1d4ed8] border-[#1d4ed8]/60 hover:bg-[#bfdbfe]'
                                          : 'bg-white text-[#0369a1] border-[#0369a1]/40 hover:bg-[#e0f2fe]'
                                      }`}
                                    >
                                      +{effectiveSubBoostBar.toFixed(1)}b
                                      {sd.isCustomBoosterPressure ? '*' : ''}
                                    </button>
                                  )}
                                </span>
                              ) : (
                                <span className="font-normal text-[#555555]">
                                  ({sd.zoneType === 'Booster' ? 'Boost' : 'Grav'})
                                </span>
                              )}
                            </div>
                            {renderInlineBoostEditor(
                              subKey,
                              subTarget,
                              sd.label,
                              sd.isCustomBoosterPressure
                            )}
                            <div className="text-[10px] text-[#666666] whitespace-nowrap">
                              @{sd.branchFloorLabel} · {sd.peakFlowRateLs.toFixed(2)} L/s
                              {sd.prvCount > 0 && (
                                <span className="text-[#b45309] font-medium">
                                  {' '}
                                  · {sd.prvCount} PRV
                                </span>
                              )}
                              {sd.splitFloorCount > 0 && (
                                <span className="text-[#1d4ed8] font-medium">
                                  {' '}
                                  · ◐{sd.splitFloorCount}
                                </span>
                              )}
                              {sd.cavitationRiskCount > 0 && (
                                <span className="text-[#d90000] font-semibold">
                                  {' '}
                                  · Cav!
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1 px-1 align-top leading-tight text-[11px] text-[#333333] whitespace-nowrap">
                            <div>{sd.servedFloorRange}</div>
                            <div className="text-[10px] text-[#666666]">
                              {sd.minWorkingPressureBar !== null &&
                              sd.maxWorkingPressureBar !== null
                                ? `${sd.minWorkingPressureBar.toFixed(1)}–${sd.maxWorkingPressureBar.toFixed(1)}b`
                                : sd.flowOrientation}
                            </div>
                          </td>
                          <td className="py-1 px-1 align-top leading-tight text-right text-[11px] text-[#121212] whitespace-nowrap">
                            {Math.round(sd.totalZoneLu)}
                          </td>
                          <td
                            className={`py-1 px-1 align-top leading-tight text-right text-[11px] whitespace-nowrap ${
                              sd.exceedsCapacity
                                ? 'text-[#d90000] font-semibold'
                                : sd.baseIsFallbackMaterial
                                ? 'text-[#1d4ed8] font-semibold'
                                : 'text-[#121212]'
                            }`}
                            title={
                              sd.baseIsFallbackMaterial
                                ? `Fallback Material: ${
                                    PIPE_SPEC_TABLES[sd.baseSpecId]?.fullName ?? sd.baseSpecId
                                  } Ø${sd.baseNominalMm} mm`
                                : sd.exceedsCapacity
                                ? `Sizing shortfall: requires di ≥ ${
                                    sd.maxRequiredInnerDiaMm?.toFixed(1) ?? '?'
                                  } mm`
                                : undefined
                            }
                          >
                            <div>
                              {sd.baseIsFallbackMaterial && sd.baseNominalMm && (
                                <span className="text-[9px] mr-0.5">
                                  {getPipeSpecBadgeLabel(sd.baseSpecId)}
                                </span>
                              )}
                              {odLabel}
                              {sd.exceedsCapacity ? ' !' : ''}
                            </div>
                            {sd.baseInnerMm !== null && (
                              <div
                                className={`text-[10px] font-normal ${
                                  sd.exceedsCapacity
                                    ? 'text-[#d90000]/80'
                                    : sd.baseIsFallbackMaterial
                                    ? 'text-[#1d4ed8]/80'
                                    : 'text-[#666666]'
                                }`}
                              >
                                di{' '}
                                {formatPipeDim(
                                  sd.baseInnerMm,
                                  PIPE_SPEC_TABLES[sd.baseSpecId] ?? result.pipeSpec
                                )}
                              </div>
                            )}
                          </td>
                          <td
                            className={`py-1 px-2 align-top leading-tight text-right text-[11px] font-semibold whitespace-nowrap ${
                              sdVelExceeded ? 'text-[#d90000]' : 'text-[#121212]'
                            }`}
                          >
                            {sd.peakVelocityMs !== null ? sd.peakVelocityMs.toFixed(2) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* System Totals Summary */}
      <div className="bg-white px-2.5 py-2 space-y-1 leading-tight">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[10px] uppercase tracking-wider text-[#666666] whitespace-nowrap">
            Total Load
          </span>
          <span className="font-mono tabular-nums text-[11px] font-semibold text-[#121212] text-right whitespace-nowrap">
            {Math.round(totalBuildingLu)} LU · {peakSystemFlowLs.toFixed(2)} L/s
            {result.splitFloorCount > 0 && (
              <span className="text-[#1d4ed8]"> · ◐ {result.splitFloorCount} Split</span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[10px] uppercase tracking-wider text-[#666666] whitespace-nowrap">
            Pipe Header
          </span>
          <span
            data-testid="summary-pipe-header-size"
            className={`font-mono tabular-nums text-[11px] font-semibold text-right whitespace-nowrap ${
              result.pipeHeader.exceedsMaxCapacity
                ? 'text-[#d90000]'
                : result.pipeHeader.isCustomSize || result.pipeHeader.isFallbackMaterial
                ? 'text-[#1d4ed8]'
                : 'text-[#121212]'
            }`}
            title={
              result.pipeHeader.nominalMm
                ? `Roof Pipe Header (${
                    PIPE_SPEC_TABLES[result.pipeHeader.specId]?.fullName ?? result.pipeSpec.fullName
                  }${
                    result.pipeHeader.isCustomSize
                      ? ' · Custom Override'
                      : result.pipeHeader.isFallbackMaterial
                      ? ' · Fallback'
                      : ' · Auto-Sized'
                  }): Ø${result.pipeHeader.nominalMm} mm (di ${formatPipeDim(
                    result.pipeHeader.innerMm,
                    PIPE_SPEC_TABLES[result.pipeHeader.specId] ?? result.pipeSpec
                  )} mm${
                    result.pipeHeader.requiredInnerDiaMm !== null
                      ? `, req di ≥ ${result.pipeHeader.requiredInnerDiaMm.toFixed(1)} mm`
                      : ''
                  }) · ${Math.round(result.pipeHeader.totalLu)} LU · ${result.pipeHeader.flowRateLs.toFixed(
                    2
                  )} L/s · ${result.pipeHeader.velocityMs?.toFixed(2) ?? '—'} m/s (Header limit ≤ ${result.pipeHeader.maxVelocityMs.toFixed(
                    1
                  )} m/s = Global ${parameters.maxVelocityMs.toFixed(1)} − 0.5 m/s)`
                : 'No connected droppers'
            }
          >
            {result.pipeHeader.nominalMm ? (
              <>
                {result.pipeHeader.isFallbackMaterial && (
                  <span>{getPipeSpecBadgeLabel(result.pipeHeader.specId)} </span>
                )}
                Ø{result.pipeHeader.nominalMm}
                {result.pipeHeader.isCustomSize ? '*' : ''}
                {result.pipeHeader.exceedsMaxCapacity ? ' !' : ''}
                {result.pipeHeader.innerMm !== null && (
                  <span
                    className={`font-normal ${
                      result.pipeHeader.exceedsMaxCapacity
                        ? 'text-[#d90000]/80'
                        : result.pipeHeader.isCustomSize || result.pipeHeader.isFallbackMaterial
                        ? 'text-[#1d4ed8]/80'
                        : 'text-[#666666]'
                    }`}
                  >
                    {' '}
                    · di{' '}
                    {formatPipeDim(
                      result.pipeHeader.innerMm,
                      PIPE_SPEC_TABLES[result.pipeHeader.specId] ?? result.pipeSpec
                    )}
                  </span>
                )}
                {result.pipeHeader.velocityMs !== null && (
                  <span>
                    {' '}
                    · {result.pipeHeader.velocityMs.toFixed(2)}/
                    {result.pipeHeader.maxVelocityMs.toFixed(1)} m/s
                  </span>
                )}
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[10px] uppercase tracking-wider text-[#666666] whitespace-nowrap">
            Static Head
          </span>
          <span className="font-mono tabular-nums text-[11px] font-semibold text-[#121212] text-right whitespace-nowrap">
            {totalBuildingHeightM.toFixed(2)} m · {maxStaticHeadBar.toFixed(2)} bar
          </span>
        </div>
        {(boosterDropperPipes > 0 || result.boosterSubDropperPipes > 0) && (
          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-[10px] uppercase tracking-wider text-[#666666] whitespace-nowrap">
              Booster Pumps
            </span>
            <span className="font-mono tabular-nums text-[11px] font-semibold text-[#0369a1] text-right whitespace-nowrap">
              {boosterDropperPipes + result.boosterSubDropperPipes} Active
              {customBoosterCount > 0 ? (
                <span className="text-[#1d4ed8]"> · {customBoosterCount} Custom*</span>
              ) : (
                <span className="text-[#666666] font-normal">
                  {' '}
                  · Global +{parameters.boosterPumpBoostBar.toFixed(1)}b
                </span>
              )}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[10px] uppercase tracking-wider text-[#666666] whitespace-nowrap">
            PRV Stations
          </span>
          <span className="font-mono tabular-nums text-[11px] font-semibold text-[#121212] text-right whitespace-nowrap">
            {prvList.length} Active
            {customPrvCount > 0 && (
              <span className="text-[#1d4ed8]"> · {customPrvCount} Custom</span>
            )}
            {totalCavitationCount > 0 && (
              <span className="text-[#d90000]"> · {totalCavitationCount} Alert</span>
            )}
          </span>
        </div>
      </div>
    </section>
  );
};



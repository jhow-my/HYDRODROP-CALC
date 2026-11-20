import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RotateCcw, X } from 'lucide-react';
import {
  APPLIANCE_LOADING_UNITS,
  calculateTotalLuFromAppliances,
  getApplianceLu,
  getStandardLabel,
  normalizeApplianceCounts,
} from '../data/appliances';
import {
  ApplianceCounts,
  ApplianceId,
  DesignStandard,
  FlowConversionFormula,
} from '../types/hydraulics';
import {
  calculateFlowRateFromLu,
  formatFlowFormulaDisplay,
  formatLuDisplay,
  getEffectiveStandard,
} from '../utils/calculations';

export interface ApplianceCalculatorFloorOption {
  id: string;
  floorLabel: string;
}

interface ApplianceCalculatorModalProps {
  isOpen: boolean;
  targetLabel: string;
  standard?: DesignStandard;
  flowFormula?: FlowConversionFormula;
  initialCounts?: ApplianceCounts;
  currentLu: number;
  availableFloors?: ApplianceCalculatorFloorOption[];
  currentFloorId?: string;
  onApply: (totalLu: number, counts: ApplianceCounts | undefined) => void;
  onApplyRange?: (
    totalLu: number,
    counts: ApplianceCounts | undefined,
    fromFloorId: string,
    toFloorId: string
  ) => void;
  onClose: () => void;
}

export const ApplianceCalculatorModal: React.FC<ApplianceCalculatorModalProps> = ({
  isOpen,
  targetLabel,
  standard,
  flowFormula,
  initialCounts,
  currentLu,
  availableFloors = [],
  currentFloorId,
  onApply,
  onApplyRange,
  onClose,
}) => {
  const effectiveStandard = getEffectiveStandard(standard);
  const [counts, setCounts] = useState<ApplianceCounts>(() => ({ ...(initialCounts ?? {}) }));
  const [isRangeOpen, setIsRangeOpen] = useState<boolean>(false);
  const [rangeFromId, setRangeFromId] = useState<string>('');
  const [rangeToId, setRangeToId] = useState<string>('');
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCounts({ ...(initialCounts ?? {}) });
      setIsRangeOpen(false);
      if (availableFloors.length > 0) {
        const defaultFrom =
          currentFloorId && availableFloors.some((f) => f.id === currentFloorId)
            ? currentFloorId
            : availableFloors[0].id;
        const defaultTo =
          currentFloorId && availableFloors.some((f) => f.id === currentFloorId)
            ? currentFloorId
            : availableFloors[availableFloors.length - 1].id;
        setRangeFromId(defaultFrom);
        setRangeToId(defaultTo);
      } else {
        setRangeFromId('');
        setRangeToId('');
      }
    }
  }, [isOpen, initialCounts, currentFloorId, availableFloors]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isRangeOpen) {
          setIsRangeOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRangeOpen, onClose]);

  useEffect(() => {
    if (!isRangeOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (rangeMenuRef.current && !rangeMenuRef.current.contains(e.target as Node)) {
        setIsRangeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isRangeOpen]);

  const totalLu = useMemo(
    () => calculateTotalLuFromAppliances(counts, effectiveStandard),
    [counts, effectiveStandard]
  );

  const totalFixtures = useMemo(
    () =>
      APPLIANCE_LOADING_UNITS.reduce(
        (sum, app) => sum + Math.max(0, Number(counts[app.id] ?? 0) || 0),
        0
      ),
    [counts]
  );

  const previewFlowLs = useMemo(
    () => calculateFlowRateFromLu(totalLu, flowFormula, effectiveStandard),
    [totalLu, flowFormula, effectiveStandard]
  );

  const resolvedRangeSummary = useMemo(() => {
    if (availableFloors.length === 0) return null;
    const idxA = availableFloors.findIndex((f) => f.id === rangeFromId);
    const idxB = availableFloors.findIndex((f) => f.id === rangeToId);
    if (idxA < 0 || idxB < 0) return null;
    const minI = Math.min(idxA, idxB);
    const maxI = Math.max(idxA, idxB);
    return {
      count: maxI - minI + 1,
      topLabel: availableFloors[minI].floorLabel,
      bottomLabel: availableFloors[maxI].floorLabel,
    };
  }, [availableFloors, rangeFromId, rangeToId]);

  if (!isOpen) return null;

  const setApplianceQty = (id: ApplianceId, rawQty: number) => {
    const safeQty = Number.isFinite(rawQty) && rawQty > 0 ? Math.round(rawQty * 100) / 100 : 0;
    setCounts((prev) => {
      const next = { ...prev };
      if (safeQty <= 0) {
        delete next[id];
      } else {
        next[id] = safeQty;
      }
      return next;
    });
  };

  const handleClear = () => {
    setCounts({});
  };

  const handleApply = () => {
    const normalized = normalizeApplianceCounts(counts);
    const finalLu = normalized ? calculateTotalLuFromAppliances(normalized, effectiveStandard) : 0;
    onApply(finalLu, normalized);
    onClose();
  };

  const handleApplyRange = () => {
    if (!onApplyRange || !rangeFromId || !rangeToId) return;
    const normalized = normalizeApplianceCounts(counts);
    const finalLu = normalized ? calculateTotalLuFromAppliances(normalized, effectiveStandard) : 0;
    onApplyRange(finalLu, normalized, rangeFromId, rangeToId);
    setIsRangeOpen(false);
    onClose();
  };

  const canApplyRange = Boolean(onApplyRange && availableFloors.length > 0);
  const standardLabel = getStandardLabel(effectiveStandard);
  const hasSavedInitialCounts = Boolean(initialCounts && Object.keys(initialCounts).length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#121212]/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appliance-calc-modal-title"
      data-testid="appliance-calculator-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[740px] max-h-[90vh] flex flex-col bg-white border-2 border-[#121212]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-[#eeeeee] border-b border-[#e0e0e0] flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="appliance-calc-modal-title"
                className="font-display text-xs font-bold uppercase tracking-wider text-[#121212]"
              >
                Appliance LU Calculator — {targetLabel}
              </h2>
              <span className="px-1.5 py-0.5 bg-[#121212] text-white font-display text-[9px] font-bold uppercase tracking-wider">
                {standardLabel}
              </span>
            </div>
            <p className="text-xs text-[#555555] mt-0.5">
              Enter appliance quantities to compute Total LU = Σ(Quantity × Unit LU) ·{' '}
              <span className="font-mono tabular-nums">
                {formatFlowFormulaDisplay(flowFormula, effectiveStandard)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close appliance LU calculator"
            className="h-8 w-8 inline-flex items-center justify-center bg-white border border-[#e0e0e0] text-[#555555] hover:text-[#121212] hover:border-[#121212] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Manual entry notice if no saved appliance quantities yet */}
        {!hasSavedInitialCounts && currentLu > 0 && (
          <div className="px-4 py-1.5 bg-[#f8f8f8] border-b border-[#e0e0e0] text-[11px] font-mono text-[#555555] shrink-0">
            Current value: <strong className="text-[#121212]">{formatLuDisplay(currentLu)} LU</strong>{' '}
            (direct manual entry). Enter quantities below and click Apply to update.
          </div>
        )}

        {/* Appliance Quantity Table */}
        <div className="flex-1 overflow-y-auto p-4 bg-[#f8f8f8]">
          <div className="bg-white border border-[#e0e0e0] overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#eeeeee] text-[#121212] border-b-2 border-[#121212] font-display text-[10px] uppercase">
                  <th className="py-2 px-3 text-left font-bold border-r border-[#e0e0e0]">
                    Type of Appliance
                  </th>
                  <th className="py-2 px-3 text-right font-bold border-r border-[#e0e0e0] w-28">
                    {standardLabel} LU
                  </th>
                  <th className="py-2 px-3 text-center font-bold border-r border-[#e0e0e0] w-36">
                    Quantity
                  </th>
                  <th className="py-2 px-3 text-right font-bold w-28">
                    Subtotal (LU)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e0e0e0] font-mono tabular-nums">
                {APPLIANCE_LOADING_UNITS.map((app) => {
                  const unitLu = getApplianceLu(app, effectiveStandard);
                  const qty = counts[app.id] ?? 0;
                  const subtotal = Math.round(qty * unitLu * 100) / 100;
                  const isActiveRow = qty > 0;

                  return (
                    <tr
                      key={app.id}
                      className={isActiveRow ? 'bg-[#eff6ff]/60' : 'hover:bg-[#f8f8f8]'}
                    >
                      <td className="py-1.5 px-3 text-left font-sans font-medium text-[#121212] border-r border-[#e0e0e0]">
                        {app.name}
                      </td>
                      <td className="py-1.5 px-3 text-right text-[#555555] border-r border-[#e0e0e0]">
                        {unitLu}
                      </td>
                      <td className="py-1.5 px-2 text-center border-r border-[#e0e0e0]">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={qty === 0 ? '' : qty}
                          placeholder="0"
                          aria-label={`${app.name} quantity`}
                          data-testid={`appliance-qty-${app.id}`}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw.trim() === '') {
                              setApplianceQty(app.id, 0);
                              return;
                            }
                            const parsed = parseFloat(raw);
                            if (!Number.isNaN(parsed)) {
                              setApplianceQty(app.id, parsed);
                            }
                          }}
                          className="w-20 h-6 px-1.5 text-center text-xs font-mono tabular-nums bg-white border border-[#cccccc] text-[#121212] focus:border-[#121212] focus:outline-none"
                        />
                      </td>
                      <td
                        className={`py-1.5 px-3 text-right font-semibold ${
                          isActiveRow ? 'text-[#1d4ed8]' : 'text-[#888888]'
                        }`}
                      >
                        {subtotal > 0 ? formatLuDisplay(subtotal) : '0'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Totals & Actions */}
        <div className="px-4 py-3 bg-[#eeeeee] border-t border-[#e0e0e0] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
            <div>
              <span className="text-[#555555]">Appliances: </span>
              <strong className="text-[#121212]">{totalFixtures}</strong>
            </div>
            <div>
              <span className="text-[#555555]">Total LU: </span>
              <strong
                data-testid="appliance-calc-total-lu"
                className="text-sm text-[#121212]"
              >
                {formatLuDisplay(totalLu)} LU
              </strong>
            </div>
            <div>
              <span className="text-[#555555]">Est. Flow Q: </span>
              <strong className="text-[#121212]">{previewFlowLs.toFixed(2)} L/s</strong>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClear}
              disabled={totalFixtures === 0}
              className="h-8 px-2.5 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] disabled:opacity-40 disabled:pointer-events-none font-display text-[10px] font-bold uppercase inline-flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] font-display text-[10px] font-bold uppercase transition-colors"
            >
              Cancel
            </button>

            <div className="relative inline-flex items-center" ref={rangeMenuRef}>
              <button
                type="button"
                data-testid="appliance-calc-apply-btn"
                onClick={handleApply}
                className="h-8 px-3.5 bg-[#121212] hover:bg-[#2a2a2a] text-white font-display text-[10px] font-bold uppercase transition-colors whitespace-nowrap"
              >
                Apply {formatLuDisplay(totalLu)} LU
              </button>

              {canApplyRange && (
                <button
                  type="button"
                  data-testid="appliance-calc-range-dropdown-btn"
                  onClick={() => setIsRangeOpen((prev) => !prev)}
                  aria-expanded={isRangeOpen}
                  aria-haspopup="dialog"
                  aria-label="Apply calculated LU to a floor range"
                  title="Apply calculated LU across a level range"
                  className={`h-8 px-2 border-l border-white/25 inline-flex items-center gap-1 font-display text-[10px] font-bold uppercase transition-colors whitespace-nowrap ${
                    isRangeOpen
                      ? 'bg-[#2a2a2a] text-white'
                      : 'bg-[#121212] hover:bg-[#2a2a2a] text-white'
                  }`}
                >
                  <span>Range</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      isRangeOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              )}

              {canApplyRange && isRangeOpen && (
                <div
                  role="region"
                  aria-label="Apply LU to level range"
                  data-testid="appliance-calc-range-popover"
                  className="absolute bottom-full right-0 mb-1.5 z-30 w-max min-w-[280px] max-w-[calc(100vw-2rem)] bg-white border-2 border-[#121212] shadow-lg p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-3 pb-1.5 border-b border-[#e0e0e0]">
                    <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212]">
                      Apply {formatLuDisplay(totalLu)} LU Across Range
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsRangeOpen(false)}
                      aria-label="Close level range selector"
                      className="h-5 w-5 inline-flex items-center justify-center text-[#666666] hover:text-[#121212]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-display text-[10px] font-bold uppercase text-[#555555]">
                      Range
                    </span>
                    <select
                      value={rangeFromId}
                      onChange={(e) => setRangeFromId(e.target.value)}
                      aria-label="Range start level"
                      data-testid="appliance-calc-range-from"
                      className="h-7 px-2 text-xs font-mono font-semibold bg-white border border-[#121212] text-[#121212] focus:outline-none"
                    >
                      {availableFloors.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.floorLabel}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs font-mono text-[#555555]">to</span>
                    <select
                      value={rangeToId}
                      onChange={(e) => setRangeToId(e.target.value)}
                      aria-label="Range end level"
                      data-testid="appliance-calc-range-to"
                      className="h-7 px-2 text-xs font-mono font-semibold bg-white border border-[#121212] text-[#121212] focus:outline-none"
                    >
                      {availableFloors.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.floorLabel}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="font-mono text-[11px] text-[#555555] tabular-nums">
                      {resolvedRangeSummary
                        ? resolvedRangeSummary.count === 1
                          ? `1 level (${resolvedRangeSummary.topLabel})`
                          : `${resolvedRangeSummary.count} levels (${resolvedRangeSummary.topLabel} – ${resolvedRangeSummary.bottomLabel})`
                        : 'Select levels'}
                    </span>
                    <button
                      type="button"
                      data-testid="appliance-calc-apply-range-btn"
                      onClick={handleApplyRange}
                      disabled={!resolvedRangeSummary}
                      className="h-7 px-3 bg-[#121212] hover:bg-[#2a2a2a] disabled:opacity-40 text-white font-display text-[10px] font-bold uppercase transition-colors whitespace-nowrap"
                    >
                      Apply to {resolvedRangeSummary?.count ?? 0}{' '}
                      {resolvedRangeSummary?.count === 1 ? 'Level' : 'Levels'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


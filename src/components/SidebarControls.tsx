import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Table2,
} from 'lucide-react';
import { PIPE_SPEC_TABLES } from '../data/pipeSpecs';
import {
  DesignParameters,
  DesignStandard,
  PipeSpecId,
  SystemCalculationResult,
  ZoningStrategy,
} from '../types/hydraulics';
import {
  formatCavitationRatio,
  getEffectiveCavitationRatioLimit,
  getEffectiveStandard,
} from '../utils/calculations';

interface SidebarControlsProps {
  parameters: DesignParameters;
  calcResult: SystemCalculationResult;
  activePresetId?: string;
  onUpdateParameters: (patch: Partial<DesignParameters>) => void;
  onChangeStandard: (standard: DesignStandard) => void;
  onOpenPresets: () => void;
  onOpenApplianceUnits: () => void;
  onOpenSpecs: () => void;
  dropperScheduleSlot?: React.ReactNode;
}

const VELOCITY_PRESETS = [1.0, 1.5, 2.0, 2.5];

interface PressureBarInputProps {
  id: string;
  value: number;
  min: number;
  max: number;
  allowZero?: boolean;
  onCommit: (value: number) => void;
  className: string;
}

const PressureBarInput: React.FC<PressureBarInputProps> = ({
  id,
  value,
  min,
  max,
  allowZero = false,
  onCommit,
  className,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(() => value.toFixed(2));

  useEffect(() => {
    if (!isFocused) {
      setDraft(value.toFixed(2));
    }
  }, [value, isFocused]);

  return (
    <input
      id={id}
      type="number"
      step="0.05"
      min={min.toFixed(2)}
      max={max.toFixed(2)}
      value={draft}
      onFocus={() => {
        setIsFocused(true);
        setDraft(value.toFixed(2));
      }}
      onBlur={() => {
        setIsFocused(false);
        const parsed = parseFloat(draft);
        if (Number.isNaN(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
          setDraft(value.toFixed(2));
          return;
        }
        const rounded = Math.round(parsed * 100) / 100;
        onCommit(rounded);
        setDraft(rounded.toFixed(2));
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
        if (!Number.isNaN(parsed) && (allowZero ? parsed >= 0 : parsed > 0)) {
          const rounded = Math.round(parsed * 100) / 100;
          onCommit(rounded);
          setDraft(isTyping ? raw : rounded.toFixed(2));
        } else {
          setDraft(raw);
        }
      }}
      className={className}
    />
  );
};

export const SidebarControls: React.FC<SidebarControlsProps> = ({
  parameters,
  calcResult,
  activePresetId,
  onUpdateParameters,
  onChangeStandard,
  onOpenPresets,
  onOpenApplianceUnits,
  onOpenSpecs,
  dropperScheduleSlot,
}) => {
  const {
    pipeSpec,
    optionalPipeSpec,
    totalPhysicalDropperPipes,
    warnings,
  } = calcResult;
  const [isAlertsExpanded, setIsAlertsExpanded] = useState(false);
  const effectiveStandard = getEffectiveStandard(parameters.standard);

  const renderPipeSpecOptions = () => (
    <>
      <optgroup label="PP-R Pipe">
        <option value={PipeSpecId.PPR_PN16}>
          {PIPE_SPEC_TABLES[PipeSpecId.PPR_PN16].fullName}
        </option>
        <option value={PipeSpecId.PPR_PN20}>
          {PIPE_SPEC_TABLES[PipeSpecId.PPR_PN20].fullName}
        </option>
      </optgroup>
      <optgroup label="uPVC Pipe">
        <option value={PipeSpecId.UPVC_CLASS_E}>
          {PIPE_SPEC_TABLES[PipeSpecId.UPVC_CLASS_E].fullName}
        </option>
        <option value={PipeSpecId.UPVC_CLASS_7}>
          {PIPE_SPEC_TABLES[PipeSpecId.UPVC_CLASS_7].fullName}
        </option>
      </optgroup>
      <optgroup label="HDPE PE100 Pipe">
        <option value={PipeSpecId.HDPE_PN12_5}>
          {PIPE_SPEC_TABLES[PipeSpecId.HDPE_PN12_5].fullName}
        </option>
        <option value={PipeSpecId.HDPE_PN16}>
          {PIPE_SPEC_TABLES[PipeSpecId.HDPE_PN16].fullName}
        </option>
      </optgroup>
      <optgroup label="MSCL Pipe">
        <option value={PipeSpecId.MSCL}>
          {PIPE_SPEC_TABLES[PipeSpecId.MSCL].fullName}
        </option>
      </optgroup>
      <optgroup label="Stainless Steel (ASME B36.19)">
        <option value={PipeSpecId.SS_10S}>
          {PIPE_SPEC_TABLES[PipeSpecId.SS_10S].shortName ??
            PIPE_SPEC_TABLES[PipeSpecId.SS_10S].fullName}
        </option>
        <option value={PipeSpecId.SS_40S}>
          {PIPE_SPEC_TABLES[PipeSpecId.SS_40S].shortName ??
            PIPE_SPEC_TABLES[PipeSpecId.SS_40S].fullName}
        </option>
      </optgroup>
    </>
  );

  const velocityOptions = VELOCITY_PRESETS.some(
    (v) => Math.abs(v - parameters.maxVelocityMs) < 0.01
  )
    ? VELOCITY_PRESETS
    : [...VELOCITY_PRESETS, parameters.maxVelocityMs].sort((a, b) => a - b);

  return (
    <aside className="w-full min-h-0 flex flex-col bg-[#f8f8f8] border-b lg:border-b-0 lg:border-r border-[#e0e0e0] overflow-hidden">
      {/* Pane 01 Header */}
      <div className="px-2.5 py-1.5 bg-[#eeeeee] border-b border-[#e0e0e0] flex flex-wrap items-center justify-between gap-1.5 shrink-0">
        <h2 className="font-display text-[10px] font-bold uppercase tracking-[0.08em] text-[#121212] whitespace-nowrap">
          Configuration
        </h2>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenPresets}
            title={
              activePresetId === 'custom'
                ? 'Building Templates (Active: Custom)'
                : 'Building Templates & Project Import/Export'
            }
            data-testid="open-presets-btn"
            className="px-1.5 py-0.5 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] font-display text-[10px] font-bold uppercase inline-flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Building2 className="w-3 h-3" />
            <span>Templates</span>
            {activePresetId === 'custom' && (
              <span
                data-testid="sidebar-custom-indicator"
                className="px-1 bg-[#121212] text-white text-[8px] font-mono leading-tight"
              >
                Custom
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onOpenApplianceUnits}
            title="Appliance Loading Units Reference (BS 6700 & BS EN 806-3)"
            data-testid="open-appliance-units-btn"
            className="px-1.5 py-0.5 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] font-display text-[10px] font-bold uppercase inline-flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Calculator className="w-3 h-3" />
            <span>L.U.</span>
          </button>
          <button
            type="button"
            onClick={onOpenSpecs}
            title="Pipe Spec Tables"
            className="px-1.5 py-0.5 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] font-display text-[10px] font-bold uppercase inline-flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Table2 className="w-3 h-3" />
            <span>SPEC</span>
          </button>
        </div>
      </div>

      {/* Scrollable Configuration Controls & Dropper Schedule */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-2.5 py-1.5 space-y-0">
          {/* Project & Job No. */}
          <div>
            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="project-name-input"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                Project
              </label>
              <input
                id="project-name-input"
                data-testid="project-name-input"
                type="text"
                value={parameters.projectName}
                placeholder="Untitled Project"
                title={parameters.projectName}
                onChange={(e) => onUpdateParameters({ projectName: e.target.value })}
                onBlur={(e) => {
                  if (!e.target.value.trim()) {
                    onUpdateParameters({ projectName: 'Untitled Project' });
                  }
                }}
                className="w-full min-w-0 h-6 px-1.5 text-[11px] font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="project-job-no-input"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                Job No.
              </label>
              <input
                id="project-job-no-input"
                data-testid="project-job-no-input"
                type="text"
                value={parameters.projectRef}
                placeholder="KAC-001"
                title={parameters.projectRef}
                onChange={(e) => onUpdateParameters({ projectRef: e.target.value })}
                onBlur={(e) => {
                  if (!e.target.value.trim()) {
                    onUpdateParameters({ projectRef: 'KAC-001' });
                  }
                }}
                className="w-full min-w-0 h-6 px-1.5 text-[11px] font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 items-center gap-x-2">
              <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate">
                Standard
              </span>
              <div
                role="group"
                aria-label="Design Standard"
                className="w-full min-w-0 flex items-center gap-1"
              >
                <button
                  type="button"
                  data-testid="standard-bs6700-btn"
                  onClick={() => onChangeStandard(DesignStandard.BS_6700)}
                  aria-pressed={effectiveStandard === DesignStandard.BS_6700}
                  title="BS 6700 — Q = 0.0485 × LU^0.7162 L/s"
                  className={`flex-1 h-6 px-1.5 font-display text-[10px] font-bold uppercase border transition-colors whitespace-nowrap ${
                    effectiveStandard === DesignStandard.BS_6700
                      ? 'bg-[#121212] text-white border-[#121212]'
                      : 'bg-white text-[#555555] border-[#e0e0e0] hover:border-[#121212] hover:text-[#121212]'
                  }`}
                >
                  BS 6700
                </button>
                <button
                  type="button"
                  data-testid="standard-bsen806-btn"
                  onClick={() => onChangeStandard(DesignStandard.BS_EN_806_3)}
                  aria-pressed={effectiveStandard === DesignStandard.BS_EN_806_3}
                  title="BS EN 806-3 — Q = 0.05794 × LU^0.5924 L/s"
                  className={`flex-1 h-6 px-1.5 font-display text-[10px] font-bold uppercase border transition-colors whitespace-nowrap ${
                    effectiveStandard === DesignStandard.BS_EN_806_3
                      ? 'bg-[#121212] text-white border-[#121212]'
                      : 'bg-white text-[#555555] border-[#e0e0e0] hover:border-[#121212] hover:text-[#121212]'
                  }`}
                >
                  BS EN 806-3
                </button>
              </div>
            </div>
          </div>

          {/* Pipe Material & Class (Primary & Optional Fallback) */}
          <div>
            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="pipe-spec-primary-select"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                Material (Primary)
              </label>
              <select
                id="pipe-spec-primary-select"
                data-testid="primary-pipe-spec-select"
                value={parameters.pipeSpecId}
                title={pipeSpec.fullName}
                onChange={(e) => onUpdateParameters({ pipeSpecId: e.target.value as PipeSpecId })}
                className="w-full min-w-0 h-6 px-1.5 text-[11px] font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              >
                {renderPipeSpecOptions()}
              </select>
            </div>

            <div>
              <div className="grid grid-cols-2 items-center gap-x-2">
                <label
                  htmlFor="pipe-spec-optional-select"
                  className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
                >
                  Material (Optional)
                </label>
                <select
                  id="pipe-spec-optional-select"
                  data-testid="optional-pipe-spec-select"
                  value={parameters.optionalPipeSpecId ?? ''}
                  title={
                    optionalPipeSpec
                      ? `Fallback material when Primary is insufficient: ${optionalPipeSpec.fullName}`
                      : 'Optional secondary fallback material (none selected)'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    onUpdateParameters({
                      optionalPipeSpecId: val === '' ? null : (val as PipeSpecId),
                    });
                  }}
                  className={`w-full min-w-0 h-6 px-1.5 text-[11px] font-mono bg-white border focus:border-[#121212] focus:outline-none ${
                    optionalPipeSpec
                      ? 'border-[#1d4ed8]/50 text-[#121212]'
                      : 'border-[#e0e0e0] text-[#555555]'
                  }`}
                >
                  <option value="">None (Primary Only)</option>
                  {renderPipeSpecOptions()}
                </select>
              </div>
            </div>
          </div>

          {/* Velocity & Pressure Limits (Two-Column Half-Split Inline Rows) */}
          <div>
            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="velocity-limit-select"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                Max Velocity (m/s)
              </label>
              <select
                id="velocity-limit-select"
                value={parameters.maxVelocityMs.toFixed(1)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isNaN(v) && v > 0) {
                    onUpdateParameters({ maxVelocityMs: v });
                  }
                }}
                className="w-full min-w-0 h-6 px-1.5 text-[11px] font-mono tabular-nums bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              >
                {velocityOptions.map((vel) => (
                  <option key={vel} value={vel.toFixed(1)}>
                    ≤ {vel.toFixed(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="pmax-input"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                Max Pressure (bar)
              </label>
              <PressureBarInput
                id="pmax-input"
                min={1.5}
                max={10.0}
                value={parameters.maxStaticPressureBar}
                onCommit={(v) => onUpdateParameters({ maxStaticPressureBar: v })}
                className="w-full min-w-0 h-6 px-1.5 text-[11px] font-mono tabular-nums bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="pset-input"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                PRV Set (bar)
              </label>
              <PressureBarInput
                id="pset-input"
                min={0.5}
                max={6.0}
                value={parameters.prvSetPressureBar}
                onCommit={(v) => onUpdateParameters({ prvSetPressureBar: v })}
                className="w-full min-w-0 h-6 px-1.5 text-[11px] font-mono tabular-nums bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="pump-boost-input"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                Booster (bar)
              </label>
              <PressureBarInput
                id="pump-boost-input"
                min={0}
                max={8.0}
                allowZero
                value={parameters.boosterPumpBoostBar}
                onCommit={(v) => onUpdateParameters({ boosterPumpBoostBar: v })}
                className="w-full min-w-0 h-6 px-1.5 text-[11px] font-mono tabular-nums bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              />
            </div>
          </div>

          {/* Riser Zoning Strategy (Two-Column Half-Split Inline Rows) */}
          <div>
            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="zoning-strategy-select"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                Zoning Strategy
              </label>
              <select
                id="zoning-strategy-select"
                aria-label="Riser Zoning Strategy"
                value={parameters.zoningStrategy}
                onChange={(e) => {
                  const nextStrategy = e.target.value as ZoningStrategy;
                  if (
                    nextStrategy === ZoningStrategy.SINGLE_GRAVITY ||
                    nextStrategy === ZoningStrategy.MANUAL_ZONES
                  ) {
                    onUpdateParameters({ zoningStrategy: nextStrategy, desiredDropperCount: null });
                  } else {
                    onUpdateParameters({ zoningStrategy: nextStrategy });
                  }
                }}
                className="w-full min-w-0 h-6 px-1.5 text-[11px] font-mono bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
              >
                <option value={ZoningStrategy.AUTO_ZONED_VERTICAL}>
                  Auto-Zone Vertical
                </option>
                <option value={ZoningStrategy.AUTO_PARALLEL_SPLIT}>
                  Auto-Zone Parallel
                </option>
                <option value={ZoningStrategy.MANUAL_ZONES}>
                  Manual Assignment
                </option>
                <option value={ZoningStrategy.SINGLE_GRAVITY}>
                  Single Unsplit
                </option>
              </select>
            </div>

            <div className="grid grid-cols-2 items-center gap-x-2">
              <label
                htmlFor="desired-droppers-input"
                className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] whitespace-nowrap truncate"
              >
                Dropper Count
              </label>
              <div className="w-full min-w-0 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onUpdateParameters({ desiredDropperCount: null })}
                  aria-pressed={parameters.desiredDropperCount == null}
                  title="Use automatic dropper count"
                  className={`flex-1 h-6 px-1.5 font-display text-[10px] font-bold uppercase border transition-colors whitespace-nowrap ${
                    parameters.desiredDropperCount == null
                      ? 'bg-[#121212] text-white border-[#121212]'
                      : 'bg-white text-[#555555] border-[#e0e0e0] hover:border-[#121212] hover:text-[#121212]'
                  }`}
                >
                  Auto
                </button>
                <input
                  id="desired-droppers-input"
                  type="number"
                  min={1}
                  max={24}
                  step={1}
                  placeholder={
                    totalPhysicalDropperPipes > 0 ? String(totalPhysicalDropperPipes) : 'Auto'
                  }
                  value={parameters.desiredDropperCount ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === '') {
                      onUpdateParameters({ desiredDropperCount: null });
                      return;
                    }
                    const parsed = parseInt(raw, 10);
                    if (!Number.isNaN(parsed)) {
                      const clamped = Math.max(1, Math.min(24, parsed));
                      const patch: Partial<DesignParameters> = { desiredDropperCount: clamped };
                      if (
                        parameters.zoningStrategy === ZoningStrategy.SINGLE_GRAVITY ||
                        parameters.zoningStrategy === ZoningStrategy.MANUAL_ZONES
                      ) {
                        patch.zoningStrategy = ZoningStrategy.AUTO_ZONED_VERTICAL;
                      }
                      onUpdateParameters(patch);
                    }
                  }}
                  className="flex-1 min-w-0 h-6 px-1.5 text-right text-[11px] font-mono tabular-nums bg-white border border-[#e0e0e0] text-[#121212] focus:border-[#121212] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Relocated 03. Dropper Schedule directly below Configuration & Zoning Controls */}
        {dropperScheduleSlot}
      </div>

      {/* Pinned Bottom Engineering Verification Alert Block */}
      {(warnings.length > 0 || totalPhysicalDropperPipes > 0) && (
        <section
          aria-label="Hydraulic Engineering Verification Alerts"
          className="mt-auto shrink-0 border-t border-[#e0e0e0]"
        >
          {warnings.length > 0 ? (
            <div className="bg-[#d90000] text-white">
              <button
                type="button"
                onClick={() => setIsAlertsExpanded((prev) => !prev)}
                aria-expanded={isAlertsExpanded}
                aria-controls="engineering-alerts-list"
                title={
                  isAlertsExpanded
                    ? 'Collapse engineering alerts'
                    : 'Expand engineering alerts'
                }
                className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left hover:bg-[#be0000] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-[-2px]"
              >
                <span className="flex items-center gap-1.5 font-display text-[10px] font-bold uppercase tracking-wider whitespace-nowrap truncate">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Engineering Alert ({warnings.length})</span>
                </span>
                {isAlertsExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-white/90" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5 shrink-0 text-white/90" />
                )}
              </button>
              <div
                id="engineering-alerts-list"
                aria-hidden={!isAlertsExpanded}
                className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                  isAlertsExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="border-t border-white/25 px-2.5 py-2">
                    <ul className="space-y-1.5 font-mono text-[10px] leading-snug text-white/95 max-h-48 overflow-y-auto pr-0.5">
                      {warnings.map((w, idx) => (
                        <li
                          key={idx}
                          className="border-t border-white/20 pt-1.5 first:border-t-0 first:pt-0"
                        >
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#eeeeee] text-[#121212] px-2.5 py-1.5 flex items-start gap-1.5 text-[11px] leading-snug">
              <Check className="w-3.5 h-3.5 text-[#15803d] shrink-0 mt-0.5" />
              <span className="font-mono text-[10px] text-[#333333]">
                Verified: V ≤ {parameters.maxVelocityMs.toFixed(1)} m/s (Hdr ≤{' '}
                {calcResult.pipeHeader.maxVelocityMs.toFixed(1)}), P ≤{' '}
                {parameters.maxStaticPressureBar.toFixed(2)} bar, P1/P2 ≤{' '}
                {formatCavitationRatio(getEffectiveCavitationRatioLimit(parameters))}.
              </span>
            </div>
          )}
        </section>
      )}
    </aside>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { calculateTotalLuFromAppliances } from './data/appliances';
import { BUILDING_PRESETS } from './data/pipeSpecs';
import {
  DesignParameters,
  DesignStandard,
  FloorInputRow,
  PipeSpecId,
  PrvOverrideMode,
  RiserTarget,
  SupplyMode,
} from './types/hydraulics';
import {
  getEffectiveStandard,
  isSameRiserTarget,
  runHydraulicCalculations,
  scaleFloorLoadSplitsForTotal,
  setPrvStationSetPressure,
  setRiserBoosterPressure,
  toggleRiserBoosterPump,
} from './utils/calculations';
import {
  CUSTOM_PRESET_ID,
  ImportedProjectState,
  cloneFloorRow,
  cloneParameters,
  isProjectModifiedFromPreset,
} from './utils/projectExcel';
import { SidebarControls } from './components/SidebarControls';
import { SummaryDashboard } from './components/SummaryDashboard';
import { ScheduleTable } from './components/ScheduleTable';
import { RiserSchematic } from './components/RiserSchematic';
import { PressureProfile } from './components/PressureProfile';
import { FloorInputGrid } from './components/FloorInputGrid';
import { PipeSpecTables } from './components/PipeSpecTables';
import { ApplianceUnitsModal } from './components/ApplianceUnitsModal';
import { ReportPreviewModal } from './components/ReportPreviewModal';
import { BuildingPresetsModal } from './components/BuildingPresetsModal';
import { FooterFormulaBar } from './components/FooterFormulaBar';
import { DisclaimerModal } from './components/DisclaimerModal';
import {
  acknowledgeDisclaimer,
  hasAcknowledgedDisclaimer,
} from './data/disclaimer';

type ActiveView = 'inputs' | 'schematic' | 'pressure' | 'schedule';

const DEFAULT_PRESET = BUILDING_PRESETS[0];

export function App() {
  const [activePresetId, setActivePresetId] = useState<string>(DEFAULT_PRESET.id);
  const [parameters, setParameters] = useState<DesignParameters>(() =>
    cloneParameters(DEFAULT_PRESET.parameters)
  );
  const [floors, setFloors] = useState<FloorInputRow[]>(() =>
    DEFAULT_PRESET.floors.map(cloneFloorRow)
  );
  const [activeView, setActiveView] = useState<ActiveView>('inputs');
  const [isAddPrvMode, setIsAddPrvMode] = useState<boolean>(false);
  const [selectedRiser, setSelectedRiser] = useState<RiserTarget | null>(null);
  const [isPresetsOpen, setIsPresetsOpen] = useState<boolean>(false);
  const [isApplianceUnitsOpen, setIsApplianceUnitsOpen] = useState<boolean>(false);
  const [isSpecsOpen, setIsSpecsOpen] = useState<boolean>(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [isFirstUseDisclaimer, setIsFirstUseDisclaimer] = useState<boolean>(
    () => !hasAcknowledgedDisclaimer()
  );
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState<boolean>(
    () => !hasAcknowledgedDisclaimer()
  );

  const handleCloseDisclaimer = () => {
    acknowledgeDisclaimer();
    setIsFirstUseDisclaimer(false);
    setIsDisclaimerOpen(false);
  };

  const handleOpenDisclaimer = () => {
    setIsFirstUseDisclaimer(false);
    setIsDisclaimerOpen(true);
  };

  useEffect(() => {
    if (activePresetId === CUSTOM_PRESET_ID) return;
    const activePreset = BUILDING_PRESETS.find((p) => p.id === activePresetId);
    if (!activePreset) return;
    if (isProjectModifiedFromPreset(activePreset, parameters, floors)) {
      setActivePresetId(CUSTOM_PRESET_ID);
    }
  }, [activePresetId, parameters, floors]);

  const calcResult = useMemo(
    () => runHydraulicCalculations(floors, parameters),
    [floors, parameters]
  );

  const handleUpdateParameters = (patch: Partial<DesignParameters>) => {
    setParameters((prev) => {
      const next = { ...prev, ...patch };
      if (
        prev.pipeHeaderCustomSize &&
        !('pipeHeaderCustomSize' in patch) &&
        ('pipeSpecId' in patch || 'optionalPipeSpecId' in patch)
      ) {
        const targetSpecId = prev.pipeHeaderCustomSize.specId ?? prev.pipeSpecId;
        const stillActive =
          targetSpecId === next.pipeSpecId ||
          (next.optionalPipeSpecId != null && targetSpecId === next.optionalPipeSpecId);
        if (!stillActive) {
          next.pipeHeaderCustomSize = null;
        }
      }
      return next;
    });
  };

  const handleChangeStandard = (nextStandard: DesignStandard) => {
    const currentEffective = getEffectiveStandard(parameters.standard);
    if (currentEffective === nextStandard && !parameters.flowFormula) {
      return;
    }

    setParameters((prev) => ({
      ...prev,
      standard: nextStandard === DesignStandard.BS_6700 ? undefined : nextStandard,
      flowFormula: undefined,
    }));

    setFloors((prev) =>
      prev.map((row) => {
        if (
          row.supplyMode === SupplyMode.ROOF_HEADER ||
          !row.applianceCounts ||
          Object.keys(row.applianceCounts).length === 0
        ) {
          return row;
        }
        const nextLu = calculateTotalLuFromAppliances(row.applianceCounts, nextStandard);
        const hasSplits = row.loadSplits && row.loadSplits.length >= 2;
        return {
          ...row,
          loadingUnits: nextLu,
          ...(hasSplits ? { loadSplits: scaleFloorLoadSplitsForTotal(row, nextLu) } : {}),
        };
      })
    );
  };

  const handleTogglePipeSize = (specIds: PipeSpecId[], nominalSize: number) => {
    setParameters((prev) => {
      const currentExcluded = prev.excludedPipeSizes ?? {};
      const primaryRefSpec = specIds[0];
      const currentlyExcluded =
        primaryRefSpec !== undefined &&
        (currentExcluded[primaryRefSpec]?.includes(nominalSize) ?? false);

      const nextExcluded: Partial<Record<PipeSpecId, number[]>> = {
        ...currentExcluded,
      };

      for (const specId of specIds) {
        const prevList = nextExcluded[specId] ?? [];
        if (currentlyExcluded) {
          const filtered = prevList.filter((s) => s !== nominalSize);
          if (filtered.length > 0) {
            nextExcluded[specId] = filtered;
          } else {
            delete nextExcluded[specId];
          }
        } else if (!prevList.includes(nominalSize)) {
          nextExcluded[specId] = [...prevList, nominalSize].sort((a, b) => a - b);
        }
      }

      const hasAnyExcluded = Object.keys(nextExcluded).length > 0;
      let nextHeaderCustomSize = prev.pipeHeaderCustomSize;
      if (!currentlyExcluded && nextHeaderCustomSize) {
        const customSpecId = nextHeaderCustomSize.specId ?? prev.pipeSpecId;
        if (
          specIds.includes(customSpecId) &&
          nextHeaderCustomSize.nominalSize === nominalSize
        ) {
          nextHeaderCustomSize = null;
        }
      }

      return {
        ...prev,
        excludedPipeSizes: hasAnyExcluded ? nextExcluded : undefined,
        pipeHeaderCustomSize: nextHeaderCustomSize,
      };
    });
  };

  const handleSetPipeSizesIncluded = (
    specIds: PipeSpecId[],
    nominalSizes: number[],
    include: boolean
  ) => {
    setParameters((prev) => {
      const nextExcluded: Partial<Record<PipeSpecId, number[]>> = {
        ...(prev.excludedPipeSizes ?? {}),
      };

      if (include) {
        const toIncludeSet = new Set(nominalSizes);
        for (const specId of specIds) {
          const prevList = nextExcluded[specId];
          if (!prevList) continue;
          const remaining = prevList.filter((s) => !toIncludeSet.has(s));
          if (remaining.length > 0) {
            nextExcluded[specId] = remaining;
          } else {
            delete nextExcluded[specId];
          }
        }
      } else {
        for (const specId of specIds) {
          const merged = Array.from(
            new Set([...(nextExcluded[specId] ?? []), ...nominalSizes])
          ).sort((a, b) => a - b);
          if (merged.length > 0) {
            nextExcluded[specId] = merged;
          }
        }
      }

      const hasAnyExcluded = Object.keys(nextExcluded).length > 0;
      let nextHeaderCustomSize = prev.pipeHeaderCustomSize;
      if (!include && nextHeaderCustomSize) {
        const customSpecId = nextHeaderCustomSize.specId ?? prev.pipeSpecId;
        if (
          specIds.includes(customSpecId) &&
          nominalSizes.includes(nextHeaderCustomSize.nominalSize)
        ) {
          nextHeaderCustomSize = null;
        }
      }

      return {
        ...prev,
        excludedPipeSizes: hasAnyExcluded ? nextExcluded : undefined,
        pipeHeaderCustomSize: nextHeaderCustomSize,
      };
    });
  };

  const handleSelectPreset = (presetId: string) => {
    const found = BUILDING_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setActivePresetId(found.id);
    setParameters(cloneParameters(found.parameters));
    setFloors(found.floors.map(cloneFloorRow));
    setSelectedRiser(null);
    setIsAddPrvMode(false);
  };

  const handleImportProject = (imported: ImportedProjectState) => {
    setActivePresetId(CUSTOM_PRESET_ID);
    setParameters(cloneParameters(imported.parameters));
    setFloors(imported.floors.map(cloneFloorRow));
    setSelectedRiser(null);
    setIsAddPrvMode(false);
  };

  const handleCyclePrvOverride = (floorId: string) => {
    const calcRow = calcResult.rows.find((r) => r.input.id === floorId);
    const servedSubId = calcRow?.primarySubDropperId ?? null;
    const servedDropperIndices = calcRow
      ? Object.values(calcRow.dropperCells)
          .filter((c) => c.isServed)
          .map((c) => c.dropperIndex)
      : [];

    setFloors((prev) =>
      prev.map((f) => {
        if (f.id !== floorId) return f;
        const currentEffective =
          servedSubId && f.subDropperPrvOverrides?.[servedSubId]
            ? f.subDropperPrvOverrides[servedSubId]
            : f.prvOverride;

        const nextMode =
          currentEffective === PrvOverrideMode.AUTO
            ? PrvOverrideMode.FORCE_PRV
            : currentEffective === PrvOverrideMode.FORCE_PRV
            ? PrvOverrideMode.NO_PRV
            : PrvOverrideMode.AUTO;

        if (servedSubId) {
          const copySubOverrides = { ...(f.subDropperPrvOverrides ?? {}) };
          if (nextMode === PrvOverrideMode.AUTO) {
            delete copySubOverrides[servedSubId];
          } else {
            copySubOverrides[servedSubId] = nextMode;
          }
          const nextSubOverrides =
            Object.keys(copySubOverrides).length > 0 ? copySubOverrides : undefined;

          let nextSubSetPressures = f.subDropperPrvSetPressures;
          if (nextMode === PrvOverrideMode.NO_PRV && nextSubSetPressures) {
            const copySet = { ...nextSubSetPressures };
            delete copySet[servedSubId];
            nextSubSetPressures = Object.keys(copySet).length > 0 ? copySet : undefined;
          }

          return {
            ...f,
            prvOverride: nextMode,
            subDropperPrvOverrides: nextSubOverrides,
            subDropperPrvSetPressures: nextSubSetPressures,
          };
        }

        let nextDropperOverrides = f.dropperPrvOverrides;
        if (nextDropperOverrides && servedDropperIndices.length > 0) {
          const copy = { ...nextDropperOverrides };
          for (const dIdx of servedDropperIndices) {
            if (nextMode === PrvOverrideMode.AUTO) {
              delete copy[dIdx];
            } else {
              copy[dIdx] = nextMode;
            }
          }
          nextDropperOverrides = Object.keys(copy).length > 0 ? copy : undefined;
        }

        let nextDropperSetPressures = f.dropperPrvSetPressures;
        if (nextMode === PrvOverrideMode.NO_PRV && nextDropperSetPressures) {
          const copySet = { ...nextDropperSetPressures };
          for (const dIdx of servedDropperIndices) {
            delete copySet[dIdx];
          }
          nextDropperSetPressures = Object.keys(copySet).length > 0 ? copySet : undefined;
        }

        return {
          ...f,
          prvOverride: nextMode,
          dropperPrvOverrides: nextDropperOverrides,
          dropperPrvSetPressures: nextDropperSetPressures,
        };
      })
    );
  };

  const handleSetPrvPressure = (
    floorId: string,
    target: number | RiserTarget,
    downstreamPressureBar: number | null
  ) => {
    setFloors((prev) =>
      setPrvStationSetPressure(prev, calcResult, target, floorId, downstreamPressureBar)
    );
  };

  const handleToggleBoosterPump = (target: RiserTarget) => {
    const patch = toggleRiserBoosterPump(parameters, calcResult, target);
    if (Object.keys(patch).length > 0) {
      handleUpdateParameters(patch);
    }
  };

  const handleSetBoosterPressure = (
    target: RiserTarget,
    pressureBar: number | null
  ) => {
    const patch = setRiserBoosterPressure(parameters, target, pressureBar);
    if (Object.keys(patch).length > 0) {
      handleUpdateParameters(patch);
    }
  };

  const navItems: { id: ActiveView; label: string }[] = [
    { id: 'inputs', label: 'Floor Data' },
    { id: 'schematic', label: 'Schematic' },
    { id: 'pressure', label: 'Pressure Profile' },
    { id: 'schedule', label: 'Calc Schedule' },
  ];

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#f8f8f8] text-[#121212] lg:overflow-hidden">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-4 lg:px-5 py-2.5 bg-white border-b-2 border-[#121212] shrink-0">
        {/* Zone 1: Single Brand Wordmark */}
        <a
          href="#inputs"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('inputs');
          }}
          className="font-display font-bold text-sm tracking-[-0.04em] uppercase text-[#121212] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#121212]"
        >
          HydroDrop Calc
        </a>

        {/* Zone 2: Concise Single-Line Navigation Links */}
        <nav
          aria-label="Primary Workspace Views"
          className="hidden md:flex items-center gap-6 text-[11px] font-display font-bold uppercase tracking-[0.08em]"
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-[#121212] ${
                  isActive
                    ? 'text-[#121212] border-[#121212]'
                    : 'text-[#666666] border-transparent hover:text-[#121212]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            className="px-3.5 py-2 bg-[#121212] hover:bg-[#2a2a2a] text-white font-display text-[11px] font-bold uppercase tracking-[0.06em] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#121212]"
          >
            Preview Report
          </button>
        </div>
      </header>

      {/* Mobile View Switcher (visible below md) */}
      <div className="md:hidden grid grid-cols-4 border-b border-[#e0e0e0] bg-white shrink-0">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={`mob-${item.id}`}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`py-2.5 px-2 text-[11px] font-display font-bold uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap truncate ${
                isActive
                  ? 'border-[#121212] text-[#121212] bg-[#f8f8f8]'
                  : 'border-transparent text-[#666666] hover:text-[#121212]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Two-Pane Engineering Workbench (Left Configuration + Dropper Schedule | Main Canvas) */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[416px_1fr] xl:grid-cols-[428px_1fr]">
        {/* Pane 01: Configuration, Dropper Schedule & Engineering Verification Alerts */}
        <SidebarControls
          parameters={parameters}
          calcResult={calcResult}
          activePresetId={activePresetId}
          onUpdateParameters={handleUpdateParameters}
          onChangeStandard={handleChangeStandard}
          onOpenPresets={() => setIsPresetsOpen(true)}
          onOpenApplianceUnits={() => setIsApplianceUnitsOpen(true)}
          onOpenSpecs={() => setIsSpecsOpen(true)}
          dropperScheduleSlot={
            <SummaryDashboard
              result={calcResult}
              selectedRiser={selectedRiser}
              onSelectRiser={(target) =>
                setSelectedRiser((prev) => (isSameRiserTarget(prev, target) ? null : target))
              }
              onToggleBoosterPump={handleToggleBoosterPump}
              onSetBoosterPressure={handleSetBoosterPressure}
            />
          }
        />

        {/* Central Drafting & Calculation Canvas */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white overflow-hidden">

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white">
            {activeView === 'schedule' && (
              <ScheduleTable
                result={calcResult}
                onCyclePrvOverride={handleCyclePrvOverride}
                onSetPrvPressure={handleSetPrvPressure}
                onSetBoosterPressure={handleSetBoosterPressure}
                onOpenFloorInputs={() => setActiveView('inputs')}
              />
            )}

            {activeView === 'schematic' && (
              <RiserSchematic
                result={calcResult}
                floors={floors}
                onChangeFloors={setFloors}
                onUpdateParameters={handleUpdateParameters}
                isAddPrvMode={isAddPrvMode}
                onChangeAddPrvMode={setIsAddPrvMode}
                highlightedRiser={selectedRiser}
                stickyHeader
              />
            )}

            {activeView === 'pressure' && (
              <PressureProfile
                result={calcResult}
                highlightedRiser={selectedRiser}
                stickyHeader
              />
            )}

            {activeView === 'inputs' && (
              <FloorInputGrid
                floors={floors}
                zoningStrategy={parameters.zoningStrategy}
                parameters={parameters}
                calcResult={calcResult}
                dropperSummaries={calcResult.dropperSummaries}
                subDropperSummaries={calcResult.subDropperSummaries}
                onChangeFloors={setFloors}
                onUpdateParameters={handleUpdateParameters}
              />
            )}
          </div>
        </main>
      </div>

      {/* Dark Engineering Formula Footer (Interactive Click-to-Edit) */}
      <FooterFormulaBar
        parameters={parameters}
        calcResult={calcResult}
        onUpdateParameters={handleUpdateParameters}
        onOpenDisclaimer={handleOpenDisclaimer}
      />

      {/* Building Presets Selection & Project Import/Export Modal */}
      <BuildingPresetsModal
        isOpen={isPresetsOpen}
        activePresetId={activePresetId}
        parameters={parameters}
        floors={floors}
        calcResult={calcResult}
        onSelectPreset={handleSelectPreset}
        onImportProject={handleImportProject}
        onClose={() => setIsPresetsOpen(false)}
      />

      {/* Appliance Loading Units Reference Modal */}
      <ApplianceUnitsModal
        isOpen={isApplianceUnitsOpen}
        standard={parameters.standard}
        flowFormula={parameters.flowFormula}
        onChangeStandard={handleChangeStandard}
        onClose={() => setIsApplianceUnitsOpen(false)}
      />

      {/* Tabbed Pipe Specification Lookup Modal */}
      <PipeSpecTables
        isOpen={isSpecsOpen}
        activeSpecId={parameters.pipeSpecId}
        optionalSpecId={parameters.optionalPipeSpecId ?? null}
        maxVelocityMs={parameters.maxVelocityMs}
        standard={parameters.standard}
        flowFormula={parameters.flowFormula}
        excludedPipeSizes={parameters.excludedPipeSizes}
        onTogglePipeSize={handleTogglePipeSize}
        onSetPipeSizesIncluded={handleSetPipeSizesIncluded}
        onClose={() => setIsSpecsOpen(false)}
      />

      {/* Engineering Report Preview Modal */}
      <ReportPreviewModal
        isOpen={isPreviewOpen}
        result={calcResult}
        onClose={() => setIsPreviewOpen(false)}
        onOpenDisclaimer={handleOpenDisclaimer}
      />

      {/* Engineering Notice & Disclaimer Modal */}
      <DisclaimerModal
        isOpen={isDisclaimerOpen}
        isFirstUseNotice={isFirstUseDisclaimer}
        onAcknowledgeAndClose={handleCloseDisclaimer}
      />
    </div>
  );
}

export default App;

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  ChevronUp,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Info,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import { BUILDING_PRESETS } from '../data/pipeSpecs';
import {
  DesignParameters,
  FloorInputRow,
  SystemCalculationResult,
} from '../types/hydraulics';
import {
  CUSTOM_PRESET_ID,
  exportProjectToCsv,
  exportProjectToExcel,
  exportProjectToJson,
  ImportedProjectState,
  importProjectFromExcel,
} from '../utils/projectExcel';

interface BuildingPresetsModalProps {
  isOpen: boolean;
  activePresetId: string;
  parameters: DesignParameters;
  floors: FloorInputRow[];
  calcResult: SystemCalculationResult;
  onSelectPreset: (presetId: string) => void;
  onImportProject: (imported: ImportedProjectState, fileName: string) => void;
  onClose: () => void;
}

function getPresetIcon(presetId: string) {
  switch (presetId) {
    case 'preset-blank':
      return FileText;
    default:
      return Building2;
  }
}

export const BuildingPresetsModal: React.FC<BuildingPresetsModalProps> = ({
  isOpen,
  activePresetId,
  parameters,
  floors,
  calcResult,
  onSelectPreset,
  onImportProject,
  onClose,
}) => {
  const [pendingPresetId, setPendingPresetId] = useState<string>(activePresetId);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPendingPresetId(activePresetId);
      setStatusBanner(null);
      setIsExportMenuOpen(false);
    }
  }, [isOpen, activePresetId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isExportMenuOpen) {
          setIsExportMenuOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExportMenuOpen, onClose]);

  useEffect(() => {
    if (!isExportMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setIsExportMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isExportMenuOpen]);

  if (!isOpen) return null;

  const isCustomActive = activePresetId === CUSTOM_PRESET_ID;
  const hasPendingPresetSwitch =
    pendingPresetId !== CUSTOM_PRESET_ID && pendingPresetId !== activePresetId;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsImporting(true);
    setStatusBanner(null);
    try {
      const imported = await importProjectFromExcel(file, parameters);
      onImportProject(imported, file.name);
      setPendingPresetId(CUSTOM_PRESET_ID);
      const modeText =
        imported.sourceFormat === 'json-template'
          ? 'JSON template'
          : imported.sourceFormat === 'full-project'
          ? 'full project state'
          : 'floor schedule';
      setStatusBanner({
        type: 'success',
        message: `Imported ${modeText} from "${file.name}" (${imported.floors.length} ${
          imported.floors.length === 1 ? 'floor' : 'floors'
        }) — Custom template is now active.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to import project file. Verify file format (.xlsx, .csv, or .json).',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportFormat = (format: 'xlsx' | 'json' | 'csv') => {
    setIsExportMenuOpen(false);
    const floorCountLabel = `${floors.length} ${floors.length === 1 ? 'floor' : 'floors'}`;
    try {
      if (format === 'xlsx') {
        exportProjectToExcel(parameters, floors, calcResult);
        setStatusBanner({
          type: 'success',
          message: `Exported complete project workbook (.xlsx) with ${floorCountLabel}.`,
        });
      } else if (format === 'json') {
        exportProjectToJson(parameters, floors);
        setStatusBanner({
          type: 'success',
          message: `Exported lossless project template (.json) with ${floorCountLabel}.`,
        });
      } else {
        exportProjectToCsv(parameters, floors, calcResult);
        setStatusBanner({
          type: 'success',
          message: `Exported tabular floor & hydraulic schedule (.csv) with ${floorCountLabel}.`,
        });
      }
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to export project file.',
      });
    }
  };

  const handleApply = () => {
    if (hasPendingPresetSwitch) {
      onSelectPreset(pendingPresetId);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#121212]/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="building-presets-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[580px] bg-white border-2 border-[#121212] flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#eeeeee] border-b border-[#e0e0e0] flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2
              id="building-presets-title"
              className="font-display text-xs font-bold uppercase tracking-wider text-[#121212]"
            >
              Building Templates
            </h2>
            <p className="text-xs text-[#555555] mt-0.5">
              Select a template, import an existing file (.xlsx / .csv / .json), or export your current project.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close building templates"
            className="h-8 w-8 inline-flex items-center justify-center bg-white border border-[#e0e0e0] text-[#555555] hover:text-[#121212] hover:border-[#121212] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preset Options + Custom Card */}
        <div className="p-4 space-y-2 bg-[#f8f8f8] overflow-y-auto flex-1 min-h-0">
          {BUILDING_PRESETS.map((preset) => {
            const isActive = activePresetId === preset.id;
            const isPending = pendingPresetId === preset.id;
            const Icon = getPresetIcon(preset.id);

            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`preset-card-${preset.id}`}
                onClick={() => {
                  setPendingPresetId(preset.id);
                  setStatusBanner(null);
                }}
                onDoubleClick={() => {
                  onSelectPreset(preset.id);
                  onClose();
                }}
                className={`w-full text-left px-3.5 py-3 border transition-colors flex items-start justify-between gap-3 ${
                  isPending
                    ? 'bg-white border-2 border-[#121212] text-[#121212]'
                    : 'bg-white border-[#e0e0e0] text-[#121212] hover:border-[#121212]'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={`w-8 h-8 inline-flex items-center justify-center border shrink-0 mt-0.5 ${
                      isPending
                        ? 'bg-[#121212] text-white border-[#121212]'
                        : 'bg-[#f8f8f8] text-[#333333] border-[#e0e0e0]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold leading-snug">{preset.name}</div>
                    <div className="text-[11px] text-[#555555] mt-1 leading-relaxed">
                      {preset.subtitle}
                    </div>
                  </div>
                </div>
                {isActive ? (
                  <span
                    data-testid={`preset-active-badge-${preset.id}`}
                    className="mt-0.5 inline-flex items-center gap-1 font-display text-[10px] font-bold uppercase text-[#121212] shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Active</span>
                  </span>
                ) : isPending ? (
                  <span className="mt-0.5 font-display text-[10px] font-bold uppercase text-[#555555] shrink-0">
                    Selected
                  </span>
                ) : null}
              </button>
            );
          })}

          {/* Auto-Activating Custom Template Card */}
          <div
            data-testid="preset-card-custom"
            aria-disabled={!isCustomActive}
            onClick={() => {
              if (isCustomActive) {
                setPendingPresetId(CUSTOM_PRESET_ID);
              }
            }}
            className={`w-full text-left px-3.5 py-3 border transition-colors flex items-start justify-between gap-3 ${
              isCustomActive
                ? pendingPresetId === CUSTOM_PRESET_ID
                  ? 'bg-white border-2 border-[#121212] text-[#121212] cursor-pointer'
                  : 'bg-white border border-[#121212] text-[#121212] cursor-pointer'
                : 'bg-[#f2f2f2] border-[#e0e0e0] text-[#888888] cursor-default select-none'
            }`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <span
                className={`w-8 h-8 inline-flex items-center justify-center border shrink-0 mt-0.5 ${
                  isCustomActive
                    ? 'bg-[#121212] text-white border-[#121212]'
                    : 'bg-[#ebebeb] text-[#999999] border-[#e0e0e0]'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold leading-snug">Custom</div>
                <div
                  className={`text-[11px] mt-1 leading-relaxed ${
                    isCustomActive ? 'text-[#555555]' : 'text-[#888888]'
                  }`}
                >
                  Automatically activates when changes are made to any template or an external file is imported.
                </div>
              </div>
            </div>
            {isCustomActive && (
              <span
                data-testid="preset-active-badge-custom"
                className="mt-0.5 inline-flex items-center gap-1 font-display text-[10px] font-bold uppercase text-[#121212] shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Active</span>
              </span>
            )}
          </div>
        </div>

        {/* Import / Export Status Feedback */}
        {statusBanner && (
          <div
            role="status"
            className={`px-4 py-2 border-t text-xs font-mono flex items-start gap-2 shrink-0 ${
              statusBanner.type === 'success'
                ? 'bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]'
                : 'bg-[#fef2f2] border-[#fecaca] text-[#d90000]'
            }`}
          >
            {statusBanner.type === 'success' ? (
              <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            )}
            <span>{statusBanner.message}</span>
          </div>
        )}

        {/* Footer Controls */}
        <div className="px-4 py-3 bg-white border-t border-[#e0e0e0] space-y-2.5 shrink-0">
          <div className="flex items-start gap-1.5 text-[11px] text-[#555555] leading-snug">
            <Info className="w-3.5 h-3.5 text-[#555555] shrink-0 mt-0.5" />
            <span>
              Export captures all configuration parameters, pipe size exclusions, floor data, sub-droppers, PRVs, and booster overrides. Import restores exact state.
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.json"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Import HydroDrop project file (.xlsx, .csv, or .json)"
                data-testid="project-import-file-input"
              />
              <button
                type="button"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                data-testid="project-import-btn"
                className="h-8 px-3 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] disabled:opacity-50 font-display text-[10px] font-bold uppercase inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isImporting ? 'Importing...' : 'Import'}</span>
              </button>

              <div ref={exportMenuRef} className="relative inline-flex">
                {isExportMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Export options"
                    data-testid="export-options-menu"
                    className="absolute bottom-full left-0 mb-2 w-72 bg-white border-2 border-[#121212] shadow-lg z-20 overflow-hidden"
                  >
                    <div className="px-3 py-2 bg-[#eeeeee] border-b border-[#e0e0e0] font-display text-[10px] font-bold uppercase tracking-wider text-[#555555]">
                      Export Options
                    </div>
                    <div className="divide-y divide-[#e0e0e0]">
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="export-option-xlsx"
                        onClick={() => handleExportFormat('xlsx')}
                        className="w-full px-3 py-2.5 text-left hover:bg-[#f8f8f8] flex items-start gap-2.5 transition-colors"
                      >
                        <span className="w-7 h-7 inline-flex items-center justify-center border border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d] shrink-0 mt-0.5">
                          <FileSpreadsheet className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#121212] leading-snug">
                            Excel Workbook (.xlsx)
                          </div>
                          <div className="text-[11px] text-[#555555] leading-snug mt-0.5">
                            6 sheets, config, floors &amp; calc snapshot
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        data-testid="export-option-json"
                        onClick={() => handleExportFormat('json')}
                        className="w-full px-3 py-2.5 text-left hover:bg-[#f8f8f8] flex items-start gap-2.5 transition-colors"
                      >
                        <span className="w-7 h-7 inline-flex items-center justify-center border border-[#fde68a] bg-[#fffbeb] text-[#b45309] shrink-0 mt-0.5">
                          <FileJson className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#121212] leading-snug">
                            Project Template (.json)
                          </div>
                          <div className="text-[11px] text-[#555555] leading-snug mt-0.5">
                            Lossless template backup &amp; restore
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        data-testid="export-option-csv"
                        onClick={() => handleExportFormat('csv')}
                        className="w-full px-3 py-2.5 text-left hover:bg-[#f8f8f8] flex items-start gap-2.5 transition-colors"
                      >
                        <span className="w-7 h-7 inline-flex items-center justify-center border border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8] shrink-0 mt-0.5">
                          <FileText className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#121212] leading-snug">
                            CSV Spreadsheet (.csv)
                          </div>
                          <div className="text-[11px] text-[#555555] leading-snug mt-0.5">
                            Plain text tabular schedule
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleExportFormat('xlsx')}
                  title="Export Excel Workbook (.xlsx)"
                  data-testid="project-export-btn"
                  className="h-8 px-3 bg-white border border-[#15803d] text-[#15803d] hover:bg-[#15803d] hover:text-white font-display text-[10px] font-bold uppercase inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsExportMenuOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={isExportMenuOpen}
                  aria-label="Choose export format (Excel, JSON template, CSV)"
                  title="Choose export format (Excel, JSON template, CSV)"
                  data-testid="project-export-options-btn"
                  className={`h-8 px-2 border border-l-0 border-[#15803d] inline-flex items-center justify-center transition-colors ${
                    isExportMenuOpen
                      ? 'bg-[#15803d] text-white'
                      : 'bg-white text-[#15803d] hover:bg-[#15803d] hover:text-white'
                  }`}
                >
                  <ChevronUp
                    className={`w-3.5 h-3.5 transition-transform ${
                      isExportMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleApply}
              data-testid="preset-apply-btn"
              className="h-8 px-4 bg-[#121212] hover:bg-[#2a2a2a] text-white font-display text-[10px] font-bold uppercase inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{hasPendingPresetSwitch ? 'Apply' : 'Done'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

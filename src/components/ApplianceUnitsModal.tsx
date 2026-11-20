import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { APPLIANCE_LOADING_UNITS, getStandardLabel } from '../data/appliances';
import { DesignStandard, FlowConversionFormula } from '../types/hydraulics';
import { formatFlowFormulaDisplay, getEffectiveStandard } from '../utils/calculations';

interface ApplianceUnitsModalProps {
  isOpen: boolean;
  standard?: DesignStandard;
  flowFormula?: FlowConversionFormula;
  onChangeStandard?: (nextStandard: DesignStandard) => void;
  onClose: () => void;
}

export const ApplianceUnitsModal: React.FC<ApplianceUnitsModalProps> = ({
  isOpen,
  standard,
  flowFormula,
  onChangeStandard,
  onClose,
}) => {
  const effectiveStandard = getEffectiveStandard(standard);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isBs6700 = effectiveStandard === DesignStandard.BS_6700;
  const isBsEn806 = effectiveStandard === DesignStandard.BS_EN_806_3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#121212]/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appliance-units-modal-title"
      data-testid="appliance-units-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[720px] max-h-[90vh] flex flex-col bg-white border-2 border-[#121212] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#eeeeee] border-b border-[#e0e0e0] flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2
              id="appliance-units-modal-title"
              className="font-display text-xs font-bold uppercase tracking-wider text-[#121212]"
            >
              Appliance Loading Units Reference
            </h2>
            <p className="text-xs text-[#555555] mt-0.5">
              Active Standard:{' '}
              <span className="font-mono font-semibold text-[#121212]">
                {getStandardLabel(effectiveStandard)}
              </span>
              {' · '}
              <span className="font-mono tabular-nums text-[#555555]">
                {formatFlowFormulaDisplay(flowFormula, effectiveStandard)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close appliance loading units table"
            className="h-8 w-8 inline-flex items-center justify-center bg-white border border-[#e0e0e0] text-[#555555] hover:text-[#121212] hover:border-[#121212] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Standard Quick Switcher Bar */}
        {onChangeStandard && (
          <div className="px-4 py-2 bg-[#f8f8f8] border-b border-[#e0e0e0] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#555555]">
              Active Standard
            </span>
            <div className="inline-flex items-center border border-[#e0e0e0] bg-white">
              <button
                type="button"
                onClick={() => onChangeStandard(DesignStandard.BS_6700)}
                className={`px-3 py-1 font-display text-[10px] font-bold uppercase border-r border-[#e0e0e0] transition-colors ${
                  isBs6700
                    ? 'bg-[#121212] text-white'
                    : 'bg-white text-[#555555] hover:text-[#121212]'
                }`}
              >
                BS 6700
              </button>
              <button
                type="button"
                onClick={() => onChangeStandard(DesignStandard.BS_EN_806_3)}
                className={`px-3 py-1 font-display text-[10px] font-bold uppercase transition-colors ${
                  isBsEn806
                    ? 'bg-[#121212] text-white'
                    : 'bg-white text-[#555555] hover:text-[#121212]'
                }`}
              >
                BS EN 806-3
              </button>
            </div>
          </div>
        )}

        {/* Reference Table */}
        <div className="flex-1 overflow-y-auto p-4 bg-[#f8f8f8]">
          <div className="bg-white border border-[#e0e0e0] overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#eeeeee] text-[#121212] border-b-2 border-[#121212] font-display text-[10px] uppercase">
                  <th className="w-10 py-2 px-3 text-center font-bold border-r border-[#e0e0e0]">
                    #
                  </th>
                  <th className="py-2 px-3 text-left font-bold border-r border-[#e0e0e0]">
                    Type of Appliance
                  </th>
                  <th
                    className={`py-2 px-3 text-right font-bold border-r border-[#e0e0e0] ${
                      isBs6700 ? 'bg-[#e5e5e5] text-[#121212]' : ''
                    }`}
                  >
                    BS 6700 LU {isBs6700 ? '(Active)' : ''}
                  </th>
                  <th
                    className={`py-2 px-3 text-right font-bold ${
                      isBsEn806 ? 'bg-[#e5e5e5] text-[#121212]' : ''
                    }`}
                  >
                    BS EN 806-3 LU {isBsEn806 ? '(Active)' : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e0e0e0] font-mono tabular-nums">
                {APPLIANCE_LOADING_UNITS.map((app, index) => (
                  <tr key={app.id} className="hover:bg-[#f8f8f8]">
                    <td className="py-2 px-3 text-center text-[#666666] border-r border-[#e0e0e0]">
                      {index + 1}
                    </td>
                    <td className="py-2 px-3 text-left font-sans font-medium text-[#121212] border-r border-[#e0e0e0]">
                      {app.name}
                    </td>
                    <td
                      className={`py-2 px-3 text-right border-r border-[#e0e0e0] ${
                        isBs6700
                          ? 'bg-[#fafafa] font-semibold text-[#121212]'
                          : 'text-[#555555]'
                      }`}
                    >
                      {app.bs6700Lu}
                    </td>
                    <td
                      className={`py-2 px-3 text-right ${
                        isBsEn806
                          ? 'bg-[#fafafa] font-semibold text-[#121212]'
                          : 'text-[#555555]'
                      }`}
                    >
                      {app.bsEn806Lu}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 bg-white border border-[#e0e0e0] px-3 py-2 text-[11px] font-mono text-[#555555] space-y-0.5">
            <div>
              <strong className="text-[#121212]">BS 6700 Formula:</strong> Q = 0.0485 × LU^0.7162 L/s
            </div>
            <div>
              <strong className="text-[#121212]">BS EN 806-3 Formula:</strong> Q = 0.05794 × LU^0.5924 L/s
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Info, Pencil, RotateCcw, X } from 'lucide-react';
import { getStandardLabel } from '../data/appliances';
import {
  DesignParameters,
  FlowConversionFormula,
  SystemCalculationResult,
} from '../types/hydraulics';
import {
  calculateFlowRateFromLu,
  DEFAULT_CAVITATION_RATIO_LIMIT,
  formatCavitationRatio,
  formatFlowFormulaDisplay,
  getDefaultFlowFormulaForStandard,
  getEffectiveCavitationRatioLimit,
  getEffectiveFlowFormula,
  getEffectiveStandard,
  isDefaultCavitationRatioLimit,
  isDefaultFlowFormula,
  validateFlowExpression,
} from '../utils/calculations';

interface FooterFormulaBarProps {
  parameters: DesignParameters;
  calcResult: SystemCalculationResult;
  onUpdateParameters: (patch: Partial<DesignParameters>) => void;
  onOpenDisclaimer: () => void;
}

type ActiveFooterEditor = 'formula' | 'cavitation' | null;

export const FooterFormulaBar: React.FC<FooterFormulaBarProps> = ({
  parameters,
  calcResult,
  onUpdateParameters,
  onOpenDisclaimer,
}) => {
  const [activeEditor, setActiveEditor] = useState<ActiveFooterEditor>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveStandard = getEffectiveStandard(parameters.standard);
  const standardLabel = getStandardLabel(effectiveStandard);
  const stdDefaultFormula = getDefaultFlowFormulaForStandard(effectiveStandard);

  const effectiveFormula = getEffectiveFlowFormula(
    parameters.flowFormula,
    effectiveStandard
  );
  const effectiveCavLimit = getEffectiveCavitationRatioLimit(parameters);
  const isCustomFormula = !isDefaultFlowFormula(
    parameters.flowFormula,
    effectiveStandard
  );
  const isCustomCavLimit = !isDefaultCavitationRatioLimit(parameters.cavitationRatioLimit);

  const [formulaMode, setFormulaMode] = useState<'power' | 'expression'>(
    effectiveFormula.mode
  );
  const [coeffDraft, setCoeffDraft] = useState<string>(() =>
    String(effectiveFormula.coefficient)
  );
  const [expDraft, setExpDraft] = useState<string>(() =>
    String(effectiveFormula.exponent)
  );
  const [exprDraft, setExprDraft] = useState<string>(
    () => effectiveFormula.expression ?? stdDefaultFormula.expression
  );
  const [coeffError, setCoeffError] = useState<string | null>(null);
  const [expError, setExpError] = useState<string | null>(null);
  const [exprError, setExprError] = useState<string | null>(null);

  const [cavDraft, setCavDraft] = useState<string>(() =>
    formatCavitationRatio(effectiveCavLimit)
  );
  const [cavError, setCavError] = useState<string | null>(null);

  // Sync drafts when opening a popover or when parameters/standard change externally
  useEffect(() => {
    if (activeEditor === 'formula') {
      const f = getEffectiveFlowFormula(parameters.flowFormula, effectiveStandard);
      const def = getDefaultFlowFormulaForStandard(effectiveStandard);
      setFormulaMode(f.mode);
      setCoeffDraft(String(f.coefficient));
      setExpDraft(String(f.exponent));
      setExprDraft(
        f.mode === 'expression'
          ? f.expression ?? def.expression
          : `${f.coefficient} * LU^${f.exponent}`
      );
      setCoeffError(null);
      setExpError(null);
      setExprError(null);
    } else if (activeEditor === 'cavitation') {
      setCavDraft(formatCavitationRatio(getEffectiveCavitationRatioLimit(parameters)));
      setCavError(null);
    }
  }, [activeEditor, parameters.flowFormula, parameters.cavitationRatioLimit, effectiveStandard]);

  // Close popover on outside click or Escape key
  useEffect(() => {
    if (!activeEditor) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveEditor(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveEditor(null);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeEditor]);

  const commitPowerParams = (nextCoeffStr: string, nextExpStr: string) => {
    const c = Number(nextCoeffStr);
    const e = Number(nextExpStr);

    const cValid = nextCoeffStr.trim() !== '' && Number.isFinite(c) && c > 0 && c <= 100;
    const eValid = nextExpStr.trim() !== '' && Number.isFinite(e) && e > 0 && e <= 5;

    setCoeffError(cValid ? null : 'Must be > 0 and ≤ 100');
    setExpError(eValid ? null : 'Must be > 0 and ≤ 5');

    if (!cValid || !eValid) return;

    const candidate: FlowConversionFormula = {
      mode: 'power',
      coefficient: c,
      exponent: e,
    };
    onUpdateParameters({
      flowFormula: isDefaultFlowFormula(candidate, effectiveStandard) ? undefined : candidate,
    });
  };

  const handleModeSwitch = (nextMode: 'power' | 'expression') => {
    setFormulaMode(nextMode);
    setCoeffError(null);
    setExpError(null);
    setExprError(null);

    if (nextMode === 'power') {
      const c = Number(coeffDraft);
      const e = Number(expDraft);
      const validC = Number.isFinite(c) && c > 0 ? c : stdDefaultFormula.coefficient;
      const validE = Number.isFinite(e) && e > 0 ? e : stdDefaultFormula.exponent;
      setCoeffDraft(String(validC));
      setExpDraft(String(validE));
      const candidate: FlowConversionFormula = {
        mode: 'power',
        coefficient: validC,
        exponent: validE,
      };
      onUpdateParameters({
        flowFormula: isDefaultFlowFormula(candidate, effectiveStandard) ? undefined : candidate,
      });
    } else {
      const seedExpr =
        parameters.flowFormula?.mode === 'expression' && parameters.flowFormula.expression
          ? parameters.flowFormula.expression
          : `${effectiveFormula.coefficient} * LU^${effectiveFormula.exponent}`;
      setExprDraft(seedExpr);
      const check = validateFlowExpression(seedExpr);
      if (check.valid) {
        onUpdateParameters({
          flowFormula: {
            mode: 'expression',
            coefficient: effectiveFormula.coefficient,
            exponent: effectiveFormula.exponent,
            expression: seedExpr.trim(),
          },
        });
      }
    }
  };

  const handleExpressionChange = (nextExpr: string) => {
    setExprDraft(nextExpr);
    const check = validateFlowExpression(nextExpr);
    if (!check.valid) {
      setExprError(check.error ?? 'Invalid expression');
      return;
    }
    setExprError(null);
    onUpdateParameters({
      flowFormula: {
        mode: 'expression',
        coefficient: effectiveFormula.coefficient,
        exponent: effectiveFormula.exponent,
        expression: nextExpr.trim(),
      },
    });
  };

  const handleResetFormula = () => {
    setFormulaMode('power');
    setCoeffDraft(String(stdDefaultFormula.coefficient));
    setExpDraft(String(stdDefaultFormula.exponent));
    setExprDraft(stdDefaultFormula.expression);
    setCoeffError(null);
    setExpError(null);
    setExprError(null);
    onUpdateParameters({ flowFormula: undefined });
  };

  const commitCavitationLimit = (raw: string) => {
    setCavDraft(raw);
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed) || parsed < 1.0 || parsed > 20.0) {
      setCavError('Enter ratio between 1.0 and 20.0');
      return;
    }
    setCavError(null);
    const rounded = Math.round(parsed * 100) / 100;
    onUpdateParameters({
      cavitationRatioLimit: isDefaultCavitationRatioLimit(rounded) ? undefined : rounded,
    });
  };

  const handleResetCavitation = () => {
    setCavDraft(formatCavitationRatio(DEFAULT_CAVITATION_RATIO_LIMIT));
    setCavError(null);
    onUpdateParameters({ cavitationRatioLimit: undefined });
  };

  const activeCavAlertCount = calcResult.prvList.filter((p) => p.cavitationWarning).length;
  const sample100 = calculateFlowRateFromLu(100, parameters.flowFormula, effectiveStandard);
  const sample260 = calculateFlowRateFromLu(260, parameters.flowFormula, effectiveStandard);
  const sample1000 = calculateFlowRateFromLu(1000, parameters.flowFormula, effectiveStandard);

  return (
    <footer className="relative bg-[#121212] text-[#a3a3a3] px-4 lg:px-5 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[10px] tabular-nums shrink-0 border-t border-[#262626]">
      <div className="flex items-center text-[#d4d4d4]">
        <button
          type="button"
          data-testid="footer-disclaimer-btn"
          onClick={onOpenDisclaimer}
          title="View Engineering Notice & Disclaimer"
          className="group inline-flex items-center gap-1 px-1.5 py-0.5 -ml-1.5 -my-0.5 text-[#d4d4d4] hover:bg-white/10 hover:text-white transition-colors cursor-pointer focus-visible:outline-1 focus-visible:outline-white"
        >
          <Info
            className="w-2.5 h-2.5 shrink-0 opacity-75 group-hover:opacity-100"
            aria-hidden="true"
          />
          <span className="underline decoration-dotted underline-offset-4 decoration-[#737373] group-hover:decoration-white/80">
            Disclaimer &amp; Terms
          </span>
        </button>
      </div>

      <div ref={containerRef} className="relative flex flex-wrap items-center gap-y-1">
        <span className="text-[#a3a3a3]">P_static = H × 0.0981 bar</span>
        <span className="mx-2 text-[#525252]" aria-hidden="true">
          |
        </span>

        {/* Click-to-edit Flow Conversion Formula */}
        <button
          type="button"
          data-testid="footer-flow-formula-btn"
          aria-expanded={activeEditor === 'formula'}
          aria-haspopup="dialog"
          title="Click to edit LU → Flow (Q) conversion formula"
          onClick={() =>
            setActiveEditor((prev) => (prev === 'formula' ? null : 'formula'))
          }
          className={`group inline-flex items-center gap-1 px-1.5 py-0.5 -my-0.5 transition-colors cursor-pointer focus-visible:outline-1 focus-visible:outline-white ${
            activeEditor === 'formula'
              ? 'bg-white text-[#121212] font-semibold'
              : isCustomFormula
              ? 'text-[#93c5fd] hover:bg-white/10 hover:text-white'
              : 'text-[#d4d4d4] hover:bg-white/10 hover:text-white'
          }`}
        >
          <span
            className={`underline decoration-dotted underline-offset-4 ${
              activeEditor === 'formula'
                ? 'decoration-[#121212]/40'
                : isCustomFormula
                ? 'decoration-[#60a5fa]/70'
                : 'decoration-[#737373] group-hover:decoration-white/80'
            }`}
          >
            {formatFlowFormulaDisplay(parameters.flowFormula, effectiveStandard)}
          </span>
          {isCustomFormula && activeEditor !== 'formula' && (
            <span className="text-[9px] uppercase tracking-wider text-[#60a5fa] font-semibold">
              *
            </span>
          )}
          <Pencil
            className={`w-2.5 h-2.5 shrink-0 transition-opacity ${
              activeEditor === 'formula'
                ? 'opacity-100 text-[#121212]'
                : 'opacity-55 group-hover:opacity-100'
            }`}
            aria-hidden="true"
          />
        </button>

        <span className="mx-2 text-[#525252]" aria-hidden="true">
          |
        </span>

        {/* Click-to-edit Cavitation Check Ratio */}
        <button
          type="button"
          data-testid="footer-cavitation-limit-btn"
          aria-expanded={activeEditor === 'cavitation'}
          aria-haspopup="dialog"
          title="Click to edit maximum allowable PRV cavitation ratio (P1/P2)"
          onClick={() =>
            setActiveEditor((prev) => (prev === 'cavitation' ? null : 'cavitation'))
          }
          className={`group inline-flex items-center gap-1 px-1.5 py-0.5 -my-0.5 transition-colors cursor-pointer focus-visible:outline-1 focus-visible:outline-white ${
            activeEditor === 'cavitation'
              ? 'bg-white text-[#121212] font-semibold'
              : isCustomCavLimit
              ? 'text-[#93c5fd] hover:bg-white/10 hover:text-white'
              : 'text-[#d4d4d4] hover:bg-white/10 hover:text-white'
          }`}
        >
          <span
            className={`underline decoration-dotted underline-offset-4 ${
              activeEditor === 'cavitation'
                ? 'decoration-[#121212]/40'
                : isCustomCavLimit
                ? 'decoration-[#60a5fa]/70'
                : 'decoration-[#737373] group-hover:decoration-white/80'
            }`}
          >
            Cavitation Check: P1/P2 ≤ {formatCavitationRatio(effectiveCavLimit)}
          </span>
          {isCustomCavLimit && activeEditor !== 'cavitation' && (
            <span className="text-[9px] uppercase tracking-wider text-[#60a5fa] font-semibold">
              *
            </span>
          )}
          <Pencil
            className={`w-2.5 h-2.5 shrink-0 transition-opacity ${
              activeEditor === 'cavitation'
                ? 'opacity-100 text-[#121212]'
                : 'opacity-55 group-hover:opacity-100'
            }`}
            aria-hidden="true"
          />
        </button>

        {/* Flow Conversion Formula Popover */}
        {activeEditor === 'formula' && (
          <div
            role="dialog"
            aria-label="Edit Flow Conversion Formula"
            data-testid="flow-formula-popover"
            className="absolute bottom-full right-0 mb-2 w-[350px] sm:w-[390px] max-w-[calc(100vw-2rem)] bg-white text-[#121212] border-2 border-[#121212] shadow-xl z-50 font-sans"
          >
            <div className="px-3 py-2 bg-[#eeeeee] border-b border-[#e0e0e0] flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212]">
                  LU → Flow Conversion Formula (Q)
                </span>
                <span className="px-1 py-0.5 bg-[#121212] text-white font-mono text-[9px] font-semibold">
                  {standardLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveEditor(null)}
                aria-label="Close formula editor"
                className="w-6 h-6 inline-flex items-center justify-center bg-white border border-[#cccccc] hover:border-[#121212] text-[#555555] hover:text-[#121212] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-3 space-y-3 text-xs">
              {/* Mode Toggle */}
              <div className="grid grid-cols-2 border border-[#e0e0e0] bg-[#f8f8f8]">
                <button
                  type="button"
                  data-testid="formula-mode-power-btn"
                  onClick={() => handleModeSwitch('power')}
                  className={`py-1.5 px-2 font-display text-[10px] font-bold uppercase transition-colors border-r border-[#e0e0e0] ${
                    formulaMode === 'power'
                      ? 'bg-[#121212] text-white'
                      : 'bg-white text-[#555555] hover:text-[#121212]'
                  }`}
                >
                  Parameters (a × LU^b)
                </button>
                <button
                  type="button"
                  data-testid="formula-mode-expression-btn"
                  onClick={() => handleModeSwitch('expression')}
                  className={`py-1.5 px-2 font-display text-[10px] font-bold uppercase transition-colors ${
                    formulaMode === 'expression'
                      ? 'bg-[#121212] text-white'
                      : 'bg-white text-[#555555] hover:text-[#121212]'
                  }`}
                >
                  Custom Expression
                </button>
              </div>

              {formulaMode === 'power' ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="flow-coeff-input"
                        className="block font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] mb-1"
                      >
                        Coefficient (a)
                      </label>
                      <input
                        id="flow-coeff-input"
                        data-testid="flow-coeff-input"
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        max="100"
                        value={coeffDraft}
                        onChange={(e) => {
                          setCoeffDraft(e.target.value);
                          commitPowerParams(e.target.value, expDraft);
                        }}
                        className={`w-full h-8 px-2 font-mono text-xs tabular-nums bg-white border focus:outline-none ${
                          coeffError
                            ? 'border-[#d90000] text-[#d90000]'
                            : 'border-[#cccccc] focus:border-[#121212] text-[#121212]'
                        }`}
                      />
                      {coeffError && (
                        <div className="text-[10px] text-[#d90000] font-mono mt-0.5">
                          {coeffError}
                        </div>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="flow-exp-input"
                        className="block font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] mb-1"
                      >
                        Exponent (b)
                      </label>
                      <input
                        id="flow-exp-input"
                        data-testid="flow-exp-input"
                        type="number"
                        step="0.0001"
                        min="0.01"
                        max="5"
                        value={expDraft}
                        onChange={(e) => {
                          setExpDraft(e.target.value);
                          commitPowerParams(coeffDraft, e.target.value);
                        }}
                        className={`w-full h-8 px-2 font-mono text-xs tabular-nums bg-white border focus:outline-none ${
                          expError
                            ? 'border-[#d90000] text-[#d90000]'
                            : 'border-[#cccccc] focus:border-[#121212] text-[#121212]'
                        }`}
                      />
                      {expError && (
                        <div className="text-[10px] text-[#d90000] font-mono mt-0.5">
                          {expError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label
                    htmlFor="flow-expr-input"
                    className="block font-display text-[10px] font-bold uppercase tracking-wider text-[#555555]"
                  >
                    Expression for Q (L/s) in terms of LU
                  </label>
                  <input
                    id="flow-expr-input"
                    data-testid="flow-expr-input"
                    type="text"
                    value={exprDraft}
                    onChange={(e) => handleExpressionChange(e.target.value)}
                    placeholder={stdDefaultFormula.expression}
                    className={`w-full h-8 px-2 font-mono text-xs bg-white border focus:outline-none ${
                      exprError
                        ? 'border-[#d90000] text-[#d90000]'
                        : 'border-[#cccccc] focus:border-[#121212] text-[#121212]'
                    }`}
                  />
                  {exprError ? (
                    <div className="text-[10px] text-[#d90000] font-mono">
                      {exprError}
                    </div>
                  ) : (
                    <div className="text-[10px] text-[#666666] font-mono">
                      Supports: LU, +, -, *, /, ^, (), sqrt(), pow(), log(), ln()
                    </div>
                  )}
                </div>
              )}

              {/* Live Active Formula & Test Point Preview */}
              <div className="bg-[#f8f8f8] border border-[#e0e0e0] px-2.5 py-2 space-y-1 font-mono text-[10px]">
                <div className="flex items-center justify-between gap-2 text-[#121212] font-semibold">
                  <span>
                    Active: {formatFlowFormulaDisplay(parameters.flowFormula, effectiveStandard)}
                  </span>
                </div>
                <div className="text-[#555555] tabular-nums">
                  100 LU → {sample100.toFixed(2)} L/s · 260 LU → {sample260.toFixed(2)} L/s · 1000 LU →{' '}
                  {sample1000.toFixed(2)} L/s
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#e0e0e0]">
                <button
                  type="button"
                  data-testid="flow-formula-reset-btn"
                  disabled={!isCustomFormula}
                  onClick={handleResetFormula}
                  className="h-7 px-2.5 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] disabled:opacity-40 disabled:cursor-not-allowed font-display text-[10px] font-bold uppercase inline-flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset ({standardLabel})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveEditor(null)}
                  className="h-7 px-3 bg-[#121212] hover:bg-[#2a2a2a] text-white font-display text-[10px] font-bold uppercase transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cavitation Check Ratio Popover */}
        {activeEditor === 'cavitation' && (
          <div
            role="dialog"
            aria-label="Edit Cavitation Check Ratio Limit"
            data-testid="cavitation-limit-popover"
            className="absolute bottom-full right-0 mb-2 w-[310px] max-w-[calc(100vw-2rem)] bg-white text-[#121212] border-2 border-[#121212] shadow-xl z-50 font-sans"
          >
            <div className="px-3 py-2 bg-[#eeeeee] border-b border-[#e0e0e0] flex items-center justify-between gap-2">
              <div className="font-display text-[10px] font-bold uppercase tracking-wider text-[#121212]">
                Cavitation Check Limit (P1 / P2)
              </div>
              <button
                type="button"
                onClick={() => setActiveEditor(null)}
                aria-label="Close cavitation threshold editor"
                className="w-6 h-6 inline-flex items-center justify-center bg-white border border-[#cccccc] hover:border-[#121212] text-[#555555] hover:text-[#121212] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-3 space-y-3 text-xs">
              <div>
                <label
                  htmlFor="cavitation-limit-input"
                  className="block font-display text-[10px] font-bold uppercase tracking-wider text-[#555555] mb-1"
                >
                  Maximum Allowable Ratio (P1 / P2 ≤)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="cavitation-limit-input"
                    data-testid="cavitation-limit-input"
                    type="number"
                    step="0.1"
                    min="1.0"
                    max="20.0"
                    value={cavDraft}
                    onChange={(e) => commitCavitationLimit(e.target.value)}
                    className={`flex-1 h-8 px-2 font-mono text-xs tabular-nums bg-white border focus:outline-none ${
                      cavError
                        ? 'border-[#d90000] text-[#d90000]'
                        : 'border-[#cccccc] focus:border-[#121212] text-[#121212]'
                    }`}
                  />
                  <span className="font-mono text-xs text-[#555555] px-1">ratio</span>
                </div>
                {cavError && (
                  <div className="text-[10px] text-[#d90000] font-mono mt-0.5">
                    {cavError}
                  </div>
                )}
              </div>

              {/* Quick Ratio Presets */}
              <div className="space-y-1">
                <div className="font-display text-[9px] font-bold uppercase tracking-wider text-[#666666]">
                  Quick Thresholds
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {[2.0, 2.5, 3.0, 3.5, 4.0].map((presetVal) => {
                    const isCurrent = Math.abs(effectiveCavLimit - presetVal) < 1e-4;
                    return (
                      <button
                        key={presetVal}
                        type="button"
                        onClick={() => commitCavitationLimit(presetVal.toFixed(1))}
                        className={`h-7 font-mono text-[11px] border transition-colors ${
                          isCurrent
                            ? 'bg-[#121212] text-white border-[#121212] font-semibold'
                            : 'bg-white text-[#121212] border-[#e0e0e0] hover:border-[#121212]'
                        }`}
                      >
                        {presetVal.toFixed(1)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Status Note */}
              <div className="bg-[#f8f8f8] border border-[#e0e0e0] px-2.5 py-2 font-mono text-[10px] text-[#555555]">
                <div>
                  PRVs with P1/P2 &gt;{' '}
                  <strong className="text-[#121212]">
                    {formatCavitationRatio(effectiveCavLimit)}
                  </strong>{' '}
                  trigger Cav! &amp; Engineering Alerts.
                </div>
                <div className="mt-0.5">
                  Active PRV Cavitation Alerts:{' '}
                  <strong
                    className={
                      activeCavAlertCount > 0 ? 'text-[#d90000]' : 'text-[#15803d]'
                    }
                  >
                    {activeCavAlertCount}
                  </strong>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#e0e0e0]">
                <button
                  type="button"
                  data-testid="cavitation-limit-reset-btn"
                  disabled={!isCustomCavLimit}
                  onClick={handleResetCavitation}
                  className="h-7 px-2.5 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] disabled:opacity-40 disabled:cursor-not-allowed font-display text-[10px] font-bold uppercase inline-flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset (3.0)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveEditor(null)}
                  className="h-7 px-3 bg-[#121212] hover:bg-[#2a2a2a] text-white font-display text-[10px] font-bold uppercase transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </footer>
  );
};

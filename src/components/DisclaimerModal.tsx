import React, { useEffect } from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import {
  DISCLAIMER_INTRO,
  DISCLAIMER_SECTIONS,
  DISCLAIMER_TITLE,
} from '../data/disclaimer';

interface DisclaimerModalProps {
  isOpen: boolean;
  isFirstUseNotice: boolean;
  onAcknowledgeAndClose: () => void;
}

export const DisclaimerModal: React.FC<DisclaimerModalProps> = ({
  isOpen,
  isFirstUseNotice,
  onAcknowledgeAndClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onAcknowledgeAndClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onAcknowledgeAndClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#121212]/65 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-modal-title"
      data-testid="disclaimer-modal"
      onClick={onAcknowledgeAndClose}
    >
      <div
        className="w-full max-w-[680px] max-h-[90vh] flex flex-col bg-white border-2 border-[#121212] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-[#eeeeee] border-b-2 border-[#121212] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 bg-[#121212] text-white inline-flex items-center justify-center shrink-0">
              {isFirstUseNotice ? (
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Info className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="disclaimer-modal-title"
                className="font-display text-xs font-bold uppercase tracking-wider text-[#121212] truncate"
              >
                HydroDrop Calc · {DISCLAIMER_TITLE}
              </h2>
              <p className="font-mono text-[10px] text-[#555555] mt-0.5 truncate">
                Free Public Web Edition · Developed by J.H.WONG
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onAcknowledgeAndClose}
            aria-label="Close disclaimer"
            className="h-7 w-7 inline-flex items-center justify-center bg-white border border-[#cccccc] text-[#555555] hover:text-[#121212] hover:border-[#121212] transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-white">
          <div className="bg-[#f8f8f8] border border-[#e0e0e0] px-3.5 py-2.5 text-xs text-[#333333] leading-relaxed">
            {DISCLAIMER_INTRO}
          </div>

          <div className="space-y-3">
            {DISCLAIMER_SECTIONS.map((section) => (
              <section
                key={section.id}
                className="border border-[#e0e0e0] border-l-[3px] border-l-[#121212] bg-white px-3.5 py-3"
              >
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-[10px] font-semibold text-[#666666] tabular-nums shrink-0">
                    {section.number}
                  </span>
                  <h3 className="font-display text-[11px] font-bold uppercase tracking-wide text-[#121212]">
                    {section.title}
                  </h3>
                </div>
                <p className="text-xs text-[#404040] leading-relaxed">
                  {section.body}
                </p>
              </section>
            ))}
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="px-4 py-3 bg-[#f8f8f8] border-t border-[#e0e0e0] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="font-mono text-[10px] text-[#666666]">
            Provided &ldquo;as-is&rdquo; for preliminary reference only · Always verify outputs independently.
          </div>
          <button
            type="button"
            data-testid="disclaimer-acknowledge-btn"
            onClick={onAcknowledgeAndClose}
            className="h-8 px-4 bg-[#121212] hover:bg-[#2a2a2a] text-white font-display text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#121212]"
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isFirstUseNotice ? 'I Understand & Continue' : 'Close'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

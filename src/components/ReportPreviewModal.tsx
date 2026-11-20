import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Loader2,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { SystemCalculationResult } from '../types/hydraulics';
import { DISCLAIMER_SUMMARY_LINE } from '../data/disclaimer';
import {
  buildCalculationPdfDocument,
  exportCalculationToExcel,
  exportCalculationToPdf,
} from '../utils/exportReport';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ReportPreviewModalProps {
  isOpen: boolean;
  result: SystemCalculationResult;
  onClose: () => void;
  onOpenDisclaimer?: () => void;
}

interface PageMeta {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  isLandscape: boolean;
}

type ZoomPreset = 0.5 | 0.75 | 1 | 1.25 | 1.5;
type ZoomMode = 'fit' | ZoomPreset;

const CSS_PX_PER_PT = 96 / 72;
const ZOOM_STEPS: ZoomPreset[] = [0.5, 0.75, 1, 1.25, 1.5];

interface PdfA4PageSheetProps {
  pdfDoc: PDFDocumentProxy;
  meta: PageMeta;
  totalPages: number;
  cssScale: number;
  registerPageRef: (pageNumber: number, el: HTMLDivElement | null) => void;
}

const PdfA4PageSheet: React.FC<PdfA4PageSheetProps> = ({
  pdfDoc,
  meta,
  totalPages,
  cssScale,
  registerPageRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRendering, setIsRendering] = useState(true);

  const cssWidth = Math.max(240, Math.round(meta.widthPt * CSS_PX_PER_PT * cssScale));
  const cssHeight = Math.max(200, Math.round(meta.heightPt * CSS_PX_PER_PT * cssScale));

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const renderPage = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setIsRendering(true);

      try {
        const page = await pdfDoc.getPage(meta.pageNumber);
        if (cancelled) return;

        const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
        const renderViewport = page.getViewport({
          scale: CSS_PX_PER_PT * cssScale * dpr,
        });

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx || cancelled) return;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({
          canvasContext: ctx,
          canvas,
          viewport: renderViewport,
        });

        await renderTask.promise;
        if (!cancelled) {
          setIsRendering(false);
        }
      } catch (err) {
        if (
          cancelled ||
          (err instanceof Error && err.name === 'RenderingCancelledException')
        ) {
          return;
        }
        setIsRendering(false);
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, meta.pageNumber, cssScale]);

  return (
    <div
      ref={(el) => registerPageRef(meta.pageNumber, el)}
      data-testid={`report-preview-page-${meta.pageNumber}`}
      data-page-number={meta.pageNumber}
      className="flex flex-col items-center shrink-0"
    >
      <div
        className="flex items-center justify-between text-[10px] font-mono text-[#52525b] mb-1.5 px-0.5 select-none"
        style={{ width: `${cssWidth}px` }}
      >
        <span className="font-semibold text-[#27272a]">
          Page {meta.pageNumber} of {totalPages}
        </span>
        <span>
          A4 {meta.isLandscape ? 'Landscape (297 × 210 mm)' : 'Portrait (210 × 297 mm)'}
        </span>
      </div>

      <div
        className="relative bg-white border border-[#bdbdbd] shadow-[0_6px_22px_rgba(18,18,18,0.18)] overflow-hidden"
        style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
      >
        <canvas
          ref={canvasRef}
          aria-label={`Page ${meta.pageNumber} of ${totalPages} (${
            meta.isLandscape ? 'A4 Landscape' : 'A4 Portrait'
          })`}
          className="block w-full h-full"
        />
        {isRendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 pointer-events-none">
            <Loader2 className="w-5 h-5 animate-spin text-[#555555]" />
          </div>
        )}
      </div>
    </div>
  );
};

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
  isOpen,
  result,
  onClose,
  onOpenDisclaimer,
}) => {
  const { parameters, pipeSpec, optionalPipeSpec } = result;
  const specSummaryLabel = optionalPipeSpec
    ? `${pipeSpec.fullName} (Opt: ${optionalPipeSpec.fullName})`
    : pipeSpec.fullName;

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageMetas, setPageMetas] = useState<PageMeta[]>([]);
  const [isBuildingPdf, setIsBuildingPdf] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');
  const [containerWidth, setContainerWidth] = useState<number>(1024);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const registerPageRef = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    pageRefs.current[pageNumber] = el;
  }, []);

  // Track available viewport width for 'Fit Width' A4 scaling
  useEffect(() => {
    if (!isOpen) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setContainerWidth(el.clientWidth);
      }
    };
    updateWidth();

    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  // Build exact jsPDF document and load via pdfjs-dist when modal opens or calculation changes
  useEffect(() => {
    if (!isOpen) {
      setPdfDoc(null);
      setPageMetas([]);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    const buildAndLoadPdf = async () => {
      setIsBuildingPdf(true);
      setPreviewError(null);
      setCurrentPage(1);

      try {
        const doc = buildCalculationPdfDocument(result);
        const arrayBuffer = doc.output('arraybuffer');
        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
        });
        const nextDoc = await loadingTask.promise;

        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }

        const metas: PageMeta[] = [];
        for (let p = 1; p <= nextDoc.numPages; p++) {
          const page = await nextDoc.getPage(p);
          if (cancelled) return;
          const vp = page.getViewport({ scale: 1 });
          metas.push({
            pageNumber: p,
            widthPt: vp.width,
            heightPt: vp.height,
            isLandscape: vp.width > vp.height,
          });
        }

        if (cancelled) return;
        setPdfDoc(nextDoc);
        setPageMetas(metas);
        setIsBuildingPdf(false);
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      } catch (err) {
        if (cancelled) return;
        setPreviewError(
          err instanceof Error ? err.message : 'Unable to render A4 PDF print preview.'
        );
        setIsBuildingPdf(false);
      }
    };

    buildAndLoadPdf();

    return () => {
      cancelled = true;
      setPdfDoc(null);
      if (loadingTask) {
        loadingTask.destroy().catch(() => {});
      }
    };
  }, [isOpen, result]);

  const maxPageWidthPt = useMemo(() => {
    if (pageMetas.length === 0) return 841.89;
    return pageMetas.reduce((max, m) => Math.max(max, m.widthPt), 0);
  }, [pageMetas]);

  const fitScale = useMemo(() => {
    const horizontalPadding = containerWidth < 640 ? 32 : 64;
    const availW = Math.max(280, containerWidth - horizontalPadding);
    const raw = availW / (maxPageWidthPt * CSS_PX_PER_PT);
    return Math.min(1.15, Math.max(0.32, raw));
  }, [containerWidth, maxPageWidthPt]);

  const effectiveCssScale = zoomMode === 'fit' ? fitScale : zoomMode;
  const totalPages = pageMetas.length;

  const goToPage = useCallback(
    (targetPage: number) => {
      if (totalPages === 0) return;
      const clamped = Math.max(1, Math.min(totalPages, targetPage));
      setCurrentPage(clamped);
      const targetEl = pageRefs.current[clamped];
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [totalPages]
  );

  // Update active page indicator cleanly during smooth scrolling
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || pageMetas.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const probeY = containerRect.top + containerRect.height * 0.28;

    let bestPage = 1;
    let bestDist = Infinity;

    for (const meta of pageMetas) {
      const el = pageRefs.current[meta.pageNumber];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top <= probeY && rect.bottom >= probeY) {
        bestPage = meta.pageNumber;
        break;
      }
      const center = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(center - probeY);
      if (dist < bestDist) {
        bestDist = dist;
        bestPage = meta.pageNumber;
      }
    }

    setCurrentPage((prev) => (prev === bestPage ? prev : bestPage));
  }, [pageMetas]);

  // Keyboard shortcuts (Escape to close, PageUp/PageDown to step pages)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        goToPage(currentPage + 1);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        goToPage(currentPage - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, goToPage, currentPage]);

  const handleStepZoom = (direction: -1 | 1) => {
    const current = effectiveCssScale;
    if (direction === 1) {
      const next = ZOOM_STEPS.find((z) => z > current + 0.04);
      setZoomMode(next ?? 1.5);
    } else {
      const reversed = [...ZOOM_STEPS].reverse();
      const prev = reversed.find((z) => z < current - 0.04);
      setZoomMode(prev ?? 0.5);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#121212]/60 p-2 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-preview-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1340px] h-[94vh] flex flex-col bg-white border-2 border-[#121212] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Print Preview Modal Toolbar */}
        <div className="px-4 py-2.5 bg-[#eeeeee] border-b border-[#d4d4d4] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2
                id="report-preview-title"
                className="font-display text-xs font-bold uppercase tracking-wider text-[#121212] truncate"
              >
                Engineering Report Preview · A4 Print Layout
              </h2>
              {totalPages > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-white border border-[#cccccc] text-[#121212] whitespace-nowrap">
                  {totalPages} {totalPages === 1 ? 'Page' : 'Pages'}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[#555555] mt-0.5 flex flex-wrap items-center gap-2">
              <span className="truncate max-w-[280px]">{parameters.projectName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">Job No. {parameters.projectRef}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate max-w-[280px]">{specSummaryLabel}</span>
            </div>
          </div>

          {/* Page Navigation & Zoom Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {totalPages > 0 && (
              <div
                className="inline-flex items-center bg-white border border-[#d4d4d4] h-8"
                aria-label="Page navigation"
              >
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                  className="h-full w-7 inline-flex items-center justify-center text-[#121212] hover:bg-[#f4f4f5] disabled:opacity-35 disabled:pointer-events-none border-r border-[#e0e0e0]"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div className="px-2 inline-flex items-center gap-1 text-[11px] font-mono text-[#121212]">
                  <span className="text-[#666666] text-[10px] uppercase">Page</span>
                  <select
                    aria-label="Jump to page"
                    value={currentPage}
                    onChange={(e) => goToPage(Number(e.target.value))}
                    className="h-6 px-1 text-[11px] font-mono font-semibold bg-transparent text-[#121212] focus:outline-none cursor-pointer"
                  >
                    {pageMetas.map((m) => (
                      <option key={m.pageNumber} value={m.pageNumber}>
                        {m.pageNumber}
                      </option>
                    ))}
                  </select>
                  <span className="text-[#666666]">of {totalPages}</span>
                </div>
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  aria-label="Next page"
                  className="h-full w-7 inline-flex items-center justify-center text-[#121212] hover:bg-[#f4f4f5] disabled:opacity-35 disabled:pointer-events-none border-l border-[#e0e0e0]"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div
              className="inline-flex items-center bg-white border border-[#d4d4d4] h-8"
              aria-label="Zoom controls"
            >
              <button
                type="button"
                onClick={() => handleStepZoom(-1)}
                disabled={effectiveCssScale <= 0.51 && zoomMode !== 'fit'}
                aria-label="Zoom out"
                className="h-full w-7 inline-flex items-center justify-center text-[#121212] hover:bg-[#f4f4f5] disabled:opacity-35 disabled:pointer-events-none border-r border-[#e0e0e0]"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <select
                aria-label="Zoom level"
                value={zoomMode === 'fit' ? 'fit' : String(zoomMode)}
                onChange={(e) => {
                  const val = e.target.value;
                  setZoomMode(val === 'fit' ? 'fit' : (Number(val) as ZoomMode));
                }}
                className="h-full px-2 text-[11px] font-mono font-semibold bg-transparent text-[#121212] focus:outline-none cursor-pointer"
              >
                <option value="fit">Fit Width ({Math.round(fitScale * 100)}%)</option>
                <option value="0.5">50%</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
              </select>
              <button
                type="button"
                onClick={() => handleStepZoom(1)}
                disabled={effectiveCssScale >= 1.49 && zoomMode !== 'fit'}
                aria-label="Zoom in"
                className="h-full w-7 inline-flex items-center justify-center text-[#121212] hover:bg-[#f4f4f5] disabled:opacity-35 disabled:pointer-events-none border-l border-[#e0e0e0]"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              {zoomMode !== 'fit' && (
                <button
                  type="button"
                  onClick={() => setZoomMode('fit')}
                  title="Fit A4 Page Width"
                  aria-label="Fit page width"
                  className="h-full px-2 inline-flex items-center gap-1 text-[10px] font-display font-bold uppercase text-[#121212] hover:bg-[#f4f4f5] border-l border-[#e0e0e0]"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span className="hidden md:inline">Fit</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 ml-1">
              <button
                type="button"
                onClick={() => exportCalculationToExcel(result)}
                className="h-8 px-3 font-display text-[10px] font-bold uppercase text-[#121212] bg-white border border-[#121212] hover:bg-[#121212] hover:text-white transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export Excel</span>
              </button>
              <button
                type="button"
                onClick={() => exportCalculationToPdf(result)}
                className="h-8 px-3 font-display text-[10px] font-bold uppercase text-white bg-[#121212] hover:bg-[#2a2a2a] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Export PDF</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close report preview"
                className="h-8 w-8 inline-flex items-center justify-center bg-white border border-[#cccccc] text-[#555555] hover:text-[#121212] hover:border-[#121212] transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Paginated A4 Print Workspace */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          data-testid="report-preview-print-workspace"
          className="flex-1 overflow-auto bg-[#d4d4d8] px-3 py-5 sm:px-8 sm:py-7"
        >
          {isBuildingPdf && !pdfDoc ? (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-3 text-[#3f3f46]">
              <Loader2 className="w-6 h-6 animate-spin text-[#121212]" />
              <div className="font-mono text-xs">Generating 1:1 A4 PDF Print Preview...</div>
            </div>
          ) : previewError ? (
            <div className="max-w-lg mx-auto mt-12 bg-white border border-[#fca5a5] p-5 text-xs font-mono text-[#991b1b]">
              <div className="font-display font-bold uppercase text-[#d90000] mb-1">
                Print Preview Error
              </div>
              <div>{previewError}</div>
            </div>
          ) : (
            pdfDoc && (
              <div className="flex flex-col items-center gap-7 min-w-fit mx-auto pb-4">
                {pageMetas.map((meta) => (
                  <PdfA4PageSheet
                    key={`a4-sheet-${meta.pageNumber}`}
                    pdfDoc={pdfDoc}
                    meta={meta}
                    totalPages={totalPages}
                    cssScale={effectiveCssScale}
                    registerPageRef={registerPageRef}
                  />
                ))}
              </div>
            )
          )}
        </div>

        {/* Report Disclaimer Notice Bar */}
        <div className="px-4 py-1.5 bg-[#f8f8f8] border-t border-[#d4d4d4] flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[#555555] shrink-0">
          <span>
            <strong className="text-[#121212] uppercase">Disclaimer:</strong>{' '}
            {DISCLAIMER_SUMMARY_LINE}
          </span>
          {onOpenDisclaimer && (
            <button
              type="button"
              onClick={onOpenDisclaimer}
              className="text-[#121212] font-semibold underline decoration-dotted underline-offset-4 hover:text-[#2a2a2a] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Read Full Disclaimer
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

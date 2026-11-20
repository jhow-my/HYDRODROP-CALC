import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatPipeDim, PIPE_SPEC_TABLES } from '../data/pipeSpecs';
import {
  DesignStandard,
  FlowConversionFormula,
  PipeSpecId,
  PipeSpecificationTable,
} from '../types/hydraulics';
import { formatFlowFormulaDisplay, isPipeSizeIncluded } from '../utils/calculations';
import { getMaxFlowAndLuForDiameter } from '../utils/exportReport';

interface PipeSpecTablesProps {
  isOpen: boolean;
  activeSpecId: PipeSpecId;
  optionalSpecId?: PipeSpecId | null;
  maxVelocityMs: number;
  standard?: DesignStandard;
  flowFormula?: FlowConversionFormula;
  excludedPipeSizes?: Partial<Record<PipeSpecId, number[]>>;
  onTogglePipeSize: (specIds: PipeSpecId[], nominalSize: number) => void;
  onSetPipeSizesIncluded: (
    specIds: PipeSpecId[],
    nominalSizes: number[],
    include: boolean
  ) => void;
  onClose: () => void;
}

type MaterialTabId = PipeSpecificationTable['materialFamily'];

const MATERIAL_GROUPS: {
  id: MaterialTabId;
  tabLabel: string;
  heading: string;
  specA: PipeSpecId;
  specB?: PipeSpecId;
}[] = [
  {
    id: 'PP-R',
    tabLabel: 'PP-R',
    heading: 'Specification of PP-R Pipe (PN16 S3.2 / PN20 S2.5)',
    specA: PipeSpecId.PPR_PN16,
    specB: PipeSpecId.PPR_PN20,
  },
  {
    id: 'uPVC',
    tabLabel: 'uPVC',
    heading: 'Specification of uPVC Pipe (Class E / Class 7)',
    specA: PipeSpecId.UPVC_CLASS_E,
    specB: PipeSpecId.UPVC_CLASS_7,
  },
  {
    id: 'HDPE PE100',
    tabLabel: 'HDPE PE100',
    heading: 'Specification of HDPE PE100 Pipe (PN12.5 / PN16)',
    specA: PipeSpecId.HDPE_PN12_5,
    specB: PipeSpecId.HDPE_PN16,
  },
  {
    id: 'MSCL',
    tabLabel: 'MSCL',
    heading: 'Specification of Mild Steel Cement Lined (MSCL) Pipe',
    specA: PipeSpecId.MSCL,
  },
  {
    id: 'Stainless Steel',
    tabLabel: 'Stainless Steel',
    heading: 'Specification of Stainless Steel Pipe (ASME B36.19 - 10S / 40S)',
    specA: PipeSpecId.SS_10S,
    specB: PipeSpecId.SS_40S,
  },
];

export const PipeSpecTables: React.FC<PipeSpecTablesProps> = ({
  isOpen,
  activeSpecId,
  optionalSpecId = null,
  maxVelocityMs,
  standard,
  flowFormula,
  excludedPipeSizes,
  onTogglePipeSize,
  onSetPipeSizesIncluded,
  onClose,
}) => {
  const activeFamily = PIPE_SPEC_TABLES[activeSpecId]?.materialFamily ?? 'PP-R';
  const optionalFamily = optionalSpecId ? PIPE_SPEC_TABLES[optionalSpecId]?.materialFamily : null;
  const [activeTab, setActiveTab] = useState<MaterialTabId>(activeFamily);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(PIPE_SPEC_TABLES[activeSpecId]?.materialFamily ?? 'PP-R');
    }
  }, [isOpen, activeSpecId]);

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

  const group =
    MATERIAL_GROUPS.find((g) => g.id === activeTab) ?? MATERIAL_GROUPS[0];
  const tableA = PIPE_SPEC_TABLES[group.specA];
  const tableB = group.specB ? PIPE_SPEC_TABLES[group.specB] : null;
  const groupSpecIds: PipeSpecId[] = group.specB
    ? [group.specA, group.specB]
    : [group.specA];
  const allNominalSizes = tableA.sizes.map((s) => s.nominalSize);
  const activeRowCount = allNominalSizes.filter((nominalSize) =>
    isPipeSizeIncluded(group.specA, nominalSize, excludedPipeSizes)
  ).length;
  const totalRowCount = allNominalSizes.length;
  const allIncluded = activeRowCount === totalRowCount;
  const partiallyIncluded = activeRowCount > 0 && activeRowCount < totalRowCount;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallyIncluded;
    }
  }, [partiallyIncluded, activeTab, isOpen]);

  if (!isOpen) return null;

  const isAActive = activeSpecId === group.specA;
  const isBActive = group.specB !== undefined && activeSpecId === group.specB;
  const activeSpec = PIPE_SPEC_TABLES[activeSpecId];
  const optionalSpec = optionalSpecId ? PIPE_SPEC_TABLES[optionalSpecId] : null;
  const showDecimalOd = group.id !== 'PP-R' && group.id !== 'HDPE PE100';

  const labelA = tableA.shortName ?? tableA.fullName;
  const labelB = tableB ? tableB.shortName ?? tableB.fullName : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#121212]/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pipe-specs-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1040px] max-h-[90vh] flex flex-col bg-white border-2 border-[#121212] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#eeeeee] border-b border-[#e0e0e0] flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2
              id="pipe-specs-modal-title"
              className="font-display text-xs font-bold uppercase tracking-wider text-[#121212]"
            >
              Pipe Specification Tables
            </h2>
            <p className="text-xs text-[#555555] mt-0.5">
              Include or exclude nominal pipe sizes for this project using the first column. Max capacity shown at{' '}
              <span className="font-mono tabular-nums text-[#121212]">
                V ≤ {maxVelocityMs.toFixed(1)} m/s
              </span>
              {' · '}
              <span className="font-mono tabular-nums text-[#555555]">
                {formatFlowFormulaDisplay(flowFormula, standard)}
              </span>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pipe specification tables"
            className="h-8 w-8 inline-flex items-center justify-center bg-white border border-[#e0e0e0] text-[#555555] hover:text-[#121212] hover:border-[#121212] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Material Family Tab Bar */}
        <div className="px-4 py-2.5 bg-[#f8f8f8] border-b border-[#e0e0e0] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div
            role="tablist"
            aria-label="Pipe Material Standards"
            className="inline-flex flex-wrap items-center border border-[#e0e0e0] bg-white"
          >
            {MATERIAL_GROUPS.map((tab) => {
              const isSelected = activeTab === tab.id;
              const containsActiveSpec = activeFamily === tab.id;
              const containsOptionalSpec = optionalFamily === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3.5 py-1.5 font-display text-[10px] font-bold uppercase border-r last:border-r-0 border-[#e0e0e0] transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#121212] text-white'
                      : 'bg-white text-[#555555] hover:text-[#121212]'
                  }`}
                >
                  <span>{tab.tabLabel}</span>
                  {containsActiveSpec && (
                    <span className={isSelected ? 'text-[#cccccc]' : 'text-[#121212]'}>
                      (Pri)
                    </span>
                  )}
                  {containsOptionalSpec && (
                    <span className={isSelected ? 'text-[#93c5fd]' : 'text-[#1d4ed8]'}>
                      (Opt)
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="text-xs text-[#555555] font-mono tabular-nums flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>
              Primary: <strong className="text-[#121212]">{activeSpec.fullName}</strong>
            </span>
            <span>
              Optional:{' '}
              <strong className={optionalSpec ? 'text-[#1d4ed8]' : 'text-[#777777]'}>
                {optionalSpec ? optionalSpec.fullName : 'None'}
              </strong>
            </span>
          </div>
        </div>

        {/* Active Material Specification Table */}
        <div className="flex-1 overflow-y-auto p-4 bg-[#f8f8f8]">
          <div className="bg-white border border-[#e0e0e0] overflow-hidden">
            <div className="px-4 py-2.5 bg-[#eeeeee] border-b border-[#e0e0e0] flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-[11px] font-bold uppercase text-[#121212]">
                {group.heading}
              </h3>
              <div className="flex items-center gap-2.5 font-mono text-[11px] tabular-nums text-[#555555]">
                <span>
                  {activeRowCount} / {totalRowCount} sizes active
                </span>
                {activeRowCount < totalRowCount && (
                  <button
                    type="button"
                    onClick={() =>
                      onSetPipeSizesIncluded(groupSpecIds, allNominalSizes, true)
                    }
                    className="px-2 py-0.5 bg-white border border-[#cccccc] hover:border-[#121212] text-[#121212] font-display text-[10px] font-bold uppercase transition-colors"
                  >
                    Include All
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#f8f8f8] text-[#121212] border-b border-[#e0e0e0] font-display text-[10px] uppercase">
                    <th
                      rowSpan={2}
                      className="w-10 py-2 px-2 text-center font-bold border-r border-[#e0e0e0] align-middle"
                      title={
                        allIncluded
                          ? 'Uncheck all pipe sizes in this table'
                          : 'Include all pipe sizes in this table'
                      }
                    >
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allIncluded}
                        onChange={() =>
                          onSetPipeSizesIncluded(
                            groupSpecIds,
                            allNominalSizes,
                            !allIncluded
                          )
                        }
                        aria-label={`Toggle all ${group.tabLabel} nominal pipe sizes`}
                        className="w-3.5 h-3.5 accent-[#121212] cursor-pointer align-middle"
                      />
                    </th>
                    <th
                      rowSpan={2}
                      className="py-2 px-3 text-right font-bold border-r border-[#e0e0e0]"
                    >
                      Nominal (mm)
                    </th>
                    <th
                      rowSpan={2}
                      className="py-2 px-3 text-right font-bold border-r border-[#e0e0e0]"
                    >
                      Outer Dia (mm)
                    </th>
                    <th
                      colSpan={4}
                      className={`py-1.5 px-3 text-center font-bold ${
                        tableB ? 'border-r border-[#e0e0e0]' : ''
                      } ${isAActive ? 'bg-[#e5e5e5] text-[#121212]' : ''}`}
                    >
                      {labelA}
                    </th>
                    {tableB && labelB && (
                      <th
                        colSpan={4}
                        className={`py-1.5 px-3 text-center font-bold ${
                          isBActive ? 'bg-[#e5e5e5] text-[#121212]' : ''
                        }`}
                      >
                        {labelB}
                      </th>
                    )}
                  </tr>
                  <tr className="bg-[#f8f8f8] text-[10px] text-[#555555] border-b-2 border-[#121212] font-mono">
                    <th className="py-1 px-2.5 text-right border-r border-[#e0e0e0]">
                      Thick (mm)
                    </th>
                    <th className="py-1 px-2.5 text-right border-r border-[#e0e0e0] font-semibold text-[#121212]">
                      Inner di (mm)
                    </th>
                    <th className="py-1 px-2.5 text-right border-r border-[#e0e0e0]">
                      Qmax (L/s)
                    </th>
                    <th
                      className={`py-1 px-2.5 text-right ${
                        tableB ? 'border-r border-[#e0e0e0]' : ''
                      }`}
                    >
                      Max LU
                    </th>
                    {tableB && (
                      <>
                        <th className="py-1 px-2.5 text-right border-r border-[#e0e0e0]">
                          Thick (mm)
                        </th>
                        <th className="py-1 px-2.5 text-right border-r border-[#e0e0e0] font-semibold text-[#121212]">
                          Inner di (mm)
                        </th>
                        <th className="py-1 px-2.5 text-right border-r border-[#e0e0e0]">
                          Qmax (L/s)
                        </th>
                        <th className="py-1 px-2.5 text-right">Max LU</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e0e0e0] font-mono tabular-nums">
                  {tableA.sizes.map((rowA, idx) => {
                    const rowB = tableB ? tableB.sizes[idx] : null;
                    const isIncluded = isPipeSizeIncluded(
                      group.specA,
                      rowA.nominalSize,
                      excludedPipeSizes
                    );
                    const capA =
                      rowA.innerDiameter !== null
                        ? getMaxFlowAndLuForDiameter(
                            rowA.innerDiameter,
                            maxVelocityMs,
                            flowFormula,
                            standard
                          )
                        : null;
                    const capB =
                      rowB && rowB.innerDiameter !== null
                        ? getMaxFlowAndLuForDiameter(
                            rowB.innerDiameter,
                            maxVelocityMs,
                            flowFormula,
                            standard
                          )
                        : null;

                    return (
                      <tr
                        key={rowA.nominalSize}
                        className={
                          isIncluded
                            ? 'hover:bg-[#f8f8f8]'
                            : 'bg-[#fafafa] text-[#999999] hover:bg-[#f3f3f3]'
                        }
                      >
                        <td className="py-1.5 px-2 text-center border-r border-[#e0e0e0]">
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            onChange={() =>
                              onTogglePipeSize(groupSpecIds, rowA.nominalSize)
                            }
                            aria-label={`Include ${group.tabLabel} ${rowA.nominalSize} mm nominal pipe size`}
                            data-testid={`pipe-size-checkbox-${group.specA}-${rowA.nominalSize}`}
                            className="w-3.5 h-3.5 accent-[#121212] cursor-pointer align-middle"
                          />
                        </td>
                        <td
                          className={`py-1.5 px-3 text-right font-semibold border-r border-[#e0e0e0] ${
                            isIncluded ? 'text-[#121212]' : 'text-[#999999] line-through'
                          }`}
                        >
                          {rowA.nominalSize}
                        </td>
                        <td
                          className={`py-1.5 px-3 text-right border-r border-[#e0e0e0] ${
                            isIncluded ? 'text-[#555555]' : 'text-[#aaaaaa]'
                          }`}
                        >
                          {showDecimalOd ? rowA.outerDiameter.toFixed(1) : rowA.outerDiameter}
                        </td>

                        <td
                          className={`py-1.5 px-2.5 text-right border-r border-[#e0e0e0] ${
                            isIncluded ? 'text-[#555555]' : 'text-[#aaaaaa]'
                          }`}
                        >
                          {rowA.wallThickness !== null
                            ? formatPipeDim(rowA.wallThickness, tableA)
                            : '—'}
                        </td>
                        <td
                          className={`py-1.5 px-2.5 text-right font-semibold border-r border-[#e0e0e0] ${
                            rowA.innerDiameter !== null
                              ? !isIncluded
                                ? 'text-[#999999]'
                                : isAActive
                                ? 'text-[#121212] bg-[#eeeeee]'
                                : 'text-[#121212]'
                              : 'text-[#bbbbbb]'
                          }`}
                        >
                          {rowA.innerDiameter !== null
                            ? formatPipeDim(rowA.innerDiameter, tableA)
                            : '—'}
                        </td>
                        <td
                          className={`py-1.5 px-2.5 text-right border-r border-[#e0e0e0] ${
                            isIncluded ? 'text-[#555555]' : 'text-[#aaaaaa]'
                          }`}
                        >
                          {capA
                            ? capA.qMaxLs.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : '—'}
                        </td>
                        <td
                          className={`py-1.5 px-2.5 text-right ${
                            tableB ? 'border-r border-[#e0e0e0]' : ''
                          } ${isIncluded ? 'text-[#666666]' : 'text-[#aaaaaa]'}`}
                        >
                          {capA ? Math.floor(capA.luMax).toLocaleString() : '—'}
                        </td>

                        {tableB && (
                          <>
                            <td
                              className={`py-1.5 px-2.5 text-right border-r border-[#e0e0e0] ${
                                isIncluded ? 'text-[#555555]' : 'text-[#aaaaaa]'
                              }`}
                            >
                              {rowB?.wallThickness !== null && rowB?.wallThickness !== undefined
                                ? formatPipeDim(rowB.wallThickness, tableB)
                                : '—'}
                            </td>
                            <td
                              className={`py-1.5 px-2.5 text-right font-semibold border-r border-[#e0e0e0] ${
                                rowB?.innerDiameter !== null && rowB?.innerDiameter !== undefined
                                  ? !isIncluded
                                    ? 'text-[#999999]'
                                    : isBActive
                                    ? 'text-[#121212] bg-[#eeeeee]'
                                    : 'text-[#121212]'
                                  : 'text-[#bbbbbb]'
                              }`}
                            >
                              {rowB?.innerDiameter !== null && rowB?.innerDiameter !== undefined
                                ? formatPipeDim(rowB.innerDiameter, tableB)
                                : '—'}
                            </td>
                            <td
                              className={`py-1.5 px-2.5 text-right border-r border-[#e0e0e0] ${
                                isIncluded ? 'text-[#555555]' : 'text-[#aaaaaa]'
                              }`}
                            >
                              {capB
                                ? capB.qMaxLs.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })
                                : '—'}
                            </td>
                            <td
                              className={`py-1.5 px-2.5 text-right ${
                                isIncluded ? 'text-[#666666]' : 'text-[#aaaaaa]'
                              }`}
                            >
                              {capB ? Math.floor(capB.luMax).toLocaleString() : '—'}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

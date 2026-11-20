import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DesignStandard,
  FloorInputRow,
  FlowConversionFormula,
  PrvOverrideMode,
  SupplyMode,
  SystemCalculationResult,
} from '../types/hydraulics';
import { getStandardLabel } from '../data/appliances';
import { formatPipeDim, getPipeSpecBadgeLabel, PIPE_SPEC_TABLES } from '../data/pipeSpecs';
import {
  DISCLAIMER_SECTIONS,
  DISCLAIMER_SUMMARY_LINE,
} from '../data/disclaimer';
import {
  calculateFlowRateFromLu,
  calculateMaxLuFromFlowRate,
  calculatePipeAreaM2,
  formatCavitationRatio,
  formatExcludedPipeSizesSummary,
  formatFlowFormulaDisplay,
  formatLuDisplay,
  formatRowDeltaPDisplay,
  formatRowEquipmentDisplay,
  getEffectiveCavitationRatioLimit,
  getEffectiveStandard,
  isDefaultCavitationRatioLimit,
  isDefaultFlowFormula,
  toPdfSafeText,
} from './calculations';
import { renderPressureProfileToPdf, renderRiserSchematicToPdf } from './pdfDiagrams';

type ExportRiserColumn =
  | {
      kind: 'main';
      dropperIndex: number;
      shortLabel: string;
      excelPressureHeader: string;
      excelSizeHeader: string;
      pdfPressureHeader: string;
      pdfSizeHeader: string;
    }
  | {
      kind: 'sub';
      subDropperId: string;
      shortLabel: string;
      excelPressureHeader: string;
      excelSizeHeader: string;
      pdfPressureHeader: string;
      pdfSizeHeader: string;
    };

function buildOrderedExportRiserColumns(result: SystemCalculationResult): ExportRiserColumn[] {
  const cols: ExportRiserColumn[] = [];
  const usedSubIds = new Set<string>();
  for (const d of result.dropperSummaries) {
    cols.push({
      kind: 'main',
      dropperIndex: d.dropperIndex,
      shortLabel: `D${d.dropperIndex}`,
      excelPressureHeader: `D${d.dropperIndex} (bar)`,
      excelSizeHeader: `OD D${d.dropperIndex} (mm)`,
      pdfPressureHeader: `D${d.dropperIndex}\n(bar)`,
      pdfSizeHeader: `OD D${d.dropperIndex}\n(mm)`,
    });
    for (const sd of result.subDropperSummaries) {
      if (sd.parentDropperIndex === d.dropperIndex) {
        usedSubIds.add(sd.id);
        cols.push({
          kind: 'sub',
          subDropperId: sd.id,
          shortLabel: sd.label,
          excelPressureHeader: `${sd.label} (bar)`,
          excelSizeHeader: `OD ${sd.label} (mm)`,
          pdfPressureHeader: `${sd.label}\n(bar)`,
          pdfSizeHeader: `OD ${sd.label}\n(mm)`,
        });
      }
    }
  }
  for (const sd of result.subDropperSummaries) {
    if (!usedSubIds.has(sd.id)) {
      cols.push({
        kind: 'sub',
        subDropperId: sd.id,
        shortLabel: sd.label,
        excelPressureHeader: `${sd.label} (bar)`,
        excelSizeHeader: `OD ${sd.label} (mm)`,
        pdfPressureHeader: `${sd.label}\n(bar)`,
        pdfSizeHeader: `OD ${sd.label}\n(mm)`,
      });
    }
  }
  return cols;
}

/**
 * Build full multi-sheet Excel (.xlsx) Engineering Calculation Workbook
 */
export function buildCalculationExcelWorkbook(result: SystemCalculationResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const {
    parameters,
    pipeSpec,
    optionalPipeSpec,
    dropperSummaries,
    subDropperSummaries,
    rows,
    prvList,
  } = result;
  const riserColumns = buildOrderedExportRiserColumns(result);
  const subDropperLabelMap = new Map(subDropperSummaries.map((sd) => [sd.id, sd.label]));
  const cavLimitText = formatCavitationRatio(getEffectiveCavitationRatioLimit(parameters));
  const effectiveStandard = getEffectiveStandard(parameters.standard);
  const standardLabel = getStandardLabel(effectiveStandard);
  const flowFormulaText = formatFlowFormulaDisplay(parameters.flowFormula, effectiveStandard);

  // 1. Hydraulic Schedule Sheet
  const dropperHeaders = riserColumns.map((c) => c.excelPressureHeader);
  const dropperSizeHeaders =
    riserColumns.length > 1
      ? riserColumns.map((c) => c.excelSizeHeader)
      : ['Selected Pipe OD (mm)'];

  const scheduleHeader = [
    'Floor Level',
    'Floor Height (m)',
    'Static Head Gain (m)',
    'Static Head Gain (bar)',
    'Equip. / Fitting',
    'Flow Rate Q (L/s)',
    'ΔP (bar)',
    'P1/P2 Ratio',
    'Floor LU',
    'Cum. LU (Active)',
    ...dropperHeaders,
    ...dropperSizeHeaders,
    'Inner Dia di (mm)',
    'Velocity V (m/s)',
  ];

  const scheduleData = rows.map((row) => {
    const isRoof = row.input.supplyMode === SupplyMode.ROOF_HEADER;
    const allPrvCells = [
      ...Object.values(row.dropperCells).filter((c) => c.hasPrv && c.prvDetail),
      ...Object.values(row.subDropperCells).filter((c) => c.hasPrv && c.prvDetail),
    ];
    const hasCavitation = allPrvCells.some((c) => c.prvDetail?.cavitationWarning);
    const velExceeded =
      row.primaryVelocityMs !== null &&
      row.primaryVelocityMs > parameters.maxVelocityMs + 1e-4;

    const pressureCols = riserColumns.map((col) => {
      const cell =
        col.kind === 'main'
          ? row.dropperCells[col.dropperIndex]
          : row.subDropperCells[col.subDropperId];
      if (!cell) return '';
      const overPressure =
        cell.isServed &&
        cell.workingPressureBar !== null &&
        cell.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;
      if (cell.hasPrv && cell.prvDetail) {
        const p2Str = `${cell.prvDetail.downstreamPressureBar.toFixed(2)}${
          cell.prvDetail.isCustomSetPressure ? '*' : ''
        }`;
        if (cell.isServed && cell.workingPressureBar !== null) {
          return overPressure || cell.prvDetail.isCustomSetPressure
            ? `${p2Str}${overPressure ? ' !' : ''}`
            : Number(cell.workingPressureBar.toFixed(2));
        }
        return `PRV ${p2Str}`;
      }
      if (cell.isServed && cell.workingPressureBar !== null) {
        return overPressure
          ? `${cell.workingPressureBar.toFixed(2)} !`
          : Number(cell.workingPressureBar.toFixed(2));
      }
      return cell.isExpressPassThrough ? '┆' : '';
    });

    const sizeCols =
      riserColumns.length > 1
        ? riserColumns.map((col) => {
            const cell =
              col.kind === 'main'
                ? row.dropperCells[col.dropperIndex]
                : row.subDropperCells[col.subDropperId];
            if (!cell || cell.selectedNominalMm === null) return '';
            const prefix = cell.isFallbackMaterial
              ? `${getPipeSpecBadgeLabel(cell.selectedSpecId)} `
              : '';
            const expMark = cell.isExpressPassThrough && !isRoof ? '*' : '';
            const capMark = cell.exceedsMaxPipeCapacity ? ' !' : '';
            if (!prefix && !expMark && !capMark) {
              return cell.selectedNominalMm;
            }
            return `${prefix}${cell.selectedNominalMm}${expMark}${capMark}`;
          })
        : [
            row.primaryNominalMm !== null
              ? (() => {
                  const prefix = row.primaryIsFallbackMaterial
                    ? `${getPipeSpecBadgeLabel(row.primarySpecId)} `
                    : '';
                  const capMark = velExceeded ? ' !' : '';
                  if (!prefix && !capMark) return row.primaryNominalMm;
                  return `${prefix}${row.primaryNominalMm}${capMark}`;
                })()
              : '',
          ];

    const equipStr = formatRowEquipmentDisplay(row, riserColumns.length, subDropperLabelMap, 'excel');
    const primaryRowSpec = PIPE_SPEC_TABLES[row.primarySpecId] ?? pipeSpec;
    const deltaPStr = formatRowDeltaPDisplay(row);

    return [
      row.input.floorLabel,
      Number(row.input.floorHeightM.toFixed(2)),
      Number(row.cumulativeHeadM.toFixed(2)),
      Number(row.staticPressureBar.toFixed(2)),
      equipStr,
      row.primaryFlowRateLs !== null && row.primaryFlowRateLs > 0
        ? Number(row.primaryFlowRateLs.toFixed(2))
        : '',
      deltaPStr,
      row.primaryPrvRatio !== null
        ? hasCavitation
          ? `${row.primaryPrvRatio.toFixed(2)} !`
          : Number(row.primaryPrvRatio.toFixed(2))
        : '',
      isRoof
        ? Number(formatLuDisplay(row.primaryCumulativeLu))
        : row.isSplitFloor
        ? `◐ ${formatLuDisplay(row.input.loadingUnits)}`
        : Number(formatLuDisplay(row.input.loadingUnits)),
      row.primaryCumulativeLu > 0 ? Number(formatLuDisplay(row.primaryCumulativeLu)) : '',
      ...pressureCols,
      ...sizeCols,
      row.primaryInnerMm !== null
        ? Number(formatPipeDim(row.primaryInnerMm, primaryRowSpec))
        : '',
      row.primaryVelocityMs !== null
        ? velExceeded
          ? `${row.primaryVelocityMs.toFixed(2)} !`
          : Number(row.primaryVelocityMs.toFixed(2))
        : '',
    ];
  });

  const wsSchedule = XLSX.utils.aoa_to_sheet([
    scheduleHeader,
    ...scheduleData,
    [],
    ['NOTICE & ENGINEERING DISCLAIMER', DISCLAIMER_SUMMARY_LINE],
    ...DISCLAIMER_SECTIONS.map((s) => [`${s.number}. ${s.title}`, s.body]),
  ]);
  for (let r = 1; r <= scheduleData.length; r++) {
    for (const c of [1, 2]) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (wsSchedule[ref]) {
        wsSchedule[ref].z = '0.00';
      }
    }
  }
  wsSchedule['!cols'] = scheduleHeader.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, wsSchedule, 'Hydraulic Schedule');

  // 2. Summary & Dropper Zones Sheet
  const subDropperExcelSection: (string | number)[][] =
    subDropperSummaries.length > 0
      ? [
          [],
          ['SUB-DROPPER BRANCH SUMMARY'],
          [
            'Sub-Dropper',
            'Feed & Branch Floor',
            'Flow Orientation',
            'Served Floors',
            'Floor Count',
            'Zone LU',
            'Peak Flow Q (L/s)',
            'Pipe Sizing Base -> Term / di (mm)',
            'Peak Velocity (m/s)',
            'Working Pressure Range (bar)',
            'PRV Stations',
          ],
          ...subDropperSummaries.map((sd) => {
            const sdFallbackPrefix = sd.baseIsFallbackMaterial
              ? `${getPipeSpecBadgeLabel(sd.baseSpecId)} `
              : '';
            const sdBaseSpec = PIPE_SPEC_TABLES[sd.baseSpecId] ?? pipeSpec;
            const sdDi =
              sd.baseInnerMm !== null ? ` (di ${formatPipeDim(sd.baseInnerMm, sdBaseSpec)})` : '';
            const sdSizeText = sd.baseNominalMm
              ? sd.terminalNominalMm && sd.terminalNominalMm !== sd.baseNominalMm
                ? `${sdFallbackPrefix}Ø${sd.baseNominalMm} -> Ø${sd.terminalNominalMm}${sdDi}${
                    sd.exceedsCapacity ? ' !' : ''
                  }`
                : `${sdFallbackPrefix}Ø${sd.baseNominalMm}${sdDi}${
                    sd.exceedsCapacity ? ' !' : ''
                  }`
              : '-';
            const sdVelOver =
              sd.peakVelocityMs !== null &&
              sd.peakVelocityMs > parameters.maxVelocityMs + 1e-4;
            return [
              sd.label,
              `D${sd.parentDropperIndex} @ ${sd.branchFloorLabel}`,
              `${sd.flowOrientation} (${
                sd.hasBoosterPump
                  ? `Booster +${(sd.boosterPressureBar ?? parameters.boosterPumpBoostBar).toFixed(
                      2
                    )}b${sd.isCustomBoosterPressure ? '*' : ''}`
                  : sd.zoneType
              })`,
              sd.servedFloorRange,
              sd.servedFloorCount,
              Number(formatLuDisplay(sd.totalZoneLu)),
              Number(sd.peakFlowRateLs.toFixed(2)),
              sdSizeText,
              sd.peakVelocityMs !== null
                ? sdVelOver
                  ? `${sd.peakVelocityMs.toFixed(2)} !`
                  : Number(sd.peakVelocityMs.toFixed(2))
                : '-',
              sd.minWorkingPressureBar !== null && sd.maxWorkingPressureBar !== null
                ? `${sd.minWorkingPressureBar.toFixed(2)} – ${sd.maxWorkingPressureBar.toFixed(2)}`
                : '-',
              sd.prvCount,
            ];
          }),
        ]
      : [];

  const alertsExcelSection: (string | number)[][] =
    result.warnings.length > 0
      ? [
          [],
          ['ENGINEERING VERIFICATION ALERTS'],
          ['Alert #', 'Verification Message'],
          ...result.warnings.map((w, idx) => [idx + 1, w]),
        ]
      : [
          [],
          ['ENGINEERING VERIFICATION STATUS'],
          ['Status', 'All velocities, working pressures, and PRV ratios within design limits.'],
        ];

  const headerSpec = PIPE_SPEC_TABLES[result.pipeHeader.specId] ?? pipeSpec;
  const excludedSizesText = formatExcludedPipeSizesSummary(parameters) ?? 'None';

  const summaryRows: (string | number)[][] = [
    ['HIGH-RISE DOMESTIC COLD WATER DROPPER SIZING & STATIC PRESSURE REPORT'],
    ['Project Name', parameters.projectName],
    ['Job No.', parameters.projectRef],
    ['Pipe Material & Class (Primary)', pipeSpec.fullName],
    ['Pipe Material & Class (Optional)', optionalPipeSpec ? optionalPipeSpec.fullName : 'None'],
    ['Excluded Pipe Sizes', excludedSizesText],
    ['Max Allowable Flow Velocity Vmax (m/s)', parameters.maxVelocityMs],
    ['Pipe Header Max Velocity Limit (Vmax - 0.5) (m/s)', result.pipeHeader.maxVelocityMs],
    ['Max Allowable Static Pressure Pmax (bar)', parameters.maxStaticPressureBar],
    ['PRV Downstream Set Pressure Pset (bar)', parameters.prvSetPressureBar],
    ['Booster Pump Boost ΔP (bar)', parameters.boosterPumpBoostBar],
    ['Design Standard', standardLabel],
    [
      'LU → Flow Conversion Formula',
      `${flowFormulaText}${
        isDefaultFlowFormula(parameters.flowFormula, effectiveStandard)
          ? ` (${standardLabel} Default)`
          : ' (Custom)'
      }`,
    ],
    [
      'Cavitation Check Limit (P1/P2)',
      `<= ${cavLimitText}${isDefaultCavitationRatioLimit(parameters.cavitationRatioLimit) ? ' (Default)' : ' (Custom)'}`,
    ],
    ['Total Required Main Droppers', result.totalPhysicalDropperPipes],
    ['Booster Pump Droppers', result.boosterDropperPipes],
    ['Gravity Main Droppers', result.gravityDropperPipes],
    ['Total Sub-Dropper Branches', result.totalSubDropperPipes],
    ['Multi-Riser Split Floors', result.splitFloorCount],
    ['Total Building Loading Units (LU)', Number(formatLuDisplay(result.totalBuildingLu))],
    ['Peak System Design Flow Q (L/s)', Number(result.peakSystemFlowLs.toFixed(2))],
    [
      'Roof Pipe Header Size (mm)',
      result.pipeHeader.nominalMm
        ? `${
            result.pipeHeader.isFallbackMaterial
              ? `${getPipeSpecBadgeLabel(result.pipeHeader.specId)} `
              : ''
          }Ø${result.pipeHeader.nominalMm} mm [${
            result.pipeHeader.isCustomSize ? 'Custom' : 'Auto'
          }] (di ${formatPipeDim(
            result.pipeHeader.innerMm,
            headerSpec
          )} mm · ${result.pipeHeader.velocityMs?.toFixed(2) ?? '-'} / <=${result.pipeHeader.maxVelocityMs.toFixed(
            2
          )} m/s${result.pipeHeader.exceedsMaxCapacity ? ' ! EXCEEDS LIMIT' : ''})`
        : '-',
    ],
    ['Total Building Vertical Drop (m)', Number(result.totalBuildingHeightM.toFixed(2))],
    ['Max Unreduced Hydrostatic Pressure (bar)', Number(result.maxStaticHeadBar.toFixed(2))],
    [],
    ['MAIN DROPPER ZONE SUMMARY'],
    [
      'Dropper Riser',
      'Supply Mode',
      'Served Floors',
      'Floor Count',
      'Zone LU',
      'Peak Flow Q (L/s)',
      'Header Nominal Size (mm)',
      'Header Inner di (mm)',
      'Peak Velocity (m/s)',
      'Working Pressure Range (bar)',
      'PRV Stations',
    ],
    ...dropperSummaries.map((d) => {
      const mainVelOver =
        d.peakVelocityMs !== null && d.peakVelocityMs > parameters.maxVelocityMs + 1e-4;
      const mainSizePrefix = d.headerIsFallbackMaterial
        ? `${getPipeSpecBadgeLabel(d.headerSpecId)} `
        : '';
      const mainCapFlag = d.exceedsCapacity ? ' !' : '';
      const mainSizeCell =
        d.headerNominalMm !== null
          ? !mainSizePrefix && !mainCapFlag
            ? d.headerNominalMm
            : `${mainSizePrefix}${d.headerNominalMm}${mainCapFlag}`
          : '-';
      return [
        d.label,
        d.hasBoosterPump
          ? `Booster (+${(d.boosterPressureBar ?? parameters.boosterPumpBoostBar).toFixed(2)}b${
              d.isCustomBoosterPressure ? '*' : ''
            })`
          : d.zoneType,
        d.servedFloorRange,
        d.servedFloorCount,
        Number(formatLuDisplay(d.totalZoneLu)),
        Number(d.peakFlowRateLs.toFixed(2)),
        mainSizeCell,
        d.headerInnerMm !== null
          ? Number(formatPipeDim(d.headerInnerMm, PIPE_SPEC_TABLES[d.headerSpecId] ?? pipeSpec))
          : '-',
        d.peakVelocityMs !== null
          ? mainVelOver
            ? `${d.peakVelocityMs.toFixed(2)} !`
            : Number(d.peakVelocityMs.toFixed(2))
          : '-',
        d.minWorkingPressureBar !== null && d.maxWorkingPressureBar !== null
          ? `${d.minWorkingPressureBar.toFixed(2)} – ${d.maxWorkingPressureBar.toFixed(2)}`
          : '-',
        d.prvCount,
      ];
    }),
    ...subDropperExcelSection,
    [],
    ['PRV INSTALLATION & CAVITATION SCHEDULE'],
    [
      'Floor Level',
      'Riser / Branch',
      'Upstream P1 (bar)',
      'Downstream P2 (bar)',
      'Head Reduction ΔP (bar)',
      'Ratio P1/P2',
      `Cavitation Check (P1/P2 <= ${cavLimitText})`,
      'Zone Flow Q (L/s)',
      'Recommended PRV Bore (DN)',
    ],
    ...prvList.map((p) => [
      `${p.floorLabel}${p.isManualOverride ? ' [Pin]' : ''}`,
      p.dropperName,
      Number(p.upstreamPressureBar.toFixed(2)),
      p.isCustomSetPressure
        ? `${p.downstreamPressureBar.toFixed(2)}*`
        : Number(p.downstreamPressureBar.toFixed(2)),
      Number(p.deltaPressureBar.toFixed(2)),
      Number(p.pressureRatio.toFixed(2)),
      p.cavitationWarning
        ? `WARNING: P1/P2 > ${cavLimitText} (Series PRV Req.)`
        : 'OK (Within Limit)',
      Number(p.flowRateLs.toFixed(2)),
      `DN${p.recommendedValveDn}`,
    ]),
    ...alertsExcelSection,
    [],
    ['ENGINEERING DISCLAIMER & TERMS OF USE'],
    ['Clause', 'Terms & Conditions'],
    ...DISCLAIMER_SECTIONS.map((s) => [`${s.number}. ${s.title}`, s.body]),
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  const verticalDropRowIdx = summaryRows.findIndex(
    (r) => r[0] === 'Total Building Vertical Drop (m)'
  );
  if (verticalDropRowIdx >= 0) {
    const ref = XLSX.utils.encode_cell({ r: verticalDropRowIdx, c: 1 });
    if (wsSummary[ref]) {
      wsSummary[ref].z = '0.00';
    }
  }
  wsSummary['!cols'] = [
    { wch: 36 },
    { wch: 24 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 24 },
    { wch: 22 },
    { wch: 22 },
    { wch: 24 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Design Summary & PRVs');

  // 3. Pipe Specification Table Sheet
  const buildSpecTableRows = (
    heading: string,
    specTable: SystemCalculationResult['pipeSpec']
  ): (string | number)[][] => [
    [heading],
    [
      'Nominal Size (mm)',
      'Outer Diameter (mm)',
      'Wall Thickness (mm)',
      'Inner Diameter di (mm)',
      'Internal Area A (cm²)',
      `Max Flow Q at ${parameters.maxVelocityMs} m/s (L/s)`,
    ],
    ...specTable.sizes.map((s) => {
      if (s.innerDiameter === null || s.wallThickness === null) {
        return [s.nominalSize, s.outerDiameter, '-', '-', '-', '-'];
      }
      const areaM2 = calculatePipeAreaM2(s.innerDiameter);
      const qMax = parameters.maxVelocityMs * areaM2 * 1000;
      return [
        s.nominalSize,
        s.outerDiameter,
        s.wallThickness,
        s.innerDiameter,
        Number((areaM2 * 10000).toFixed(2)),
        Number(qMax.toFixed(2)),
      ];
    }),
  ];

  const specRows: (string | number)[][] = [
    ...buildSpecTableRows(`PRIMARY SPECIFICATION: ${pipeSpec.fullName}`, pipeSpec),
    ...(optionalPipeSpec && optionalPipeSpec.id !== pipeSpec.id
      ? [
          [],
          ...buildSpecTableRows(
            `OPTIONAL FALLBACK SPECIFICATION: ${optionalPipeSpec.fullName}`,
            optionalPipeSpec
          ),
        ]
      : []),
  ];
  const wsSpec = XLSX.utils.aoa_to_sheet(specRows);
  wsSpec['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsSpec, 'Pipe Spec Table');

  return wb;
}

/**
 * Export full multi-sheet Excel (.xlsx) Engineering Calculation Workbook
 */
export function exportCalculationToExcel(result: SystemCalculationResult): void {
  const wb = buildCalculationExcelWorkbook(result);
  const safeSlug =
    result.parameters.projectRef.replace(/[^a-zA-Z0-9_-]/g, '_') || 'DCW_Schedule';
  XLSX.writeFile(wb, `${safeSlug}_DCW_Dropper_Calculation.xlsx`);
}

/**
 * Build formatted multi-page A4 Engineering Calculation Report in PDF (.pdf)
 */
export function buildCalculationPdfDocument(result: SystemCalculationResult): jsPDF {
  const {
    parameters,
    pipeSpec,
    optionalPipeSpec,
    dropperSummaries,
    subDropperSummaries,
    rows,
    prvList,
  } = result;
  const specSummaryText = optionalPipeSpec
    ? `${pipeSpec.fullName} (Opt: ${optionalPipeSpec.fullName})`
    : pipeSpec.fullName;
  const riserColumns = buildOrderedExportRiserColumns(result);
  const subDropperLabelMap = new Map(subDropperSummaries.map((sd) => [sd.id, sd.label]));
  const cavLimitText = formatCavitationRatio(getEffectiveCavitationRatioLimit(parameters));
  const effectiveStandard = getEffectiveStandard(parameters.standard);
  const standardLabel = getStandardLabel(effectiveStandard);
  const flowFormulaText = formatFlowFormulaDisplay(parameters.flowFormula, effectiveStandard);
  const isCustomFormula = !isDefaultFlowFormula(parameters.flowFormula, effectiveStandard);
  const isCustomCavLimit = !isDefaultCavitationRatioLimit(parameters.cavitationRatioLimit);
  const generatedDate = new Date().toISOString().slice(0, 10);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const headerSpec = PIPE_SPEC_TABLES[result.pipeHeader.specId] ?? pipeSpec;

  // Title Header Block (light-toned banner matching Report Preview)
  doc.setFillColor(238, 238, 238);
  doc.setDrawColor(224, 224, 224);
  doc.setLineWidth(0.3);
  doc.rect(14, 10, 269, 19, 'FD');
  doc.setDrawColor(18, 18, 18);
  doc.setLineWidth(0.6);
  doc.line(14, 29, 283, 29);

  doc.setTextColor(18, 18, 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text('DOMESTIC COLD WATER (DCW) DROPPER SIZING & STATIC PRESSURE REPORT', 18, 18);
  doc.setTextColor(85, 85, 85);
  doc.setFont('helvetica', 'normal');
  const bannerSubtitle = toPdfSafeText(
    `Project: ${parameters.projectName}   |   Job No. ${parameters.projectRef}   |   Standard: ${standardLabel}   |   Pipe Spec: ${specSummaryText}   |   Date: ${generatedDate}`
  );
  doc.setFontSize(doc.getTextWidth(bannerSubtitle) > 261 ? 7.3 : 8.5);
  doc.text(bannerSubtitle, 18, 24.5, { maxWidth: 261 });

  // Section 1: Global Hydraulic Design Parameters & System Summary
  doc.setTextColor(18, 18, 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('1. Global Hydraulic Design Parameters & System Summary', 14, 36);

  const headerSizeCell = result.pipeHeader.nominalMm
    ? `${
        result.pipeHeader.isFallbackMaterial
          ? `${getPipeSpecBadgeLabel(result.pipeHeader.specId)} `
          : ''
      }Ø${result.pipeHeader.nominalMm}${result.pipeHeader.isCustomSize ? '*' : ''} (${
        result.pipeHeader.velocityMs?.toFixed(2) ?? '-'
      } m/s)${result.pipeHeader.exceedsMaxCapacity ? ' !' : ''}\ndi ${formatPipeDim(
        result.pipeHeader.innerMm,
        headerSpec
      )} mm · ${result.pipeHeader.isCustomSize ? 'Custom' : 'Auto'}`
    : '-';

  autoTable(doc, {
    startY: 39,
    margin: { left: 14, right: 14, top: 18, bottom: 16 },
    tableWidth: 269,
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 1.8,
      textColor: [18, 18, 18],
      lineColor: [224, 224, 224],
    },
    headStyles: { fillColor: [238, 238, 238], textColor: [18, 18, 18], fontStyle: 'bold' },
    head: [
      [
        'Pipe Specification',
        'Vmax (m/s)',
        'Pmax (bar)',
        'PRV Pset (bar)',
        'Booster dP',
        'Risers (B / G)',
        'Total LU',
        'Peak Flow Q',
        'Height / Pstat',
        'Pipe Header',
      ].map(toPdfSafeText),
    ],
    body: [
      [
        specSummaryText,
        `<= ${parameters.maxVelocityMs.toFixed(2)}\n(Hdr <= ${result.pipeHeader.maxVelocityMs.toFixed(
          2
        )})`,
        `${parameters.maxStaticPressureBar.toFixed(2)}`,
        `${parameters.prvSetPressureBar.toFixed(2)}`,
        `+${parameters.boosterPumpBoostBar.toFixed(2)} bar`,
        `${result.totalPhysicalDropperPipes} (${result.boosterDropperPipes}B / ${result.gravityDropperPipes}G)${
          result.totalSubDropperPipes > 0
            ? ` + ${result.totalSubDropperPipes} Sub${
                result.boosterSubDropperPipes > 0 ? ` (${result.boosterSubDropperPipes}B)` : ''
              }`
            : ''
        }`,
        `${formatLuDisplay(result.totalBuildingLu)} LU`,
        `${result.peakSystemFlowLs.toFixed(2)} L/s`,
        `${result.totalBuildingHeightM.toFixed(2)} m\n${result.maxStaticHeadBar.toFixed(2)} bar`,
        headerSizeCell,
      ].map(toPdfSafeText),
    ],
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 9) {
        if (result.pipeHeader.exceedsMaxCapacity) {
          data.cell.styles.textColor = [217, 0, 0];
          data.cell.styles.fontStyle = 'bold';
        } else if (result.pipeHeader.isCustomSize || result.pipeHeader.isFallbackMaterial) {
          data.cell.styles.textColor = [29, 78, 216];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  let cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 3.5;

  const excludedSizesPdfText = formatExcludedPipeSizesSummary(parameters);
  if (excludedSizesPdfText) {
    const exclText = toPdfSafeText(`Excluded Pipe Sizes: ${excludedSizesPdfText}`);
    const wrappedExcl = doc.splitTextToSize(exclText, 263) as string[];
    const exclH = 2.6 + wrappedExcl.length * 3.5;
    doc.setFillColor(248, 248, 248);
    doc.setDrawColor(224, 224, 224);
    doc.setLineWidth(0.25);
    doc.rect(14, cursorY, 269, exclH, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(65, 65, 65);
    doc.text(wrappedExcl, 17, cursorY + 4.1);
    cursorY += exclH + 2;
  }

  // Engineering Verification Alerts Banner matching Preview
  if (result.warnings.length > 0) {
    const alertLines = result.warnings.map((w) => toPdfSafeText(`• ${w}`));
    const wrappedLines = alertLines.flatMap((l) => doc.splitTextToSize(l, 260) as string[]);
    const boxH = 7 + wrappedLines.length * 3.6;
    if (cursorY + boxH > 190) {
      doc.addPage('a4', 'landscape');
      cursorY = 18;
    }
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(252, 165, 165);
    doc.setLineWidth(0.3);
    doc.rect(14, cursorY, 269, boxH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(217, 0, 0);
    doc.text(
      `Engineering Verification Alerts (${result.warnings.length})`,
      17,
      cursorY + 4.5
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(153, 27, 27);
    wrappedLines.forEach((line, idx) => {
      doc.text(line, 17, cursorY + 8.5 + idx * 3.6);
    });
    cursorY += boxH + 7.5;
  } else if (rows.length > 0) {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.setLineWidth(0.25);
    doc.rect(14, cursorY, 269, 6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(21, 128, 61);
    doc.text(
      'Engineering Verification: All velocities, working pressures, and PRV ratios within design limits.',
      17,
      cursorY + 4.1
    );
    cursorY += 13.5;
  } else {
    cursorY += 5;
  }

  // Section 2: Main Dropper Riser Breakdown & PRV Stations
  if (cursorY > 170) {
    doc.addPage('a4', 'landscape');
    cursorY = 18;
  }
  doc.setTextColor(18, 18, 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('2. Main Dropper Riser Breakdown & PRV Stations', 14, cursorY);

  autoTable(doc, {
    startY: cursorY + 3,
    margin: { left: 14, right: 14, top: 18, bottom: 16 },
    tableWidth: 269,
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 1.8,
      textColor: [18, 18, 18],
      lineColor: [224, 224, 224],
    },
    headStyles: { fillColor: [238, 238, 238], textColor: [18, 18, 18], fontStyle: 'bold' },
    head: [
      [
        'Riser Designation',
        'Zone Mode',
        'Served Levels',
        'Zone LU',
        'Peak Flow (L/s)',
        'Header Size / di (mm)',
        'Peak Vel. (m/s)',
        'Working P (bar)',
        'PRVs',
      ],
    ],
    body:
      dropperSummaries.length === 0
        ? [
            [
              {
                content:
                  'No building floors configured yet. Add floors in Floor Data Input to populate dropper riser sizing.',
                colSpan: 9,
                styles: { halign: 'center', textColor: [102, 102, 102] },
              },
            ],
          ]
        : dropperSummaries.map((d) =>
            [
              d.label,
              d.hasBoosterPump
                ? `Booster (+${(d.boosterPressureBar ?? parameters.boosterPumpBoostBar).toFixed(
                    2
                  )}b${d.isCustomBoosterPressure ? '*' : ''})`
                : d.zoneType,
              d.servedFloorRange,
              formatLuDisplay(d.totalZoneLu),
              d.peakFlowRateLs.toFixed(2),
              d.headerNominalMm
                ? `${
                    d.headerIsFallbackMaterial
                      ? `${getPipeSpecBadgeLabel(d.headerSpecId)} `
                      : ''
                  }Ø${d.headerNominalMm} (${formatPipeDim(
                    d.headerInnerMm,
                    PIPE_SPEC_TABLES[d.headerSpecId] ?? pipeSpec
                  )} di)${d.exceedsCapacity ? ' !' : ''}`
                : '-',
              d.peakVelocityMs !== null ? d.peakVelocityMs.toFixed(2) : '-',
              d.minWorkingPressureBar !== null && d.maxWorkingPressureBar !== null
                ? `${d.minWorkingPressureBar.toFixed(2)} – ${d.maxWorkingPressureBar.toFixed(2)}`
                : '-',
              String(d.prvCount),
            ].map(toPdfSafeText)
          ),
    didParseCell: (data) => {
      if (data.section !== 'body' || dropperSummaries.length === 0) return;
      const d = dropperSummaries[data.row.index];
      if (!d) return;
      if (data.column.index === 1 && d.hasBoosterPump) {
        data.cell.styles.textColor = d.isCustomBoosterPressure ? [29, 78, 216] : [3, 105, 161];
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.column.index === 5) {
        if (d.exceedsCapacity) {
          data.cell.styles.textColor = [217, 0, 0];
          data.cell.styles.fontStyle = 'bold';
        } else if (d.headerIsFallbackMaterial) {
          data.cell.styles.textColor = [29, 78, 216];
          data.cell.styles.fontStyle = 'bold';
        }
      }
      if (
        data.column.index === 6 &&
        d.peakVelocityMs !== null &&
        d.peakVelocityMs > parameters.maxVelocityMs + 1e-4
      ) {
        data.cell.styles.textColor = [217, 0, 0];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  if (subDropperSummaries.length > 0) {
    const afterMainY =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4.5;
    autoTable(doc, {
      startY: afterMainY,
      margin: { left: 14, right: 14, top: 18, bottom: 16 },
      tableWidth: 269,
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 1.6,
        textColor: [18, 18, 18],
        lineColor: [224, 224, 224],
      },
      headStyles: { fillColor: [238, 238, 238], textColor: [18, 18, 18], fontStyle: 'bold' },
      head: [
        [
          'Sub-Dropper',
          'Feed & Branch',
          'Flow Mode',
          'Served Levels',
          'Zone LU',
          'Peak Flow (L/s)',
          'Pipe Sizing (Base -> Term / di)',
          'Peak Vel. (m/s)',
          'Working P (bar)',
          'PRVs',
        ].map(toPdfSafeText),
      ],
      body: subDropperSummaries.map((sd) => {
        const sdFallbackPrefix = sd.baseIsFallbackMaterial
          ? `${getPipeSpecBadgeLabel(sd.baseSpecId)} `
          : '';
        const sdBaseSpec = PIPE_SPEC_TABLES[sd.baseSpecId] ?? pipeSpec;
        const sdBaseDi =
          sd.baseInnerMm !== null ? ` (${formatPipeDim(sd.baseInnerMm, sdBaseSpec)} di)` : '';
        const sizingLabel = sd.baseNominalMm
          ? sd.terminalNominalMm && sd.terminalNominalMm !== sd.baseNominalMm
            ? `${sdFallbackPrefix}Ø${sd.baseNominalMm} -> Ø${sd.terminalNominalMm}${sdBaseDi}${
                sd.exceedsCapacity ? ' !' : ''
              }`
            : `${sdFallbackPrefix}Ø${sd.baseNominalMm}${sdBaseDi}${
                sd.exceedsCapacity ? ' !' : ''
              }`
          : '-';
        return [
          `↳ ${sd.label}`,
          `D${sd.parentDropperIndex} @ ${sd.branchFloorLabel}`,
          `${sd.flowOrientation} (${
            sd.hasBoosterPump
              ? `Booster +${(sd.boosterPressureBar ?? parameters.boosterPumpBoostBar).toFixed(2)}b${
                  sd.isCustomBoosterPressure ? '*' : ''
                }`
              : sd.zoneType
          })`,
          sd.servedFloorRange,
          formatLuDisplay(sd.totalZoneLu),
          sd.peakFlowRateLs.toFixed(2),
          sizingLabel,
          sd.peakVelocityMs !== null ? sd.peakVelocityMs.toFixed(2) : '-',
          sd.minWorkingPressureBar !== null && sd.maxWorkingPressureBar !== null
            ? `${sd.minWorkingPressureBar.toFixed(2)} – ${sd.maxWorkingPressureBar.toFixed(2)}`
            : '-',
          String(sd.prvCount),
        ].map(toPdfSafeText);
      }),
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const sd = subDropperSummaries[data.row.index];
        if (!sd) return;
        if (data.column.index === 6) {
          if (sd.exceedsCapacity) {
            data.cell.styles.textColor = [217, 0, 0];
            data.cell.styles.fontStyle = 'bold';
          } else if (sd.baseIsFallbackMaterial) {
            data.cell.styles.textColor = [29, 78, 216];
            data.cell.styles.fontStyle = 'bold';
          }
        }
        if (
          data.column.index === 7 &&
          sd.peakVelocityMs !== null &&
          sd.peakVelocityMs > parameters.maxVelocityMs + 1e-4
        ) {
          data.cell.styles.textColor = [217, 0, 0];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  if (prvList.length > 0) {
    const afterDroppersY =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4.5;
    autoTable(doc, {
      startY: afterDroppersY,
      margin: { left: 14, right: 14, top: 18, bottom: 16 },
      tableWidth: 269,
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 1.6,
        textColor: [18, 18, 18],
        lineColor: [224, 224, 224],
      },
      headStyles: { fillColor: [238, 238, 238], textColor: [18, 18, 18], fontStyle: 'bold' },
      head: [
        [
          'PRV Location',
          'Riser / Branch',
          'Upstream P1 (bar)',
          'Downstream P2 (bar)',
          'dP (bar)',
          'P1 / P2 Ratio',
          `Cavitation Check (<= ${cavLimitText})`,
          'Flow (L/s)',
          'Rec. Bore',
        ].map(toPdfSafeText),
      ],
      body: prvList.map((p) =>
        [
          `Floor ${p.floorLabel}${p.isManualOverride ? ' [Pin]' : ''}`,
          p.dropperName,
          p.upstreamPressureBar.toFixed(2),
          `${p.downstreamPressureBar.toFixed(2)}${p.isCustomSetPressure ? '*' : ''}`,
          p.deltaPressureBar.toFixed(2),
          p.pressureRatio.toFixed(2),
          p.cavitationWarning
            ? `ALERT: P1/P2 > ${cavLimitText} (Series PRV)`
            : `PASS (<= ${cavLimitText})`,
          p.flowRateLs.toFixed(2),
          `DN${p.recommendedValveDn}`,
        ].map(toPdfSafeText)
      ),
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const p = prvList[data.row.index];
        if (!p) return;
        if (data.column.index === 3 && p.isCustomSetPressure) {
          data.cell.styles.textColor = [29, 78, 216];
          data.cell.styles.fontStyle = 'bold';
        }
        if (data.column.index === 4) {
          data.cell.styles.textColor = [180, 83, 9];
        }
        if ((data.column.index === 5 || data.column.index === 6) && p.cavitationWarning) {
          data.cell.styles.textColor = [217, 0, 0];
          data.cell.styles.fontStyle = 'bold';
        } else if (data.column.index === 6) {
          data.cell.styles.textColor = [21, 128, 61];
        }
      },
    });
  }

  // Engineering Notice & Disclaimer Block (end of Summary & Design Basis)
  {
    let disclaimerY =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    const formattedClauses = DISCLAIMER_SECTIONS.map((s) => {
      const line = toPdfSafeText(`${s.number}. ${s.title}: ${s.body}`);
      return doc.splitTextToSize(line, 261) as string[];
    });
    const totalClauseLines = formattedClauses.reduce((acc, lines) => acc + lines.length, 0);
    const boxH = 8.5 + totalClauseLines * 3.15 + (formattedClauses.length - 1) * 1.2;

    if (disclaimerY + boxH > 192) {
      doc.addPage('a4', 'landscape');
      disclaimerY = 18;
    }

    doc.setFillColor(248, 248, 248);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    doc.rect(14, disclaimerY, 269, boxH, 'FD');

    doc.setDrawColor(18, 18, 18);
    doc.setLineWidth(0.9);
    doc.line(14, disclaimerY, 14, disclaimerY + boxH);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(18, 18, 18);
    doc.text('ENGINEERING NOTICE & DISCLAIMER (FREE PUBLIC CALCULATION TOOL)', 18, disclaimerY + 4.8);

    let textY = disclaimerY + 8.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(65, 65, 65);
    formattedClauses.forEach((lines, clauseIdx) => {
      lines.forEach((line) => {
        doc.text(line, 18, textY);
        textY += 3.15;
      });
      if (clauseIdx < formattedClauses.length - 1) {
        textY += 1.2;
      }
    });
  }

  // Page 2+: Floor-by-Floor Hydraulic & Pressure Calculation Schedule (A4 Landscape)
  doc.addPage('a4', 'landscape');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(18, 18, 18);
  doc.text('3. Floor-by-Floor Hydraulic & Static Pressure Calculation Schedule', 14, 20);
  const s3Subtitle = toPdfSafeText(
    `${standardLabel}: ${flowFormulaText}${isCustomFormula ? ' (Custom)' : ''}   |   P_static = H_static x 0.0981 [bar]   |   Cavitation: P1/P2 <= ${cavLimitText}${isCustomCavLimit ? ' (Custom)' : ''}   |   Spec: ${specSummaryText}`
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(doc.getTextWidth(s3Subtitle) > 269 ? 6.6 : 7.5);
  doc.setTextColor(85, 85, 85);
  doc.text(s3Subtitle, 14, 24.8, { maxWidth: 269 });

  const dropperCols = riserColumns.map((c) => toPdfSafeText(c.pdfPressureHeader));
  const sizeColHeader =
    riserColumns.length > 1
      ? riserColumns.map((c) => toPdfSafeText(c.pdfSizeHeader))
      : ['Pipe OD\n(mm)'];
  const totalScheduleCols = 12 + dropperCols.length + sizeColHeader.length;
  const schedFontSize =
    totalScheduleCols <= 15
      ? 6.8
      : totalScheduleCols <= 20
      ? 6.0
      : totalScheduleCols <= 26
      ? 5.2
      : totalScheduleCols <= 32
      ? 4.5
      : 4.1;
  const schedPadding =
    totalScheduleCols <= 15
      ? 1.3
      : totalScheduleCols <= 20
      ? 1.0
      : totalScheduleCols <= 26
      ? 0.8
      : totalScheduleCols <= 32
      ? 0.65
      : 0.5;

  autoTable(doc, {
    startY: 27.5,
    margin: { left: 14, right: 14, top: 20, bottom: 16 },
    tableWidth: 269,
    theme: 'grid',
    styles: {
      fontSize: schedFontSize,
      cellPadding: schedPadding,
      halign: 'right',
      textColor: [18, 18, 18],
      lineColor: [224, 224, 224],
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold' },
      4: { halign: 'center' },
    },
    headStyles: {
      fillColor: [238, 238, 238],
      textColor: [18, 18, 18],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: Math.max(4.5, schedFontSize - 0.2),
    },
    head: [
      [
        'Floor',
        'h\n(m)',
        'H_stat\n(m)',
        'P_stat\n(bar)',
        'Equip /\nFitting',
        'Q\n(L/s)',
        'dP\n(bar)',
        'P1/P2',
        'Floor\nLU',
        'Cum.\nLU',
        ...dropperCols,
        ...sizeColHeader,
        'di\n(mm)',
        'Vel.\n(m/s)',
      ],
    ],
    body:
      rows.length === 0
        ? [
            [
              {
                content: 'No floor rows present in the current project.',
                colSpan: totalScheduleCols,
                styles: { halign: 'center', textColor: [102, 102, 102] },
              },
            ],
          ]
        : rows.map((row) => {
            const isRoof = row.input.supplyMode === SupplyMode.ROOF_HEADER;
            const allPrvCells = [
              ...Object.values(row.dropperCells).filter((c) => c.hasPrv && c.prvDetail),
              ...Object.values(row.subDropperCells).filter((c) => c.hasPrv && c.prvDetail),
            ];
            const hasCavitation = allPrvCells.some((c) => c.prvDetail?.cavitationWarning);
            const velExceeded =
              row.primaryVelocityMs !== null &&
              row.primaryVelocityMs > parameters.maxVelocityMs + 1e-4;
            const primaryRowSpec = PIPE_SPEC_TABLES[row.primarySpecId] ?? pipeSpec;

            const pVals = riserColumns.map((col) => {
              const c =
                col.kind === 'main'
                  ? row.dropperCells[col.dropperIndex]
                  : row.subDropperCells[col.subDropperId];
              if (!c) return '';
              const overPressure =
                c.isServed &&
                c.workingPressureBar !== null &&
                c.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;
              if (c.hasPrv && c.prvDetail) {
                const p2Str = `${c.prvDetail.downstreamPressureBar.toFixed(2)}${
                  c.prvDetail.isCustomSetPressure ? '*' : ''
                }`;
                return c.isServed && c.workingPressureBar !== null
                  ? `${p2Str}${overPressure ? ' !' : ''}`
                  : `PRV ${p2Str}`;
              }
              if (c.isServed && c.workingPressureBar !== null) {
                return `${c.workingPressureBar.toFixed(2)}${overPressure ? ' !' : ''}`;
              }
              return c.isExpressPassThrough ? '|' : '';
            });

            const sVals =
              riserColumns.length > 1
                ? riserColumns.map((col) => {
                    const c =
                      col.kind === 'main'
                        ? row.dropperCells[col.dropperIndex]
                        : row.subDropperCells[col.subDropperId];
                    if (!c || c.selectedNominalMm === null) return '';
                    const prefix = c.isFallbackMaterial
                      ? `${getPipeSpecBadgeLabel(c.selectedSpecId)} `
                      : '';
                    return `${prefix}${c.selectedNominalMm}${
                      c.isExpressPassThrough && !isRoof ? '*' : ''
                    }${c.exceedsMaxPipeCapacity ? ' !' : ''}`;
                  })
                : [
                    row.primaryNominalMm !== null
                      ? `${
                          row.primaryIsFallbackMaterial
                            ? `${getPipeSpecBadgeLabel(row.primarySpecId)} `
                            : ''
                        }${row.primaryNominalMm}${velExceeded ? ' !' : ''}`
                      : '',
                  ];

            return [
              row.input.floorLabel,
              row.input.floorHeightM.toFixed(2),
              row.cumulativeHeadM.toFixed(2),
              row.staticPressureBar.toFixed(2),
              formatRowEquipmentDisplay(row, riserColumns.length, subDropperLabelMap, 'pdf'),
              row.primaryFlowRateLs !== null && row.primaryFlowRateLs > 0
                ? row.primaryFlowRateLs.toFixed(2)
                : '',
              formatRowDeltaPDisplay(row),
              row.primaryPrvRatio !== null
                ? `${row.primaryPrvRatio.toFixed(2)}${hasCavitation ? ' !' : ''}`
                : '',
              isRoof
                ? formatLuDisplay(row.primaryCumulativeLu)
                : row.isSplitFloor
                ? `[Split] ${formatLuDisplay(row.input.loadingUnits)}`
                : formatLuDisplay(row.input.loadingUnits),
              row.primaryCumulativeLu > 0 ? formatLuDisplay(row.primaryCumulativeLu) : '-',
              ...pVals,
              ...sVals,
              row.primaryInnerMm !== null ? formatPipeDim(row.primaryInnerMm, primaryRowSpec) : '',
              row.primaryVelocityMs !== null ? row.primaryVelocityMs.toFixed(2) : '',
            ].map(toPdfSafeText);
          }),
    didParseCell: (data) => {
      if (data.section !== 'body' || rows.length === 0) return;
      const row = rows[data.row.index];
      if (!row) return;
      const isRoof = row.input.supplyMode === SupplyMode.ROOF_HEADER;
      const allPrvCells = [
        ...Object.values(row.dropperCells).filter((c) => c.hasPrv && c.prvDetail),
        ...Object.values(row.subDropperCells).filter((c) => c.hasPrv && c.prvDetail),
      ];
      const hasAnyPrv = allPrvCells.length > 0;
      const hasCavitation = allPrvCells.some((c) => c.prvDetail?.cavitationWarning);
      const velExceeded =
        row.primaryVelocityMs !== null &&
        row.primaryVelocityMs > parameters.maxVelocityMs + 1e-4;

      if (isRoof) {
        data.cell.styles.fillColor = [245, 245, 245];
      } else if (hasAnyPrv) {
        data.cell.styles.fillColor = [255, 251, 235];
      }

      const colIdx = data.column.index;
      if (colIdx === 4) {
        if (hasAnyPrv) {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fontStyle = 'bold';
        } else if (row.isSplitFloor) {
          data.cell.styles.textColor = [29, 78, 216];
        } else if (row.equipmentTag === 'Pump') {
          data.cell.styles.textColor = [3, 105, 161];
        }
      } else if (colIdx === 6 && row.primaryDeltaPBar !== null) {
        if (row.primaryDeltaPBar < 0) data.cell.styles.textColor = [180, 83, 9];
        else if (row.primaryDeltaPBar > 0) {
          data.cell.styles.textColor = [3, 105, 161];
          data.cell.styles.fontStyle = 'bold';
        }
      } else if (colIdx === 7 && hasCavitation) {
        data.cell.styles.textColor = [217, 0, 0];
        data.cell.styles.fontStyle = 'bold';
      } else if (colIdx === 8 && row.isSplitFloor) {
        data.cell.styles.textColor = [29, 78, 216];
        data.cell.styles.fontStyle = 'bold';
      }

      const pStart = 10;
      const pEnd = pStart + riserColumns.length;
      if (colIdx >= pStart && colIdx < pEnd) {
        const col = riserColumns[colIdx - pStart];
        const c =
          col.kind === 'main'
            ? row.dropperCells[col.dropperIndex]
            : row.subDropperCells[col.subDropperId];
        const overPressure =
          c?.isServed &&
          c.workingPressureBar !== null &&
          c.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;
        if (overPressure) {
          data.cell.styles.textColor = [217, 0, 0];
          data.cell.styles.fontStyle = 'bold';
        } else if (c?.hasPrv && c.prvDetail) {
          data.cell.styles.textColor = c.prvDetail.isCustomSetPressure
            ? [30, 64, 175]
            : [146, 64, 14];
          data.cell.styles.fontStyle = 'bold';
        } else if (c?.isExpressPassThrough && !c?.isServed) {
          data.cell.styles.textColor = [170, 170, 170];
        }
      }

      const sStart = pEnd;
      const sCount = riserColumns.length > 1 ? riserColumns.length : 1;
      const sEnd = sStart + sCount;
      if (colIdx >= sStart && colIdx < sEnd) {
        if (riserColumns.length > 1) {
          const col = riserColumns[colIdx - sStart];
          const c =
            col.kind === 'main'
              ? row.dropperCells[col.dropperIndex]
              : row.subDropperCells[col.subDropperId];
          if (c?.exceedsMaxPipeCapacity) {
            data.cell.styles.textColor = [217, 0, 0];
            data.cell.styles.fontStyle = 'bold';
          } else if (c?.isFallbackMaterial) {
            data.cell.styles.textColor = [29, 78, 216];
            data.cell.styles.fontStyle = 'bold';
          }
        } else {
          if (velExceeded) {
            data.cell.styles.textColor = [217, 0, 0];
            data.cell.styles.fontStyle = 'bold';
          } else if (row.primaryIsFallbackMaterial) {
            data.cell.styles.textColor = [29, 78, 216];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }

      if (colIdx === sEnd + 1 && velExceeded) {
        data.cell.styles.textColor = [217, 0, 0];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Section 4 & 5: Vertical Riser Schematic & Static/Working Pressure Profile Diagrams
  if (rows.length > 0) {
    renderRiserSchematicToPdf(doc, result);
    renderPressureProfileToPdf(doc, result);
  }

  // Stamp consistent running header (pages 2+) and footer across every A4 page
  const totalPages = doc.getNumberOfPages();
  const basisNote = toPdfSafeText(
    `Calculation Basis (${standardLabel}): P_static = H x 0.0981 bar  |  ${flowFormulaText}${
      isCustomFormula ? ' [Custom]' : ''
    }  |  Cavitation Limit: P1/P2 <= ${cavLimitText}${isCustomCavLimit ? ' [Custom]' : ''}`
  );
  const runningHeaderLeft = toPdfSafeText(
    `${parameters.projectName}  |  Job No. ${parameters.projectRef}`
  );

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const pageSize = doc.internal.pageSize;
    const pW = pageSize.getWidth();
    const pH = pageSize.getHeight();

    if (p > 1) {
      const runningHeaderRight = 'HydroDrop Calc | Free Public Web Edition · Developed by J.H.WONG';
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      const rightHeaderWidth = doc.getTextWidth(runningHeaderRight);
      const leftHeaderMaxWidth = Math.max(40, pW - 28 - rightHeaderWidth - 8);
      doc.text(runningHeaderLeft, 14, 10, { maxWidth: leftHeaderMaxWidth });
      doc.text(runningHeaderRight, pW - 14, 10, {
        align: 'right',
      });
      doc.setDrawColor(212, 212, 212);
      doc.setLineWidth(0.25);
      doc.line(14, 12, pW - 14, 12);
    }

    // Bottom running footer
    const footerLineY = pH - 12;
    doc.setDrawColor(18, 18, 18);
    doc.setLineWidth(0.35);
    doc.line(14, footerLineY, pW - 14, footerLineY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(doc.getTextWidth(basisNote) > pW - 54 ? 6.2 : 7.0);
    doc.setTextColor(85, 85, 85);
    doc.text(basisNote, 14, footerLineY + 4.5, { maxWidth: pW - 52 });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.0);
    doc.setTextColor(18, 18, 18);
    doc.text(`Page ${p} of ${totalPages}`, pW - 14, footerLineY + 4.5, { align: 'right' });
  }

  return doc;
}

/**
 * Export formatted multi-page A4 Engineering Calculation Report in PDF (.pdf)
 */
export function exportCalculationToPdf(result: SystemCalculationResult): void {
  const doc = buildCalculationPdfDocument(result);
  const safeSlug =
    result.parameters.projectRef.replace(/[^a-zA-Z0-9_-]/g, '_') || 'DCW_Report';
  doc.save(`${safeSlug}_Engineering_Calculation_Report.pdf`);
}

/**
 * Parse imported CSV or Excel (.xlsx/.xls) file into FloorInputRow[]
 */
export async function parseImportedFloorFile(file: File): Promise<FloorInputRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('The uploaded spreadsheet contains no rows.');
  }

  const parsed: FloorInputRow[] = [];
  rawRows.forEach((raw, idx) => {
    const keys = Object.keys(raw);
    const findVal = (patterns: RegExp[]) => {
      for (const p of patterns) {
        const k = keys.find((key) => p.test(key.trim().toLowerCase()));
        if (k !== undefined) return raw[k];
      }
      return undefined;
    };

    const rawFloor = String(
      findVal([/^floor/, /^level/, /^storey/, /^name/]) ?? `L${rawRows.length - idx}`
    ).trim();
    if (!rawFloor) return;

    const rawHeight = Number(findVal([/height/, /^h\b/, /\(m\)/]) ?? 3.2);
    const rawLu = Number(findVal([/loading/, /\blu\b/, /fixture/, /unit/]) ?? 180);
    const rawMode = String(findVal([/mode/, /supply/, /zone/, /type/]) ?? '').toLowerCase();
    const rawDropper = Number(findVal([/dropper/, /riser/]) ?? 0);

    let supplyMode = SupplyMode.GRAVITY;
    if (rawFloor.toLowerCase().includes('roof') || rawMode.includes('roof') || rawMode.includes('header')) {
      supplyMode = SupplyMode.ROOF_HEADER;
    } else if (rawMode.includes('boost') || rawMode.includes('pump')) {
      supplyMode = SupplyMode.BOOSTER;
    }

    parsed.push({
      id: `imp-${Date.now()}-${idx}`,
      floorLabel: rawFloor,
      floorHeightM: Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 3.1,
      supplyMode,
      loadingUnits:
        supplyMode === SupplyMode.ROOF_HEADER
          ? 0
          : Number.isFinite(rawLu) && rawLu >= 0
          ? rawLu
          : 0,
      prvOverride: PrvOverrideMode.AUTO,
      manualDropperIndex:
        Number.isFinite(rawDropper) && rawDropper >= 1
          ? Math.round(rawDropper)
          : supplyMode === SupplyMode.BOOSTER
          ? 1
          : 2,
    });
  });

  if (parsed.length === 0) {
    throw new Error('Could not parse valid floor rows from file.');
  }

  return parsed;
}

/**
 * Download clean CSV floor input template
 */
export function downloadCsvTemplate(floors: FloorInputRow[]): void {
  const header = ['Floor Level', 'Floor Height (m)', 'Supply Mode', 'Loading Units (LU)', 'Manual Dropper'];
  const lines = [
    header.join(','),
    ...floors.map((f) =>
      [
        `"${f.floorLabel.replace(/"/g, '""')}"`,
        f.floorHeightM.toFixed(2),
        f.supplyMode === SupplyMode.ROOF_HEADER
          ? 'Roof Header'
          : f.supplyMode === SupplyMode.BOOSTER
          ? 'Booster'
          : 'Gravity',
        f.loadingUnits,
        f.manualDropperIndex ?? 1,
      ].join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'DCW_Building_Floors_Template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Helper used in Pipe Spec Lookup View for live capacity display
 */
export function getMaxFlowAndLuForDiameter(
  innerDiaMm: number,
  maxVelocityMs: number,
  flowFormula?: FlowConversionFormula,
  standard?: DesignStandard
) {
  const areaM2 = calculatePipeAreaM2(innerDiaMm);
  const qMaxLs = maxVelocityMs * areaM2 * 1000;
  const luMax = calculateMaxLuFromFlowRate(qMaxLs, flowFormula, standard);
  const checkQ = calculateFlowRateFromLu(luMax, flowFormula, standard);
  return {
    areaCm2: areaM2 * 10000,
    qMaxLs,
    luMax: checkQ > 0 ? luMax : 0,
  };
}

import { jsPDF } from 'jspdf';
import { formatPipeDim, getPipeSpecBadgeLabel, PIPE_SPEC_TABLES } from '../data/pipeSpecs';
import {
  DropperZoneSummary,
  RiserTarget,
  SubDropperSummary,
  SupplyMode,
  SystemCalculationResult,
} from '../types/hydraulics';
import { formatLuDisplay, toPdfSafeText } from './calculations';

type Rgb = [number, number, number];

const DROPPER_RGB: Rgb[] = [
  [18, 18, 18],
  [3, 105, 161],
  [29, 78, 216],
  [15, 118, 110],
  [124, 45, 18],
  [190, 24, 93],
  [109, 40, 217],
  [67, 56, 202],
];

const SUB_DROPPER_RGB: Rgb[] = [
  [8, 145, 178],
  [124, 58, 237],
  [5, 150, 105],
  [194, 65, 12],
  [2, 132, 199],
  [190, 18, 60],
];

interface OrderedPdfColumn {
  kind: 'main' | 'sub';
  key: string;
  target: RiserTarget;
  shortLabel: string;
  rgb: Rgb;
  mainSummary?: DropperZoneSummary;
  subSummary?: SubDropperSummary;
}

function buildOrderedPdfColumns(result: SystemCalculationResult): OrderedPdfColumn[] {
  const cols: OrderedPdfColumn[] = [];
  let subCursor = 0;
  const usedSubIds = new Set<string>();

  for (const d of result.dropperSummaries) {
    cols.push({
      kind: 'main',
      key: `main-${d.dropperIndex}`,
      target: { kind: 'main', dropperIndex: d.dropperIndex },
      shortLabel: `D${d.dropperIndex}`,
      rgb: DROPPER_RGB[(d.dropperIndex - 1) % DROPPER_RGB.length],
      mainSummary: d,
    });
    for (const sd of result.subDropperSummaries) {
      if (sd.parentDropperIndex === d.dropperIndex) {
        usedSubIds.add(sd.id);
        cols.push({
          kind: 'sub',
          key: `sub-${sd.id}`,
          target: { kind: 'sub', subDropperId: sd.id },
          shortLabel: sd.label,
          rgb: SUB_DROPPER_RGB[subCursor % SUB_DROPPER_RGB.length],
          subSummary: sd,
        });
        subCursor += 1;
      }
    }
  }

  for (const sd of result.subDropperSummaries) {
    if (!usedSubIds.has(sd.id)) {
      cols.push({
        kind: 'sub',
        key: `sub-${sd.id}`,
        target: { kind: 'sub', subDropperId: sd.id },
        shortLabel: sd.label,
        rgb: SUB_DROPPER_RGB[subCursor % SUB_DROPPER_RGB.length],
        subSummary: sd,
      });
      subCursor += 1;
    }
  }

  return cols;
}

function drawSplitCircle(doc: jsPDF, cx: number, cy: number, r: number, rgb: Rgb): void {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(0.35);
  doc.circle(cx, cy, r, 'FD');

  // Left half fill (12-segment fan approximation inside semicircle)
  const steps = 10;
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  for (let i = 0; i < steps; i++) {
    const a1 = Math.PI / 2 + (i / steps) * Math.PI;
    const a2 = Math.PI / 2 + ((i + 1) / steps) * Math.PI;
    doc.triangle(
      cx,
      cy,
      cx + r * Math.cos(a1),
      cy + r * Math.sin(a1),
      cx + r * Math.cos(a2),
      cy + r * Math.sin(a2),
      'F'
    );
  }
}

function drawPumpIcon(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  isCustom: boolean
): void {
  const accent: Rgb = isCustom ? [29, 78, 216] : [3, 105, 161];
  const fillBg: Rgb = isCustom ? [238, 242, 255] : [224, 242, 254];
  doc.setFillColor(fillBg[0], fillBg[1], fillBg[2]);
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(isCustom ? 0.45 : 0.35);
  doc.circle(cx, cy, r, 'FD');

  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.triangle(
    cx - r * 0.35,
    cy - r * 0.42,
    cx + r * 0.52,
    cy,
    cx - r * 0.35,
    cy + r * 0.42,
    'F'
  );
  if (isCustom) {
    doc.setFillColor(29, 78, 216);
    doc.circle(cx + r * 0.72, cy - r * 0.72, 0.7, 'F');
  }
}

function drawPrvStationNode(
  doc: jsPDF,
  x: number,
  y: number,
  isCavitation: boolean,
  isCustomSet: boolean
): void {
  const fillBg: Rgb = isCavitation
    ? [254, 242, 242]
    : isCustomSet
    ? [239, 246, 255]
    : [255, 251, 235];
  const strokeCol: Rgb = isCavitation
    ? [220, 38, 38]
    : isCustomSet
    ? [29, 78, 216]
    : [217, 119, 6];
  const textCol: Rgb = isCavitation
    ? [153, 27, 27]
    : isCustomSet
    ? [30, 64, 175]
    : [146, 64, 14];
  const bowtieCol: Rgb = isCavitation ? [220, 38, 38] : [217, 119, 6];

  // PRV badge left of bowtie
  doc.setFillColor(fillBg[0], fillBg[1], fillBg[2]);
  doc.setDrawColor(strokeCol[0], strokeCol[1], strokeCol[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(x - 7.8, y - 1.75, 5.8, 3.5, 0.6, 0.6, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.2);
  doc.setTextColor(textCol[0], textCol[1], textCol[2]);
  doc.text('PRV', x - 4.9, y + 0.65, { align: 'center' });

  // Bowtie triangles
  doc.setFillColor(bowtieCol[0], bowtieCol[1], bowtieCol[2]);
  doc.triangle(x - 1.5, y - 1.3, x + 1.5, y - 1.3, x, y, 'F');
  doc.triangle(x - 1.5, y + 1.3, x + 1.5, y + 1.3, x, y, 'F');

  if (isCustomSet) {
    doc.setFillColor(29, 78, 216);
    doc.circle(x - 7.8, y - 1.75, 0.6, 'F');
  }
}

/**
 * Renders Section 4A: Vertical DCW Dropper Riser Schematic (vector) onto A4 page(s).
 */
export function renderRiserSchematicToPdf(
  doc: jsPDF,
  result: SystemCalculationResult
): void {
  const { rows, parameters, pipeHeader, pipeSpec, optionalPipeSpec } = result;
  if (rows.length === 0) return;

  const cols = buildOrderedPdfColumns(result);
  const orientation = cols.length > 5 ? 'landscape' : 'portrait';
  const pageW = orientation === 'landscape' ? 297 : 210;
  const pageH = orientation === 'landscape' ? 210 : 297;
  const marginX = 14;
  const contentW = pageW - marginX * 2;
  const contentRight = marginX + contentW;

  const colIndexByKey = new Map<string, number>();
  cols.forEach((c, i) => colIndexByKey.set(c.key, i));

  // Column x layout: left label area + evenly spaced risers
  const leftAreaW = Math.min(34, Math.max(26, contentW * 0.16));
  const rightAreaPad = 18;
  const numCols = Math.max(1, cols.length);
  const riserAreaW = contentW - leftAreaW - rightAreaPad;
  const colSpacing = numCols === 1 ? 0 : riserAreaW / numCols;
  const colX = (idx: number) =>
    numCols === 1
      ? marginX + leftAreaW + riserAreaW * 0.42
      : marginX + leftAreaW + (idx + 0.5) * colSpacing;

  const lastMainIdx = cols.reduce((acc, c, i) => (c.kind === 'main' ? i : acc), 0);

  // Determine vertical row height and pagination cleanly
  const topTitleY = 20;
  const legendH = 7;
  const tankHeaderH = 24;
  const contHeaderH = 8;
  const bottomFooterReserve = 16;
  const bottomLabelsH = 7;

  // Choose rowH so 32 rows fit cleanly on Page 1 portrait if possible
  const page1AvailForRows =
    pageH - bottomFooterReserve - (topTitleY + 4 + legendH + tankHeaderH + bottomLabelsH + 2);
  const preferredRowH = orientation === 'portrait' ? 6.2 : 5.4;
  let rowH = preferredRowH;
  if (rows.length <= 34 && rows.length * 5.6 <= page1AvailForRows) {
    rowH = Math.min(6.4, page1AvailForRows / rows.length);
  } else {
    rowH = orientation === 'portrait' ? 5.8 : 5.1;
  }

  // Paginate rows into chunks
  const pages: { startIdx: number; endIdx: number; isFirst: boolean }[] = [];
  let cursor = 0;
  while (cursor < rows.length) {
    const isFirst = pages.length === 0;
    const bodyStartY = isFirst
      ? topTitleY + 4 + legendH + tankHeaderH
      : topTitleY + 4 + contHeaderH;
    const isPotentiallyLast = true;
    const maxBodyH =
      pageH - bottomFooterReserve - (isPotentiallyLast ? bottomLabelsH : 2) - bodyStartY;
    const maxRowsFit = Math.max(8, Math.floor(maxBodyH / rowH));
    const endIdx = Math.min(rows.length, cursor + maxRowsFit);
    pages.push({ startIdx: cursor, endIdx, isFirst });
    cursor = endIdx;
  }

  const headerSpec = PIPE_SPEC_TABLES[pipeHeader.specId] ?? pipeSpec;
  const headerBadge = getPipeSpecBadgeLabel(pipeHeader.specId);
  const tankSpecText = optionalPipeSpec
    ? `${getPipeSpecBadgeLabel(pipeSpec.id)} / ${getPipeSpecBadgeLabel(optionalPipeSpec.id)}`
    : pipeSpec.shortName ?? pipeSpec.fullName;

  pages.forEach((pg, pageIdx) => {
    doc.addPage('a4', orientation);
    const isLastPage = pageIdx === pages.length - 1;

    // Section heading
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(18, 18, 18);
    doc.text(
      toPdfSafeText(
        pg.isFirst
          ? '4. Vertical DCW Dropper Riser Schematic'
          : `4. Vertical DCW Dropper Riser Schematic (Cont. ${pageIdx + 1}/${pages.length})`
      ),
      marginX,
      topTitleY
    );

    let yCursor = topTitleY + 3.5;

    if (pg.isFirst) {
      // Compact Schematic Legend Strip
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(224, 224, 224);
      doc.setLineWidth(0.25);
      doc.rect(marginX, yCursor, contentW, legendH, 'FD');

      const ly = yCursor + 4.3;
      let lx = marginX + 3;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(65, 65, 65);

      // Header symbol
      const hdrRgb: Rgb = pipeHeader.exceedsMaxCapacity
        ? [220, 38, 38]
        : pipeHeader.isCustomSize || pipeHeader.isFallbackMaterial
        ? [29, 78, 216]
        : [18, 18, 18];
      doc.setDrawColor(hdrRgb[0], hdrRgb[1], hdrRgb[2]);
      doc.setLineWidth(1.1);
      doc.line(lx, ly - 0.8, lx + 4.5, ly - 0.8);
      doc.text('Pipe Header', lx + 6, ly);
      lx += 24;

      // Full tap dot
      doc.setFillColor(18, 18, 18);
      doc.circle(lx + 1.2, ly - 0.8, 1.0, 'F');
      doc.text('Full Tap-Off', lx + 3.5, ly);
      lx += 21;

      // Split tap dot
      drawSplitCircle(doc, lx + 1.2, ly - 0.8, 1.1, [18, 18, 18]);
      doc.text('Split Tap-Off', lx + 3.5, ly);
      lx += 22;

      // Express pass-through
      doc.setDrawColor(100, 100, 100);
      doc.setLineWidth(0.45);
      doc.setLineDashPattern([1.2, 0.9], 0);
      doc.line(lx, ly - 0.8, lx + 4.5, ly - 0.8);
      doc.setLineDashPattern([], 0);
      doc.text('Express Pass-Through', lx + 6, ly);
      lx += 33;

      // PRV Bowtie
      doc.setFillColor(217, 119, 6);
      doc.triangle(lx, ly - 2.0, lx + 3.0, ly - 2.0, lx + 1.5, ly - 0.8, 'F');
      doc.triangle(lx, ly + 0.4, lx + 3.0, ly + 0.4, lx + 1.5, ly - 0.8, 'F');
      doc.text('PRV Station', lx + 4.5, ly);
      lx += 22;

      // Booster Pump
      drawPumpIcon(doc, lx + 1.5, ly - 0.8, 1.4, false);
      doc.text('Booster Pump', lx + 4.2, ly);

      yCursor += legendH + 2;

      // Roof Storage Tank + Pipe Header Assembly
      const tankX = marginX + 1;
      const tankY = yCursor;
      const tankW = Math.min(34, leftAreaW + 6);
      const tankH = 11.5;
      const tankRight = tankX + tankW;
      const headerBusY = tankY + 9.2;
      const mainPumpY = tankY + 17.5;
      const headerEndX = Math.max(tankRight + 10, colX(lastMainIdx) + 4);

      // Tank box + water fill
      doc.setFillColor(248, 248, 248);
      doc.setDrawColor(18, 18, 18);
      doc.setLineWidth(0.4);
      doc.rect(tankX, tankY, tankW, tankH, 'FD');
      doc.setFillColor(224, 242, 254);
      doc.rect(tankX + 0.3, tankY + 3, tankW - 0.6, tankH - 3.3, 'F');
      doc.setDrawColor(3, 105, 161);
      doc.setLineWidth(0.25);
      doc.setLineDashPattern([1.2, 0.8], 0);
      doc.line(tankX + 1, tankY + 3, tankRight - 1, tankY + 3);
      doc.setLineDashPattern([], 0);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.8);
      doc.setTextColor(18, 18, 18);
      doc.text('ROOF STORAGE TANK', tankX + tankW / 2, tankY + 6.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.2);
      doc.setTextColor(85, 85, 85);
      doc.text(toPdfSafeText(tankSpecText), tankX + tankW / 2, tankY + 9.8, { align: 'center' });

      // Header Pipe Bus
      doc.setDrawColor(hdrRgb[0], hdrRgb[1], hdrRgb[2]);
      doc.setLineWidth(1.35);
      doc.line(tankRight, headerBusY, headerEndX, headerBusY);
      doc.setLineWidth(0.6);
      doc.line(tankRight, headerBusY - 1.6, tankRight, headerBusY + 1.6);
      doc.line(headerEndX, headerBusY - 1.3, headerEndX, headerBusY + 1.3);

      // Header Label
      const hdrCenterX = Math.max(tankRight + 24, (tankRight + headerEndX) / 2);
      const headerHeadline = pipeHeader.nominalMm
        ? `PIPE HEADER ${pipeHeader.isFallbackMaterial ? `${headerBadge} ` : ''}Ø${
            pipeHeader.nominalMm
          } mm${pipeHeader.isCustomSize ? ' [Custom]' : ''}${
            pipeHeader.exceedsMaxCapacity ? ` (> ${pipeHeader.maxVelocityMs.toFixed(1)} m/s)` : ''
          }`
        : 'PIPE HEADER';
      const headerSubline = pipeHeader.nominalMm
        ? `di ${formatPipeDim(pipeHeader.innerMm, headerSpec)} mm · ${formatLuDisplay(
            pipeHeader.totalLu
          )} LU · ${pipeHeader.flowRateLs.toFixed(2)} L/s · ${
            pipeHeader.velocityMs !== null
              ? `${pipeHeader.velocityMs.toFixed(2)}/${pipeHeader.maxVelocityMs.toFixed(1)} m/s`
              : '-'
          }`
        : `${formatLuDisplay(pipeHeader.totalLu)} LU · ${pipeHeader.flowRateLs.toFixed(2)} L/s`;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(hdrRgb[0], hdrRgb[1], hdrRgb[2]);
      doc.text(toPdfSafeText(headerHeadline), hdrCenterX, tankY + 3.6, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(
        pipeHeader.exceedsMaxCapacity ? 185 : 85,
        pipeHeader.exceedsMaxCapacity ? 28 : 85,
        pipeHeader.exceedsMaxCapacity ? 28 : 85
      );
      doc.text(toPdfSafeText(headerSubline), hdrCenterX, tankY + 6.9, { align: 'center' });

      const firstRowY = yCursor + tankHeaderH + rowH / 2;

      // Vertical connections from Header Bus down to Row 0 + Main Pumps
      cols.forEach((col, cIdx) => {
        if (col.kind !== 'main' || !col.mainSummary) return;
        const x = colX(cIdx);
        doc.setDrawColor(col.rgb[0], col.rgb[1], col.rgb[2]);
        doc.setLineWidth(0.6);
        doc.line(x, headerBusY, x, firstRowY);
        doc.setFillColor(col.rgb[0], col.rgb[1], col.rgb[2]);
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.25);
        doc.circle(x, headerBusY, 0.9, 'FD');

        if (col.mainSummary.hasBoosterPump) {
          const effBoost =
            col.mainSummary.boosterPressureBar ?? parameters.boosterPumpBoostBar;
          const isCustom = col.mainSummary.isCustomBoosterPressure;
          drawPumpIcon(doc, x, mainPumpY, 2.2, isCustom);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5.5);
          doc.setTextColor(isCustom ? 29 : 3, isCustom ? 78 : 105, isCustom ? 216 : 161);
          doc.text(
            `+${effBoost.toFixed(1)}b${isCustom ? '*' : ''}`,
            x + 3.0,
            mainPumpY + 0.8
          );
        }
      });

      yCursor += tankHeaderH;
    } else {
      // Continuation page column header bar
      doc.setFillColor(245, 245, 245);
      doc.setDrawColor(212, 212, 212);
      doc.setLineWidth(0.25);
      doc.rect(marginX, yCursor, contentW, contHeaderH, 'FD');
      cols.forEach((col, cIdx) => {
        const x = colX(cIdx);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(col.rgb[0], col.rgb[1], col.rgb[2]);
        doc.text(toPdfSafeText(col.shortLabel), x, yCursor + 4.8, { align: 'center' });
      });
      yCursor += contHeaderH;
    }

    const rowY = (globalRowIdx: number) =>
      yCursor + (globalRowIdx - pg.startIdx) * rowH + rowH / 2;

    // 1. Floor Elevation Bands & Labels
    for (let rIdx = pg.startIdx; rIdx < pg.endIdx; rIdx++) {
      const r = rows[rIdx];
      const y = rowY(rIdx);
      const isRoof = r.input.supplyMode === SupplyMode.ROOF_HEADER;

      if (rIdx % 2 === 1) {
        doc.setFillColor(250, 250, 250);
        doc.rect(marginX, y - rowH / 2, contentW, rowH, 'F');
      }
      doc.setDrawColor(232, 232, 232);
      doc.setLineWidth(0.2);
      doc.line(marginX, y + rowH / 2, contentRight, y + rowH / 2);

      doc.setFont('helvetica', isRoof ? 'bold' : 'bold');
      doc.setFontSize(6.4);
      doc.setTextColor(18, 18, 18);
      doc.text(toPdfSafeText(r.input.floorLabel), marginX + 1.5, y + 0.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.0);
      doc.setTextColor(100, 100, 100);
      doc.text(`${r.cumulativeHeadM.toFixed(2)}m`, marginX + leftAreaW - 2, y + 0.8, {
        align: 'right',
      });
    }

    // 2. Render Main & Sub-Dropper Columns for rows in [pg.startIdx, pg.endIdx)
    cols.forEach((col, cIdx) => {
      const x = colX(cIdx);
      const rgb = col.rgb;

      if (col.kind === 'main' && col.mainSummary) {
        const dIdx = col.mainSummary.dropperIndex;

        for (let rIdx = pg.startIdx; rIdx < pg.endIdx; rIdx++) {
          const r = rows[rIdx];
          const cell = r.dropperCells[dIdx];
          if (!cell) continue;
          const y = rowY(rIdx);
          const isRoof = r.input.supplyMode === SupplyMode.ROOF_HEADER;

          // Segment connecting from previous row inside this page (or continuation header at top of page)
          const cellSpecW = cell.selectedNominalMm
            ? Math.max(0.45, Math.min(1.25, cell.selectedNominalMm / 130))
            : 0.45;
          doc.setDrawColor(
            cell.exceedsMaxPipeCapacity ? 220 : rgb[0],
            cell.exceedsMaxPipeCapacity ? 38 : rgb[1],
            cell.exceedsMaxPipeCapacity ? 38 : rgb[2]
          );
          doc.setLineWidth(cellSpecW);
          if (cell.isExpressPassThrough) {
            doc.setLineDashPattern([1.2, 0.9], 0);
          }
          if (rIdx > pg.startIdx) {
            const prevCell = rows[rIdx - 1].dropperCells[dIdx];
            if (prevCell) {
              doc.line(x, rowY(rIdx - 1), x, y);
            }
          } else if (!pg.isFirst && rIdx > 0 && rows[rIdx - 1].dropperCells[dIdx]) {
            doc.line(x, yCursor, x, y);
          }
          if (!isLastPage && rIdx === pg.endIdx - 1 && rows[rIdx + 1]?.dropperCells[dIdx]) {
            doc.line(x, y, x, y + rowH / 2);
          }
          doc.setLineDashPattern([], 0);

          const prevGlobalCell = rIdx > 0 ? rows[rIdx - 1].dropperCells[dIdx] : null;
          const sizeChanged =
            !isRoof &&
            cell.selectedNominalMm !== null &&
            (!prevGlobalCell ||
              prevGlobalCell.selectedNominalMm !== cell.selectedNominalMm ||
              prevGlobalCell.selectedSpecId !== cell.selectedSpecId ||
              rows[rIdx - 1]?.input.supplyMode === SupplyMode.ROOF_HEADER);

          // Pipe OD / di callout on size changes
          if (sizeChanged && cell.selectedNominalMm) {
            const cRgb: Rgb = cell.exceedsMaxPipeCapacity
              ? [220, 38, 38]
              : cell.isFallbackMaterial
              ? [29, 78, 216]
              : [15, 23, 42];
            const odLabel = `${
              cell.isFallbackMaterial ? `${getPipeSpecBadgeLabel(cell.selectedSpecId)} ` : ''
            }Ø${cell.selectedNominalMm}${cell.exceedsMaxPipeCapacity ? '!' : ''}`;
            const labelY = rIdx === 0 && cell.hasPrv ? y + 2.8 : y + 0.2;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(5.6);
            doc.setTextColor(cRgb[0], cRgb[1], cRgb[2]);
            doc.text(toPdfSafeText(odLabel), x - 1.5, labelY, { align: 'right' });

            if (cell.selectedInnerMm !== null) {
              const cellSpec = PIPE_SPEC_TABLES[cell.selectedSpecId] ?? pipeSpec;
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(4.6);
              doc.setTextColor(
                cell.exceedsMaxPipeCapacity ? 220 : cell.isFallbackMaterial ? 29 : 100,
                cell.exceedsMaxPipeCapacity ? 38 : cell.isFallbackMaterial ? 78 : 116,
                cell.exceedsMaxPipeCapacity ? 38 : cell.isFallbackMaterial ? 216 : 139
              );
              doc.text(
                toPdfSafeText(`di ${formatPipeDim(cell.selectedInnerMm, cellSpec)}`),
                x - 1.5,
                labelY + 1.9,
                { align: 'right' }
              );
            }
          }

          // Served floor tap-off branch & working pressure
          const overPressure =
            cell.workingPressureBar !== null &&
            cell.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;
          if (cell.isServed) {
            const tapLen = 4.2;
            doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
            doc.setLineWidth(0.42);
            doc.line(x, y, x + tapLen, y);
            if (cell.isSplitLoad) {
              drawSplitCircle(doc, x + tapLen, y, 0.9, rgb);
            } else {
              doc.setFillColor(rgb[0], rgb[1], rgb[2]);
              doc.circle(x + tapLen, y, 0.72, 'F');
            }

            if (cell.workingPressureBar !== null) {
              const isAlert = overPressure || Boolean(cell.prvDetail?.cavitationWarning);
              const pText =
                cell.hasPrv && cell.prvDetail
                  ? `${cell.prvDetail.upstreamPressureBar.toFixed(1)}->${cell.prvDetail.downstreamPressureBar.toFixed(1)}b${
                      cell.prvDetail.isCustomSetPressure ? '*' : ''
                    }${overPressure ? '!' : ''}`
                  : `${cell.workingPressureBar.toFixed(2)}b${overPressure ? '!' : ''}`;
              const splitSuffix = cell.isSplitLoad
                ? ` ·${Math.round(cell.loadFraction * 100)}%`
                : '';

              doc.setFont('helvetica', isAlert ? 'bold' : 'normal');
              doc.setFontSize(5.4);
              doc.setTextColor(isAlert ? 220 : 51, isAlert ? 38 : 65, isAlert ? 38 : 85);
              doc.text(toPdfSafeText(`${pText}${splitSuffix}`), x + tapLen + 1.6, y + 0.7);
            }
          } else if (cell.hasPrv && cell.prvDetail) {
            const isCav = cell.prvDetail.cavitationWarning;
            doc.setFont('helvetica', isCav ? 'bold' : 'normal');
            doc.setFontSize(5.4);
            doc.setTextColor(isCav ? 220 : 51, isCav ? 38 : 65, isCav ? 38 : 85);
            doc.text(
              toPdfSafeText(
                `${cell.prvDetail.upstreamPressureBar.toFixed(1)}->${cell.prvDetail.downstreamPressureBar.toFixed(1)}b${
                  cell.prvDetail.isCustomSetPressure ? '*' : ''
                }`
              ),
              x + 3.0,
              y + 0.7
            );
          }

          // PRV Station Node (drawn at top boundary of floor band)
          if (cell.hasPrv && cell.prvDetail) {
            const prvY = rIdx > 0 ? y - rowH / 2 : y;
            drawPrvStationNode(
              doc,
              x,
              prvY,
              cell.prvDetail.cavitationWarning,
              cell.prvDetail.isCustomSetPressure
            );
          }
        }
      } else if (col.kind === 'sub' && col.subSummary) {
        const sd = col.subSummary;
        const parentKey = `main-${sd.parentDropperIndex}`;
        const parentColIdx = colIndexByKey.get(parentKey) ?? 0;
        const parentX = colX(parentColIdx);

        // Collect all evaluated row indices globally for terminal cap check
        const evalGlobalIndices: number[] = [];
        rows.forEach((r, idx) => {
          if (r.subDropperCells[sd.id]) evalGlobalIndices.push(idx);
        });
        const minEvalGlobal = evalGlobalIndices[0] ?? sd.branchRowIdx;
        const maxEvalGlobal =
          evalGlobalIndices[evalGlobalIndices.length - 1] ?? sd.branchRowIdx;

        // Horizontal branch feed line if branchRowIdx is on this page
        if (sd.branchRowIdx >= pg.startIdx && sd.branchRowIdx < pg.endIdx) {
          const branchY = rowY(sd.branchRowIdx);
          const branchHasPrv = Boolean(rows[sd.branchRowIdx]?.subDropperCells[sd.id]?.hasPrv);

          doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
          doc.setLineWidth(0.55);
          doc.line(parentX, branchY, x, branchY);

          // Takeoff dot on parent
          doc.setFillColor(rgb[0], rgb[1], rgb[2]);
          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(0.25);
          doc.circle(parentX, branchY, 1.0, 'FD');

          // Arrow chevron pointing into sub-dropper
          const arrowX = branchHasPrv ? x - 9 : x - 2.2;
          doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
          doc.setLineWidth(0.4);
          doc.line(arrowX - 1.3, branchY - 0.8, arrowX, branchY);
          doc.line(arrowX - 1.3, branchY + 0.8, arrowX, branchY);

          // Inline Booster Pump on horizontal branch
          if (sd.hasBoosterPump) {
            const effSubBoost = sd.boosterPressureBar ?? parameters.boosterPumpBoostBar;
            const isCustomSub = sd.isCustomBoosterPressure;
            const spanRight = branchHasPrv ? x - 10 : x - 3.5;
            const pumpCx =
              spanRight - parentX >= 8 ? parentX + (spanRight - parentX) * 0.5 : (parentX + x) * 0.5;
            drawPumpIcon(doc, pumpCx, branchY, 1.9, isCustomSub);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(5.0);
            doc.setTextColor(
              isCustomSub ? 29 : 3,
              isCustomSub ? 78 : 105,
              isCustomSub ? 216 : 161
            );
            doc.text(`+${effSubBoost.toFixed(1)}b${isCustomSub ? '*' : ''}`, pumpCx, branchY - 2.4, {
              align: 'center',
            });
          }
        }

        // Vertical segments visible on this page
        const pageEvalIndices = evalGlobalIndices.filter(
          (idx) => idx >= pg.startIdx && idx < pg.endIdx
        );
        for (let i = 1; i < pageEvalIndices.length; i++) {
          const upperR = pageEvalIndices[i - 1];
          const lowerR = pageEvalIndices[i];
          const segCell =
            lowerR <= sd.branchRowIdx
              ? rows[upperR].subDropperCells[sd.id]
              : rows[lowerR].subDropperCells[sd.id];
          if (!segCell) continue;
          const segW = segCell.selectedNominalMm
            ? Math.max(0.45, Math.min(1.2, segCell.selectedNominalMm / 130))
            : 0.45;
          doc.setDrawColor(
            segCell.exceedsMaxPipeCapacity ? 220 : rgb[0],
            segCell.exceedsMaxPipeCapacity ? 38 : rgb[1],
            segCell.exceedsMaxPipeCapacity ? 38 : rgb[2]
          );
          doc.setLineWidth(segW);
          if (segCell.isExpressPassThrough) {
            doc.setLineDashPattern([1.2, 0.9], 0);
          }
          doc.line(x, rowY(upperR), x, rowY(lowerR));
          doc.setLineDashPattern([], 0);
        }

        // Terminal caps
        if (
          minEvalGlobal < sd.branchRowIdx &&
          minEvalGlobal >= pg.startIdx &&
          minEvalGlobal < pg.endIdx
        ) {
          doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
          doc.setLineWidth(0.55);
          doc.line(x - 1.4, rowY(minEvalGlobal), x + 1.4, rowY(minEvalGlobal));
        }
        if (
          maxEvalGlobal > sd.branchRowIdx &&
          maxEvalGlobal >= pg.startIdx &&
          maxEvalGlobal < pg.endIdx
        ) {
          doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
          doc.setLineWidth(0.55);
          doc.line(x - 1.4, rowY(maxEvalGlobal), x + 1.4, rowY(maxEvalGlobal));
        }

        // Floor nodes, callouts, tap-offs, PRVs
        for (const rIdx of pageEvalIndices) {
          const r = rows[rIdx];
          const cell = r.subDropperCells[sd.id];
          if (!cell) continue;
          const y = rowY(rIdx);

          const showSizeCallout = (() => {
            if (!cell.selectedNominalMm) return false;
            if (rIdx === sd.branchRowIdx) return true;
            if (rIdx < sd.branchRowIdx) {
              const below = rows[rIdx + 1]?.subDropperCells[sd.id];
              return (
                rIdx === minEvalGlobal ||
                !below ||
                below.selectedNominalMm !== cell.selectedNominalMm ||
                below.selectedSpecId !== cell.selectedSpecId
              );
            }
            const above = rows[rIdx - 1]?.subDropperCells[sd.id];
            return (
              rIdx === maxEvalGlobal ||
              !above ||
              above.selectedNominalMm !== cell.selectedNominalMm ||
              above.selectedSpecId !== cell.selectedSpecId
            );
          })();

          if (showSizeCallout && cell.selectedNominalMm) {
            const isBranchRow = rIdx === sd.branchRowIdx;
            const cRgb: Rgb = cell.exceedsMaxPipeCapacity
              ? [220, 38, 38]
              : cell.isFallbackMaterial
              ? [29, 78, 216]
              : [15, 23, 42];
            const odText = `${
              cell.isFallbackMaterial ? `${getPipeSpecBadgeLabel(cell.selectedSpecId)} ` : ''
            }Ø${cell.selectedNominalMm}${cell.exceedsMaxPipeCapacity ? '!' : ''}`;
            const calloutX = isBranchRow && cell.hasPrv ? x - 9 : x - 1.5;
            const calloutY = isBranchRow ? y - 1.6 : y + 0.2;

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(5.5);
            doc.setTextColor(cRgb[0], cRgb[1], cRgb[2]);
            doc.text(toPdfSafeText(odText), calloutX, calloutY, { align: 'right' });
            if (!isBranchRow && cell.selectedInnerMm !== null) {
              const cellSpec = PIPE_SPEC_TABLES[cell.selectedSpecId] ?? pipeSpec;
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(4.5);
              doc.setTextColor(
                cell.exceedsMaxPipeCapacity ? 220 : cell.isFallbackMaterial ? 29 : 100,
                cell.exceedsMaxPipeCapacity ? 38 : cell.isFallbackMaterial ? 78 : 116,
                cell.exceedsMaxPipeCapacity ? 38 : cell.isFallbackMaterial ? 216 : 139
              );
              doc.text(
                toPdfSafeText(`di ${formatPipeDim(cell.selectedInnerMm, cellSpec)}`),
                calloutX,
                calloutY + 1.8,
                { align: 'right' }
              );
            }
          }

          const overPressure =
            cell.workingPressureBar !== null &&
            cell.workingPressureBar > parameters.maxStaticPressureBar + 1e-4;
          if (cell.isServed) {
            const tapLen = 4.2;
            doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
            doc.setLineWidth(0.42);
            doc.line(x, y, x + tapLen, y);
            if (cell.isSplitLoad) {
              drawSplitCircle(doc, x + tapLen, y, 0.9, rgb);
            } else {
              doc.setFillColor(rgb[0], rgb[1], rgb[2]);
              doc.circle(x + tapLen, y, 0.72, 'F');
            }
            if (cell.workingPressureBar !== null) {
              const isAlert = overPressure || Boolean(cell.prvDetail?.cavitationWarning);
              const pText =
                cell.hasPrv && cell.prvDetail
                  ? `${cell.prvDetail.upstreamPressureBar.toFixed(1)}->${cell.prvDetail.downstreamPressureBar.toFixed(1)}b${
                      cell.prvDetail.isCustomSetPressure ? '*' : ''
                    }${overPressure ? '!' : ''}`
                  : `${cell.workingPressureBar.toFixed(2)}b${overPressure ? '!' : ''}`;
              const splitSuffix = cell.isSplitLoad
                ? ` ·${Math.round(cell.loadFraction * 100)}%`
                : '';
              doc.setFont('helvetica', isAlert ? 'bold' : 'normal');
              doc.setFontSize(5.4);
              doc.setTextColor(isAlert ? 220 : 14, isAlert ? 38 : 116, isAlert ? 38 : 144);
              doc.text(toPdfSafeText(`${pText}${splitSuffix}`), x + tapLen + 1.6, y + 0.7);
            }
          } else if (cell.hasPrv && cell.prvDetail) {
            const isCav = cell.prvDetail.cavitationWarning;
            doc.setFont('helvetica', isCav ? 'bold' : 'normal');
            doc.setFontSize(5.4);
            doc.setTextColor(isCav ? 220 : 14, isCav ? 38 : 116, isCav ? 38 : 144);
            doc.text(
              toPdfSafeText(
                `${cell.prvDetail.upstreamPressureBar.toFixed(1)}->${cell.prvDetail.downstreamPressureBar.toFixed(1)}b${
                  cell.prvDetail.isCustomSetPressure ? '*' : ''
                }`
              ),
              x + 3.0,
              y + 0.7
            );
          }

          if (cell.hasPrv && cell.prvDetail) {
            const prvOffset =
              cell.flowDirection === 'up'
                ? rowH / 2
                : cell.flowDirection === 'down'
                ? -rowH / 2
                : 0;
            drawPrvStationNode(
              doc,
              x,
              y + prvOffset,
              cell.prvDetail.cavitationWarning,
              cell.prvDetail.isCustomSetPressure
            );
          }
        }
      }
    });

    // Bottom Column Designations on final schematic page
    if (isLastPage) {
      const bottomY = yCursor + (pg.endIdx - pg.startIdx) * rowH + 4.5;
      cols.forEach((col, cIdx) => {
        const x = colX(cIdx);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        if (col.kind === 'main' && col.mainSummary) {
          const d = col.mainSummary;
          if (d.hasBoosterPump) {
            doc.setTextColor(
              d.isCustomBoosterPressure ? 29 : 3,
              d.isCustomBoosterPressure ? 78 : 105,
              d.isCustomBoosterPressure ? 216 : 161
            );
          } else {
            doc.setTextColor(col.rgb[0], col.rgb[1], col.rgb[2]);
          }
          doc.text(
            toPdfSafeText(
              `D${d.dropperIndex} (${
                d.hasBoosterPump ? `Boost${d.isCustomBoosterPressure ? '*' : ''}` : 'Grav'
              })`
            ),
            x,
            bottomY,
            { align: 'center' }
          );
        } else if (col.kind === 'sub' && col.subSummary) {
          const sd = col.subSummary;
          doc.setTextColor(col.rgb[0], col.rgb[1], col.rgb[2]);
          doc.text(
            toPdfSafeText(`${sd.label} (<-D${sd.parentDropperIndex})`),
            x,
            bottomY,
            { align: 'center' }
          );
        }
      });
    }
  });
}

/**
 * Renders Section 4B: Unreduced Static Head vs. PRV Regulated Working Pressure Profile onto A4 Landscape page(s).
 */
export function renderPressureProfileToPdf(
  doc: jsPDF,
  result: SystemCalculationResult
): void {
  const { rows, dropperSummaries, subDropperSummaries, parameters } = result;
  if (rows.length === 0) return;

  const pageW = 297;
  const pageH = 210;
  const marginX = 14;
  const contentW = pageW - marginX * 2;

  // Compute horizontal bar axis matching PressureProfile.tsx
  const maxUnreducedPrvP1 = result.prvList.reduce(
    (m, p) => Math.max(m, p.upstreamPressureBar),
    0
  );
  let maxCellPressureBar = 0;
  for (const r of rows) {
    for (const c of Object.values(r.dropperCells)) {
      if (c.pipePressureBar != null && c.pipePressureBar > maxCellPressureBar) {
        maxCellPressureBar = c.pipePressureBar;
      }
      if (c.unreducedPressureBar != null && c.unreducedPressureBar > maxCellPressureBar) {
        maxCellPressureBar = c.unreducedPressureBar;
      }
    }
    for (const c of Object.values(r.subDropperCells)) {
      if (c.pipePressureBar != null && c.pipePressureBar > maxCellPressureBar) {
        maxCellPressureBar = c.pipePressureBar;
      }
      if (c.unreducedPressureBar != null && c.unreducedPressureBar > maxCellPressureBar) {
        maxCellPressureBar = c.unreducedPressureBar;
      }
    }
  }
  const maxBarAxis = Math.max(
    6,
    Math.ceil(
      Math.max(
        result.maxStaticHeadBar,
        result.overallMaxWorkingPressureBar,
        maxUnreducedPrvP1,
        maxCellPressureBar,
        parameters.maxStaticPressureBar
      ) + 1
    )
  );

  const chartPadLeft = marginX + 20;
  const chartPadRight = pageW - marginX - 6;
  const plotW = chartPadRight - chartPadLeft;
  const xForBar = (bar: number) =>
    chartPadLeft + Math.min(1, Math.max(0, bar / maxBarAxis)) * plotW;

  const topTitleY = 20;
  const legendH = 12;
  const axisHdrH = 8;
  const bottomFooterReserve = 16;

  // Choose rowH so 32-34 rows fit on 1 landscape page cleanly
  const firstPageAvail =
    pageH - bottomFooterReserve - (topTitleY + 4 + legendH + axisHdrH + 3);
  const rowH =
    rows.length <= 34 && rows.length * 4.2 <= firstPageAvail
      ? Math.min(4.8, firstPageAvail / rows.length)
      : 4.5;

  const pages: { startIdx: number; endIdx: number; isFirst: boolean }[] = [];
  let cursor = 0;
  while (cursor < rows.length) {
    const isFirst = pages.length === 0;
    const gridStartY = isFirst
      ? topTitleY + 4 + legendH + axisHdrH
      : topTitleY + 4 + axisHdrH;
    const maxBodyH = pageH - bottomFooterReserve - 3 - gridStartY;
    const maxRowsFit = Math.max(8, Math.floor(maxBodyH / rowH));
    const endIdx = Math.min(rows.length, cursor + maxRowsFit);
    pages.push({ startIdx: cursor, endIdx, isFirst });
    cursor = endIdx;
  }

  pages.forEach((pg, pageIdx) => {
    doc.addPage('a4', 'landscape');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(18, 18, 18);
    doc.text(
      toPdfSafeText(
        pg.isFirst
          ? '5. Unreduced Static Head vs. PRV Regulated Working Pressure Profile'
          : `5. Static vs. Working Pressure Profile (Cont. ${pageIdx + 1}/${pages.length})`
      ),
      marginX,
      topTitleY
    );

    let yCursor = topTitleY + 3.5;

    if (pg.isFirst) {
      // 2-Row Legend Box
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(224, 224, 224);
      doc.setLineWidth(0.25);
      doc.rect(marginX, yCursor, contentW, legendH, 'FD');

      const r1Y = yCursor + 4.2;
      const r2Y = yCursor + 9.2;
      let lx = marginX + 3;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(65, 65, 65);

      // Static Head
      doc.setDrawColor(136, 136, 136);
      doc.setLineWidth(0.45);
      doc.setLineDashPattern([1.2, 0.9], 0);
      doc.line(lx, r1Y - 0.7, lx + 5, r1Y - 0.7);
      doc.setLineDashPattern([], 0);
      doc.text('Unreduced Static Head', lx + 6.5, r1Y);
      lx += 36;

      // Pset
      doc.setDrawColor(21, 128, 61);
      doc.setLineDashPattern([1.2, 0.9], 0);
      doc.line(lx, r1Y - 0.7, lx + 5, r1Y - 0.7);
      doc.setLineDashPattern([], 0);
      doc.text(`PRV Set (Pset = ${parameters.prvSetPressureBar.toFixed(2)}b)`, lx + 6.5, r1Y);
      lx += 41;

      // Pmax
      doc.setDrawColor(217, 0, 0);
      doc.setLineDashPattern([1.6, 0.9], 0);
      doc.line(lx, r1Y - 0.7, lx + 5, r1Y - 0.7);
      doc.setLineDashPattern([], 0);
      doc.text(`Max Allowable (Pmax = ${parameters.maxStaticPressureBar.toFixed(2)}b)`, lx + 6.5, r1Y);
      lx += 48;

      // Express dotted
      doc.setDrawColor(85, 85, 85);
      doc.setLineDashPattern([0.5, 0.9], 0);
      doc.line(lx, r1Y - 0.7, lx + 5, r1Y - 0.7);
      doc.setLineDashPattern([], 0);
      doc.text('Express Pass-Through', lx + 6.5, r1Y);
      lx += 35;

      // PRV dot
      doc.setFillColor(217, 119, 6);
      doc.circle(lx + 1.2, r1Y - 0.7, 0.95, 'F');
      doc.text('PRV Station', lx + 3.4, r1Y);
      lx += 22;

      if (result.boosterDropperPipes > 0 || result.boosterSubDropperPipes > 0) {
        drawPumpIcon(doc, lx + 1.3, r1Y - 0.7, 1.3, false);
        doc.setTextColor(3, 105, 161);
        doc.text(
          `Booster (+${parameters.boosterPumpBoostBar.toFixed(2)}b)`,
          lx + 3.8,
          r1Y
        );
      }

      // Row 2: Series legend
      const totalSeriesCount = dropperSummaries.length + subDropperSummaries.length;
      const legendGap = totalSeriesCount > 8 ? 6.2 : totalSeriesCount > 6 ? 7.5 : 10;
      const legendFontSize = totalSeriesCount > 9 ? 5.6 : 6.4;
      let rx = marginX + 3;
      const maxLegendX = marginX + contentW - 4;
      doc.setFontSize(legendFontSize);
      dropperSummaries.forEach((d) => {
        const label = `D${d.dropperIndex} (${
          d.hasBoosterPump
            ? `+${(d.boosterPressureBar ?? parameters.boosterPumpBoostBar).toFixed(1)}b${
                d.isCustomBoosterPressure ? '*' : ''
              }`
            : 'Grav'
        })`;
        const itemW = doc.getTextWidth(label) + 5.2 + legendGap;
        if (rx + itemW - legendGap > maxLegendX) return;
        const rgb = DROPPER_RGB[(d.dropperIndex - 1) % DROPPER_RGB.length];
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(0.7);
        doc.line(rx, r2Y - 0.7, rx + 4, r2Y - 0.7);
        doc.setFont('helvetica', d.hasBoosterPump ? 'bold' : 'normal');
        if (d.hasBoosterPump) {
          doc.setTextColor(
            d.isCustomBoosterPressure ? 29 : 3,
            d.isCustomBoosterPressure ? 78 : 105,
            d.isCustomBoosterPressure ? 216 : 161
          );
        } else {
          doc.setTextColor(18, 18, 18);
        }
        doc.text(toPdfSafeText(label), rx + 5.2, r2Y);
        rx += doc.getTextWidth(label) + legendGap;
      });
      subDropperSummaries.forEach((sd, sdIdx) => {
        const label = `${sd.label} (<-D${sd.parentDropperIndex}@${sd.branchFloorLabel})`;
        const itemW = doc.getTextWidth(label) + 5.2 + legendGap;
        if (rx + itemW - legendGap > maxLegendX) return;
        const rgb = SUB_DROPPER_RGB[sdIdx % SUB_DROPPER_RGB.length];
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(0.7);
        doc.line(rx, r2Y - 0.7, rx + 4, r2Y - 0.7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(8, 145, 178);
        doc.text(toPdfSafeText(label), rx + 5.2, r2Y);
        rx += doc.getTextWidth(label) + legendGap;
      });

      yCursor += legendH + 2;
    }

    // Chart X-axis header & gridlines
    const axisY = yCursor + axisHdrH;
    const gridBottomY = axisY + (pg.endIdx - pg.startIdx) * rowH;

    // Subtle axis title & tick labels
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    doc.setTextColor(18, 18, 18);
    doc.text(
      'UNREDUCED STATIC HEAD VS. PRV REGULATED WORKING PRESSURE (bar)',
      (chartPadLeft + chartPadRight) / 2,
      yCursor + 2.8,
      { align: 'center' }
    );

    // Layer 1: Floor row bands, horizontal dividers & labels
    const rowY = (globalIdx: number) => axisY + (globalIdx - pg.startIdx) * rowH + rowH / 2;
    for (let rIdx = pg.startIdx; rIdx < pg.endIdx; rIdx++) {
      const r = rows[rIdx];
      const y = rowY(rIdx);
      const isRoof = r.input.supplyMode === SupplyMode.ROOF_HEADER;
      if (rIdx % 2 === 1) {
        doc.setFillColor(250, 250, 250);
        doc.rect(marginX, y - rowH / 2, contentW, rowH, 'F');
      }
      doc.setDrawColor(238, 238, 238);
      doc.setLineWidth(0.2);
      doc.line(chartPadLeft, y + rowH / 2, chartPadRight, y + rowH / 2);

      doc.setFont('helvetica', isRoof ? 'bold' : 'bold');
      doc.setFontSize(6.2);
      doc.setTextColor(18, 18, 18);
      doc.text(toPdfSafeText(r.input.floorLabel), chartPadLeft - 2.5, y + 0.8, {
        align: 'right',
      });
    }

    // Layer 2: Continuous vertical axis gridlines & tick labels
    for (let barTick = 0; barTick <= maxBarAxis; barTick++) {
      if (maxBarAxis > 16 && barTick % 2 !== 0) continue;
      const x = xForBar(barTick);
      doc.setDrawColor(barTick === 0 ? 18 : 224, barTick === 0 ? 18 : 224, barTick === 0 ? 18 : 224);
      doc.setLineWidth(barTick === 0 ? 0.38 : 0.22);
      doc.line(x, axisY - 1.5, x, gridBottomY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.0);
      doc.setTextColor(85, 85, 85);
      doc.text(`${barTick} bar`, x, axisY - 2.3, { align: 'center' });
    }

    // Pset & Pmax vertical threshold lines
    doc.setDrawColor(21, 128, 61);
    doc.setLineWidth(0.4);
    doc.setLineDashPattern([1.4, 0.9], 0);
    doc.line(
      xForBar(parameters.prvSetPressureBar),
      axisY - 1.5,
      xForBar(parameters.prvSetPressureBar),
      gridBottomY
    );
    doc.setDrawColor(217, 0, 0);
    doc.setLineWidth(0.45);
    doc.setLineDashPattern([1.8, 0.9], 0);
    doc.line(
      xForBar(parameters.maxStaticPressureBar),
      axisY - 1.5,
      xForBar(parameters.maxStaticPressureBar),
      gridBottomY
    );
    doc.setLineDashPattern([], 0);

    // Unreduced Static Head Curve (on this page's row range)
    doc.setDrawColor(153, 153, 153);
    doc.setLineWidth(0.48);
    doc.setLineDashPattern([1.3, 0.9], 0);
    for (let rIdx = pg.startIdx + 1; rIdx < pg.endIdx; rIdx++) {
      doc.line(
        xForBar(rows[rIdx - 1].staticPressureBar),
        rowY(rIdx - 1),
        xForBar(rows[rIdx].staticPressureBar),
        rowY(rIdx)
      );
    }
    doc.setLineDashPattern([], 0);

    // Main Dropper Working Pressure Curves (evaluated per page rows cleanly)
    dropperSummaries.forEach((d) => {
      const rgb = DROPPER_RGB[(d.dropperIndex - 1) % DROPPER_RGB.length];

      let firstServedIdx = -1;
      let firstPrvIdx = -1;
      let firstNonRoofIdx = -1;
      let lastReachIdx = -1;
      rows.forEach((r, idx) => {
        const c = r.dropperCells[d.dropperIndex];
        if (!c) return;
        const p = c.workingPressureBar ?? c.pipePressureBar ?? null;
        if (p !== null) {
          if (firstNonRoofIdx < 0 && r.input.supplyMode !== SupplyMode.ROOF_HEADER) {
            firstNonRoofIdx = idx;
          }
          if (c.hasPrv && firstPrvIdx < 0 && r.input.supplyMode !== SupplyMode.ROOF_HEADER) {
            firstPrvIdx = idx;
          }
          if (c.isServed && c.workingPressureBar !== null && firstServedIdx < 0) {
            firstServedIdx = idx;
          }
          lastReachIdx = idx;
        }
      });

      const startIdx =
        firstServedIdx >= 0
          ? firstPrvIdx >= 0 && firstPrvIdx < firstServedIdx
            ? firstPrvIdx
            : firstServedIdx
          : firstNonRoofIdx;
      if (startIdx < 0 || lastReachIdx < startIdx) return;

      let prevPt: { x: number; y: number } | null = null;
      let prevServed = false;
      for (
        let rIdx = Math.max(startIdx, pg.startIdx);
        rIdx <= Math.min(lastReachIdx, pg.endIdx - 1);
        rIdx++
      ) {
        const c = rows[rIdx].dropperCells[d.dropperIndex];
        const pOut = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
        if (!c || pOut === null) continue;
        const y = rowY(rIdx);

        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(0.58);
        if (c.hasPrv && c.unreducedPressureBar !== null) {
          const entryPt = { x: xForBar(c.unreducedPressureBar), y: y - 0.8 };
          const exitPt = { x: xForBar(pOut), y };
          if (prevPt) {
            if (!prevServed || !c.isServed) doc.setLineDashPattern([0.5, 0.9], 0);
            doc.line(prevPt.x, prevPt.y, entryPt.x, entryPt.y);
            doc.setLineDashPattern([], 0);
          }
          doc.line(entryPt.x, entryPt.y, exitPt.x, exitPt.y);
          prevPt = exitPt;
          prevServed = c.isServed;
        } else {
          const pt = { x: xForBar(pOut), y };
          if (prevPt) {
            if (!prevServed || !c.isServed) doc.setLineDashPattern([0.5, 0.9], 0);
            doc.line(prevPt.x, prevPt.y, pt.x, pt.y);
            doc.setLineDashPattern([], 0);
          }
          prevPt = pt;
          prevServed = c.isServed;
        }
      }

      // Booster Pump marker if first served row is on this page
      const boostIdx = firstServedIdx >= 0 ? firstServedIdx : startIdx;
      if (d.hasBoosterPump && boostIdx >= pg.startIdx && boostIdx < pg.endIdx) {
        const boostCell = rows[boostIdx]?.dropperCells[d.dropperIndex];
        const boostBar = boostCell
          ? boostCell.hasPrv && boostCell.unreducedPressureBar !== null
            ? boostCell.unreducedPressureBar
            : boostCell.workingPressureBar ?? boostCell.pipePressureBar ?? null
          : null;
        if (boostBar !== null) {
          const effBoost = d.boosterPressureBar ?? parameters.boosterPumpBoostBar;
          const isCustom = d.isCustomBoosterPressure;
          const bx = xForBar(boostBar);
          const by = rowY(boostIdx);
          drawPumpIcon(doc, bx, by, 1.5, isCustom);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5.5);
          doc.setTextColor(
            isCustom ? 29 : 3,
            isCustom ? 78 : 105,
            isCustom ? 216 : 161
          );
          doc.text(
            `D${d.dropperIndex} +${effBoost.toFixed(1)}b${isCustom ? '*' : ''}`,
            bx + 2.2,
            by + 0.7
          );
        }
      }

      // Floor points
      for (let rIdx = pg.startIdx; rIdx < pg.endIdx; rIdx++) {
        const c = rows[rIdx].dropperCells[d.dropperIndex];
        const p = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
        if (!c || p === null || (!c.isServed && !c.hasPrv)) continue;
        if (c.hasPrv) {
          doc.setFillColor(217, 119, 6);
          if (c.prvDetail?.isCustomSetPressure) {
            doc.setDrawColor(29, 78, 216);
            doc.setLineWidth(0.35);
            doc.circle(xForBar(p), rowY(rIdx), 0.95, 'FD');
          } else {
            doc.circle(xForBar(p), rowY(rIdx), 0.95, 'F');
          }
        } else {
          doc.setFillColor(rgb[0], rgb[1], rgb[2]);
          doc.circle(xForBar(p), rowY(rIdx), 0.62, 'F');
        }
      }
    });

    // Sub-Dropper Working Pressure Curves
    subDropperSummaries.forEach((sd, sdIdx) => {
      const rgb = SUB_DROPPER_RGB[sdIdx % SUB_DROPPER_RGB.length];
      const bIdx = sd.branchRowIdx;
      const branchCell = rows[bIdx]?.subDropperCells[sd.id];
      const branchOutBar = branchCell
        ? branchCell.workingPressureBar ?? branchCell.pipePressureBar ?? null
        : null;
      if (!branchCell || branchOutBar === null) return;

      const drawSeg = (
        p1: { x: number; y: number },
        p2: { x: number; y: number },
        dotted: boolean
      ) => {
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(0.58);
        if (dotted) doc.setLineDashPattern([0.5, 0.9], 0);
        doc.line(p1.x, p1.y, p2.x, p2.y);
        doc.setLineDashPattern([], 0);
      };

      const branchOnPage = bIdx >= pg.startIdx && bIdx < pg.endIdx;
      const parentArrivalBar =
        branchCell.parentBranchArrivalBar ??
        branchCell.unreducedPressureBar ??
        branchOutBar;

      if (branchOnPage) {
        const branchY = rowY(bIdx);
        const branchOutPt = { x: xForBar(branchOutBar), y: branchY };
        if (sd.hasBoosterPump) {
          const postBoostBar = branchCell.unreducedPressureBar ?? branchOutBar;
          if (Math.abs(postBoostBar - parentArrivalBar) > 1e-6) {
            if (branchCell.hasPrv && branchCell.unreducedPressureBar !== null) {
              const boostPt = { x: xForBar(postBoostBar), y: branchY + 0.8 };
              drawSeg({ x: xForBar(parentArrivalBar), y: branchY }, boostPt, false);
              drawSeg(boostPt, branchOutPt, false);
            } else {
              drawSeg({ x: xForBar(parentArrivalBar), y: branchY }, branchOutPt, false);
            }
          }
        } else if (branchCell.hasPrv && branchCell.unreducedPressureBar !== null) {
          drawSeg({ x: xForBar(branchCell.unreducedPressureBar), y: branchY }, branchOutPt, false);
        }
      }

      // Up arm segments intersecting this page
      let upPrevPt: { x: number; y: number } | null = branchOnPage
        ? { x: xForBar(branchOutBar), y: rowY(bIdx) }
        : null;
      let upPrevServed = branchCell.isServed;
      for (let rIdx = bIdx - 1; rIdx >= pg.startIdx; rIdx--) {
        const c = rows[rIdx].subDropperCells[sd.id];
        const pOut = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
        if (!c || pOut === null) continue;
        if (rIdx >= pg.endIdx) {
          upPrevServed = c.isServed;
          continue;
        }
        const y = rowY(rIdx);
        const isPassThroughSeg = !upPrevServed || !c.isServed;
        if (c.hasPrv && c.unreducedPressureBar !== null) {
          const entryPt = { x: xForBar(c.unreducedPressureBar), y: y + 0.8 };
          const exitPt = { x: xForBar(pOut), y };
          if (upPrevPt) drawSeg(upPrevPt, entryPt, isPassThroughSeg);
          drawSeg(entryPt, exitPt, false);
          upPrevPt = exitPt;
        } else {
          const pt = { x: xForBar(pOut), y };
          if (upPrevPt) drawSeg(upPrevPt, pt, isPassThroughSeg);
          upPrevPt = pt;
        }
        upPrevServed = c.isServed;
      }

      // Down arm segments intersecting this page
      let downPrevPt: { x: number; y: number } | null = branchOnPage
        ? { x: xForBar(branchOutBar), y: rowY(bIdx) }
        : null;
      let downPrevServed = branchCell.isServed;
      for (let rIdx = bIdx + 1; rIdx < pg.endIdx; rIdx++) {
        const c = rows[rIdx].subDropperCells[sd.id];
        const pOut = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
        if (!c || pOut === null) continue;
        if (rIdx < pg.startIdx) {
          downPrevServed = c.isServed;
          continue;
        }
        const y = rowY(rIdx);
        const isPassThroughSeg = !downPrevServed || !c.isServed;
        if (c.hasPrv && c.unreducedPressureBar !== null) {
          const entryPt = { x: xForBar(c.unreducedPressureBar), y: y - 0.8 };
          const exitPt = { x: xForBar(pOut), y };
          if (downPrevPt) drawSeg(downPrevPt, entryPt, isPassThroughSeg);
          drawSeg(entryPt, exitPt, false);
          downPrevPt = exitPt;
        } else {
          const pt = { x: xForBar(pOut), y };
          if (downPrevPt) drawSeg(downPrevPt, pt, isPassThroughSeg);
          downPrevPt = pt;
        }
        downPrevServed = c.isServed;
      }

      if (branchOnPage && sd.hasBoosterPump) {
        const branchBoostBar =
          branchCell.hasPrv && branchCell.unreducedPressureBar !== null
            ? branchCell.unreducedPressureBar
            : branchOutBar;
        const effBoost = sd.boosterPressureBar ?? parameters.boosterPumpBoostBar;
        const isCustom = sd.isCustomBoosterPressure;
        const bx = xForBar(branchBoostBar);
        const by = rowY(bIdx);
        drawPumpIcon(doc, bx, by, 1.5, isCustom);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.setTextColor(
          isCustom ? 29 : 3,
          isCustom ? 78 : 105,
          isCustom ? 216 : 161
        );
        doc.text(
          toPdfSafeText(`${sd.label} +${effBoost.toFixed(1)}b${isCustom ? '*' : ''}`),
          bx + 2.2,
          by + 0.7
        );
      }

      // Floor points
      for (let rIdx = pg.startIdx; rIdx < pg.endIdx; rIdx++) {
        const c = rows[rIdx].subDropperCells[sd.id];
        const p = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
        if (!c || p === null || (!c.isServed && !c.hasPrv)) continue;
        if (c.hasPrv) {
          doc.setFillColor(217, 119, 6);
          if (c.prvDetail?.isCustomSetPressure) {
            doc.setDrawColor(29, 78, 216);
            doc.setLineWidth(0.35);
            doc.circle(xForBar(p), rowY(rIdx), 0.95, 'FD');
          } else {
            doc.circle(xForBar(p), rowY(rIdx), 0.95, 'F');
          }
        } else {
          doc.setFillColor(rgb[0], rgb[1], rgb[2]);
          doc.circle(xForBar(p), rowY(rIdx), 0.62, 'F');
        }
      }
    });
  });
}

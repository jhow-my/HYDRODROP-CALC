import React, { useEffect, useRef, useState } from 'react';
import {
  RiserTarget,
  SupplyMode,
  SystemCalculationResult,
} from '../types/hydraulics';

interface PressureProfileProps {
  result: SystemCalculationResult;
  highlightedRiser?: RiserTarget | null;
  stickyHeader?: boolean;
}

interface ProfilePoint {
  x: number;
  y: number;
}

interface ProfileSegment {
  points: ProfilePoint[];
  dotted: boolean;
}

function pushProfileSegment(
  segments: ProfileSegment[],
  from: ProfilePoint,
  to: ProfilePoint,
  dotted: boolean
): void {
  const last = segments[segments.length - 1];
  if (
    last &&
    last.dotted === dotted &&
    last.points.length > 0 &&
    Math.abs(last.points[last.points.length - 1].x - from.x) < 1e-6 &&
    Math.abs(last.points[last.points.length - 1].y - from.y) < 1e-6
  ) {
    last.points.push(to);
  } else {
    segments.push({ points: [from, to], dotted });
  }
}

const DROPPER_COLORS = [
  '#121212',
  '#0369a1',
  '#1d4ed8',
  '#0f766e',
  '#7c2d12',
  '#be185d',
  '#6d28d9',
  '#4338ca',
];

const SUB_DROPPER_COLORS = [
  '#0891b2',
  '#7c3aed',
  '#059669',
  '#c2410c',
  '#0284c7',
  '#be123c',
];

export const PressureProfile: React.FC<PressureProfileProps> = ({
  result,
  highlightedRiser = null,
  stickyHeader = false,
}) => {
  const { rows, dropperSummaries, subDropperSummaries, parameters } = result;
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [isScrolled, setIsScrolled] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!stickyHeader) {
      setIsScrolled(false);
      return;
    }
    const el = scrollContainerRef.current;
    setIsScrolled(Boolean(el && el.scrollTop > 4));
  }, [rows.length, stickyHeader]);

  if (rows.length === 0) {
    return (
      <div className="bg-white p-10 text-center text-xs text-[#666666]">
        Add building floors in the Floor Data view to generate the pressure profile chart.
      </div>
    );
  }

  const rowHeight = 21;
  const chartTopPad = 42;
  const svgTopOffset = stickyHeader ? 0 : chartTopPad;
  const bottomPad = 18;
  const totalSvgHeight = svgTopOffset + rows.length * rowHeight + bottomPad;

  const chartWidth = 820;
  const chartPadLeft = 72;
  const chartPadRight = 32;
  const plotW = chartWidth - chartPadLeft - chartPadRight;

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
  const xForBar = (bar: number) =>
    chartPadLeft + Math.min(1, Math.max(0, bar / maxBarAxis)) * plotW;
  const rowY = (rIdx: number) => svgTopOffset + rIdx * rowHeight + rowHeight / 2;

  const inspectedRow =
    hoveredRowIdx !== null
      ? rows[hoveredRowIdx]
      : rows[Math.min(rows.length - 1, Math.floor(rows.length / 2))];

  const staticPoints = rows
    .map((r, idx) => `${xForBar(r.staticPressureBar).toFixed(1)},${rowY(idx).toFixed(1)}`)
    .join(' ');

  const inspectedServedMainCells = inspectedRow
    ? Object.values(inspectedRow.dropperCells).filter(
        (c) => c.isServed && c.workingPressureBar !== null
      )
    : [];

  const inspectedServedSubCells = inspectedRow
    ? Object.values(inspectedRow.subDropperCells).filter(
        (c) => c.isServed && c.workingPressureBar !== null
      )
    : [];

  const renderChartHeader = (isStickyPart: boolean) => (
    <g>
      {/* Chart Title */}
      <text
        x={chartPadLeft + plotW / 2}
        y={14}
        fontSize={9.5}
        fontWeight={700}
        fontFamily="Space Mono, monospace"
        textAnchor="middle"
        fill="#121212"
      >
        UNREDUCED STATIC HEAD VS. PRV REGULATED WORKING PRESSURE
      </text>

      {/* Pressure X-Axis Tick Labels & Top Stubs */}
      {Array.from({ length: maxBarAxis + 1 }).map((_, barTick) => {
        if (maxBarAxis > 16 && barTick % 2 !== 0) return null;
        const x = xForBar(barTick);
        return (
          <g key={`tick-hdr-${barTick}`}>
            <line
              x1={x}
              y1={chartTopPad - 5}
              x2={x}
              y2={chartTopPad}
              stroke={barTick === 0 ? '#121212' : '#e0e0e0'}
              strokeWidth={barTick === 0 ? 1.2 : 0.8}
            />
            <text
              x={x}
              y={chartTopPad - 9}
              fontSize={8.5}
              textAnchor="middle"
              fontFamily="IBM Plex Mono, monospace"
              fill="#555555"
            >
              {barTick} bar
            </text>
          </g>
        );
      })}

      {/* Pset and Pmax Limit Top Tick Stubs */}
      <line
        x1={xForBar(parameters.prvSetPressureBar)}
        y1={chartTopPad - 5}
        x2={xForBar(parameters.prvSetPressureBar)}
        y2={isStickyPart ? chartTopPad : chartTopPad}
        stroke="#15803d"
        strokeWidth={1.3}
        strokeDasharray="4 3"
      />

      <line
        x1={xForBar(parameters.maxStaticPressureBar)}
        y1={chartTopPad - 5}
        x2={xForBar(parameters.maxStaticPressureBar)}
        y2={isStickyPart ? chartTopPad : chartTopPad}
        stroke="#d90000"
        strokeWidth={1.5}
        strokeDasharray="6 3"
      />
    </g>
  );

  const renderChartBodyContent = () => {
    const gridTopY = stickyHeader ? 0 : chartTopPad;
    const gridBottomY = totalSvgHeight - bottomPad;

    return (
      <>
        {!stickyHeader && renderChartHeader(false)}

        {/* Layer 1: Floor Row Backgrounds, Dividers & Floor Labels */}
        {rows.map((r, rIdx) => {
          const y = rowY(rIdx);
          const isHovered = hoveredRowIdx === rIdx;
          const isRoof = r.input.supplyMode === SupplyMode.ROOF_HEADER;
          return (
            <g
              key={`pguide-${r.input.id}`}
              onMouseEnter={() => setHoveredRowIdx(rIdx)}
              className="cursor-pointer"
            >
              <rect
                x={4}
                y={y - rowHeight / 2}
                width={chartWidth - 8}
                height={rowHeight}
                fill={
                  isHovered
                    ? '#f0f0f0'
                    : rIdx % 2 === 0
                    ? 'transparent'
                    : '#fafafa'
                }
              />
              <line
                x1={chartPadLeft}
                y1={y + rowHeight / 2}
                x2={chartWidth - chartPadRight}
                y2={y + rowHeight / 2}
                stroke="#eeeeee"
                strokeWidth={0.8}
              />
              <text
                x={chartPadLeft - 10}
                y={y + 3}
                fontSize={9}
                fontWeight={isRoof ? 700 : 600}
                textAnchor="end"
                fill="#121212"
              >
                {r.input.floorLabel}
              </text>
            </g>
          );
        })}

        {/* Layer 2: Continuous Vertical Axis Gridlines & Pset / Pmax Threshold Lines */}
        <g pointerEvents="none">
          {Array.from({ length: maxBarAxis + 1 }).map((_, barTick) => {
            if (maxBarAxis > 16 && barTick % 2 !== 0) return null;
            const x = xForBar(barTick);
            return (
              <line
                key={`vgrid-${barTick}`}
                x1={x}
                y1={gridTopY}
                x2={x}
                y2={gridBottomY}
                stroke={barTick === 0 ? '#121212' : '#e0e0e0'}
                strokeWidth={barTick === 0 ? 1.2 : 0.8}
              />
            );
          })}

          <line
            x1={xForBar(parameters.prvSetPressureBar)}
            y1={gridTopY}
            x2={xForBar(parameters.prvSetPressureBar)}
            y2={gridBottomY}
            stroke="#15803d"
            strokeWidth={1.3}
            strokeDasharray="4 3"
          />

          <line
            x1={xForBar(parameters.maxStaticPressureBar)}
            y1={gridTopY}
            x2={xForBar(parameters.maxStaticPressureBar)}
            y2={gridBottomY}
            stroke="#d90000"
            strokeWidth={1.5}
            strokeDasharray="6 3"
          />
        </g>

        {/* Layer 3: Unreduced Static Head & Regulated Working Pressure Curves */}
        <polyline
          fill="none"
          stroke="#999999"
          strokeWidth={1.6}
          strokeDasharray="4 3"
          points={staticPoints}
          pointerEvents="none"
        />

        {dropperSummaries.map((d) => {
          const color = DROPPER_COLORS[(d.dropperIndex - 1) % DROPPER_COLORS.length];
          const isHighlighted =
            highlightedRiser?.kind === 'main' &&
            highlightedRiser.dropperIndex === d.dropperIndex;
          const isDimmed = highlightedRiser !== null && !isHighlighted;

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

          if (startIdx < 0 || lastReachIdx < startIdx) return null;

          const segments: ProfileSegment[] = [];
          let prevPt: ProfilePoint | null = null;
          let prevServed = false;

          for (let rIdx = startIdx; rIdx <= lastReachIdx; rIdx++) {
            const c = rows[rIdx].dropperCells[d.dropperIndex];
            const pOut = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
            if (!c || pOut === null) continue;
            const y = rowY(rIdx);

            if (c.hasPrv && c.unreducedPressureBar !== null) {
              const entryPt: ProfilePoint = {
                x: xForBar(c.unreducedPressureBar),
                y: y - 3,
              };
              const exitPt: ProfilePoint = {
                x: xForBar(pOut),
                y,
              };
              if (prevPt !== null) {
                pushProfileSegment(segments, prevPt, entryPt, !prevServed || !c.isServed);
              }
              pushProfileSegment(segments, entryPt, exitPt, false);
              prevPt = exitPt;
              prevServed = c.isServed;
            } else {
              const pt: ProfilePoint = {
                x: xForBar(pOut),
                y,
              };
              if (prevPt !== null) {
                pushProfileSegment(segments, prevPt, pt, !prevServed || !c.isServed);
              }
              prevPt = pt;
              prevServed = c.isServed;
            }
          }

          if (segments.length === 0) return null;

          const boostIdx = firstServedIdx >= 0 ? firstServedIdx : startIdx;
          const boostCell = boostIdx >= 0 ? rows[boostIdx].dropperCells[d.dropperIndex] : null;
          const boostBar = boostCell
            ? boostCell.hasPrv && boostCell.unreducedPressureBar !== null
              ? boostCell.unreducedPressureBar
              : boostCell.workingPressureBar ?? boostCell.pipePressureBar ?? null
            : null;
          const firstBoostX = boostBar !== null ? xForBar(boostBar) : null;

          return (
            <g key={`pcurve-${d.dropperIndex}`} opacity={isDimmed ? 0.25 : 1} pointerEvents="none">
              {segments.map((seg, sIdx) => (
                <polyline
                  key={`pseg-${d.dropperIndex}-${sIdx}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={isHighlighted ? 3 : 2.2}
                  strokeDasharray={seg.dotted ? '1 4' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={seg.points.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')}
                />
              ))}
              {d.hasBoosterPump && firstBoostX !== null && boostIdx >= 0 && (() => {
                const effBoost = d.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                const isCustom = d.isCustomBoosterPressure;
                const accent = isCustom ? '#1d4ed8' : '#0369a1';
                const fillBg = isCustom ? '#eef2ff' : '#e0f2fe';
                return (
                  <g
                    transform={`translate(${firstBoostX}, ${rowY(boostIdx)})`}
                    data-testid={`profile-booster-marker-D${d.dropperIndex}`}
                  >
                    <circle
                      r={5.5}
                      fill={fillBg}
                      stroke={accent}
                      strokeWidth={isCustom ? 1.6 : 1.3}
                    />
                    <polygon points="-1.8,-2.3 3,0 -1.8,2.3" fill={accent} />
                    <text
                      x={8}
                      y={3}
                      fontSize={8}
                      fontWeight={700}
                      fontFamily="IBM Plex Mono, monospace"
                      fill={accent}
                    >
                      D{d.dropperIndex} +{effBoost.toFixed(1)}b{isCustom ? '*' : ''}
                    </text>
                  </g>
                );
              })()}
              {rows.map((r, rIdx) => {
                const c = r.dropperCells[d.dropperIndex];
                const p = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
                if (!c || p === null || (!c.isServed && !c.hasPrv)) return null;
                return (
                  <circle
                    key={`pt-${d.dropperIndex}-${r.input.id}`}
                    cx={xForBar(p)}
                    cy={rowY(rIdx)}
                    r={c.hasPrv ? 3.5 : 2.3}
                    fill={c.hasPrv ? '#d97706' : color}
                    stroke={c.prvDetail?.isCustomSetPressure ? '#1d4ed8' : 'none'}
                    strokeWidth={c.prvDetail?.isCustomSetPressure ? 1.4 : 0}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Sub-Dropper Pressure Curves */}
        {subDropperSummaries.map((sd, sdIdx) => {
          const color = SUB_DROPPER_COLORS[sdIdx % SUB_DROPPER_COLORS.length];
          const isHighlighted =
            highlightedRiser?.kind === 'sub' &&
            highlightedRiser.subDropperId === sd.id;
          const isDimmed = highlightedRiser !== null && !isHighlighted;

          const bIdx = sd.branchRowIdx;
          const branchCell = rows[bIdx]?.subDropperCells[sd.id];
          const branchOutBar = branchCell
            ? branchCell.workingPressureBar ?? branchCell.pipePressureBar ?? null
            : null;
          if (!branchCell || branchOutBar === null) return null;

          const branchY = rowY(bIdx);
          const branchOutPt: ProfilePoint = {
            x: xForBar(branchOutBar),
            y: branchY,
          };
          const parentArrivalBar =
            branchCell.parentBranchArrivalBar ??
            branchCell.unreducedPressureBar ??
            branchOutBar;

          const segments: ProfileSegment[] = [];

          // 1. Branch takeoff transition at branchRowIdx (booster pump and/or PRV pressure step)
          if (sd.hasBoosterPump) {
            const postBoostBar = branchCell.unreducedPressureBar ?? branchOutBar;
            if (Math.abs(postBoostBar - parentArrivalBar) > 1e-6) {
              if (branchCell.hasPrv && branchCell.unreducedPressureBar !== null) {
                const boostPt: ProfilePoint = {
                  x: xForBar(postBoostBar),
                  y: branchY + 3,
                };
                pushProfileSegment(
                  segments,
                  { x: xForBar(parentArrivalBar), y: branchY },
                  boostPt,
                  false
                );
                pushProfileSegment(segments, boostPt, branchOutPt, false);
              } else {
                pushProfileSegment(
                  segments,
                  { x: xForBar(parentArrivalBar), y: branchY },
                  branchOutPt,
                  false
                );
              }
            }
          } else if (branchCell.hasPrv && branchCell.unreducedPressureBar !== null) {
            pushProfileSegment(
              segments,
              { x: xForBar(branchCell.unreducedPressureBar), y: branchY },
              branchOutPt,
              false
            );
          }

          // 2. Up-Feed Arm (ascending from branchRowIdx upward)
          let upPrevPt: ProfilePoint = branchOutPt;
          let upPrevServed = branchCell.isServed;
          for (let rIdx = bIdx - 1; rIdx >= 0; rIdx--) {
            const c = rows[rIdx].subDropperCells[sd.id];
            const pOut = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
            if (!c || pOut === null) continue;
            const y = rowY(rIdx);
            const isPassThroughSeg = !upPrevServed || !c.isServed;

            if (c.hasPrv && c.unreducedPressureBar !== null) {
              const entryPt: ProfilePoint = {
                x: xForBar(c.unreducedPressureBar),
                y: y + 3,
              };
              const exitPt: ProfilePoint = {
                x: xForBar(pOut),
                y,
              };
              pushProfileSegment(segments, upPrevPt, entryPt, isPassThroughSeg);
              pushProfileSegment(segments, entryPt, exitPt, false);
              upPrevPt = exitPt;
              upPrevServed = c.isServed;
            } else {
              const pt: ProfilePoint = {
                x: xForBar(pOut),
                y,
              };
              pushProfileSegment(segments, upPrevPt, pt, isPassThroughSeg);
              upPrevPt = pt;
              upPrevServed = c.isServed;
            }
          }

          // 3. Down-Feed Arm (descending from branchRowIdx downward)
          let downPrevPt: ProfilePoint = branchOutPt;
          let downPrevServed = branchCell.isServed;
          for (let rIdx = bIdx + 1; rIdx < rows.length; rIdx++) {
            const c = rows[rIdx].subDropperCells[sd.id];
            const pOut = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
            if (!c || pOut === null) continue;
            const y = rowY(rIdx);
            const isPassThroughSeg = !downPrevServed || !c.isServed;

            if (c.hasPrv && c.unreducedPressureBar !== null) {
              const entryPt: ProfilePoint = {
                x: xForBar(c.unreducedPressureBar),
                y: y - 3,
              };
              const exitPt: ProfilePoint = {
                x: xForBar(pOut),
                y,
              };
              pushProfileSegment(segments, downPrevPt, entryPt, isPassThroughSeg);
              pushProfileSegment(segments, entryPt, exitPt, false);
              downPrevPt = exitPt;
              downPrevServed = c.isServed;
            } else {
              const pt: ProfilePoint = {
                x: xForBar(pOut),
                y,
              };
              pushProfileSegment(segments, downPrevPt, pt, isPassThroughSeg);
              downPrevPt = pt;
              downPrevServed = c.isServed;
            }
          }

          const branchBoostBar =
            branchCell.hasPrv && branchCell.unreducedPressureBar !== null
              ? branchCell.unreducedPressureBar
              : branchOutBar;
          const showTakeoffMarker =
            branchCell.hasPrv || sd.hasBoosterPump || !branchCell.isServed;

          return (
            <g key={`pcurve-sub-${sd.id}`} opacity={isDimmed ? 0.25 : 1} pointerEvents="none">
              {segments.map((seg, sIdx) => (
                <polyline
                  key={`pseg-sub-${sd.id}-${sIdx}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={isHighlighted ? 3 : 2.2}
                  strokeDasharray={seg.dotted ? '1 4' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={seg.points.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')}
                />
              ))}
              {showTakeoffMarker && (
                <circle
                  cx={xForBar(parentArrivalBar)}
                  cy={branchY}
                  r={2.5}
                  fill="#ffffff"
                  stroke={color}
                  strokeWidth={1.6}
                />
              )}
              {sd.hasBoosterPump && branchBoostBar !== null && (() => {
                const effBoost = sd.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                const isCustom = sd.isCustomBoosterPressure;
                const accent = isCustom ? '#1d4ed8' : '#0369a1';
                const fillBg = isCustom ? '#eef2ff' : '#e0f2fe';
                return (
                  <g
                    transform={`translate(${xForBar(branchBoostBar)}, ${branchY})`}
                    data-testid={`profile-booster-marker-${sd.label}`}
                  >
                    <circle
                      r={5.5}
                      fill={fillBg}
                      stroke={accent}
                      strokeWidth={isCustom ? 1.6 : 1.3}
                    />
                    <polygon points="-1.8,-2.3 3,0 -1.8,2.3" fill={accent} />
                    <text
                      x={8}
                      y={3}
                      fontSize={8}
                      fontWeight={700}
                      fontFamily="IBM Plex Mono, monospace"
                      fill={accent}
                    >
                      {sd.label} +{effBoost.toFixed(1)}b{isCustom ? '*' : ''}
                    </text>
                  </g>
                );
              })()}
              {rows.map((r, rIdx) => {
                const c = r.subDropperCells[sd.id];
                const p = c ? (c.workingPressureBar ?? c.pipePressureBar ?? null) : null;
                if (!c || p === null || (!c.isServed && !c.hasPrv)) return null;
                return (
                  <circle
                    key={`pt-sub-${sd.id}-${r.input.id}`}
                    cx={xForBar(p)}
                    cy={rowY(rIdx)}
                    r={c.hasPrv ? 3.5 : 2.3}
                    fill={c.hasPrv ? '#d97706' : color}
                    stroke={c.prvDetail?.isCustomSetPressure ? '#1d4ed8' : 'none'}
                    strokeWidth={c.prvDetail?.isCustomSetPressure ? 1.4 : 0}
                  />
                );
              })}
            </g>
          );
        })}
      </>
    );
  };

  return (
    <div
      className={
        stickyHeader
          ? 'bg-white flex-1 min-h-0 flex flex-col overflow-hidden'
          : 'bg-white'
      }
    >
      {/* Interactive Floor Telemetry Bar */}
      {inspectedRow && (
        <div
          className={`bg-[#f8f8f8] border-b border-[#e0e0e0] px-4 py-1.5 flex flex-wrap items-center justify-between gap-3 text-xs ${
            stickyHeader ? 'shrink-0' : ''
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-[11px] font-bold uppercase text-[#121212]">
              Level {inspectedRow.input.floorLabel}
            </span>
            <span className="text-[#999999]" aria-hidden="true">
              ·
            </span>
            <span className="font-mono tabular-nums text-[#333333]">
              Static Head {inspectedRow.cumulativeHeadM.toFixed(2)} m (
              {inspectedRow.staticPressureBar.toFixed(2)} bar)
            </span>
            <span className="text-[#999999]" aria-hidden="true">
              ·
            </span>
            <span className="font-mono tabular-nums text-[#333333]">
              Working P:{' '}
              {inspectedServedMainCells.length > 0 || inspectedServedSubCells.length > 0 ? (
                <>
                  {inspectedServedMainCells.map((c, i) => {
                    const ds = dropperSummaries.find((d) => d.dropperIndex === c.dropperIndex);
                    const isBoosted = ds?.hasBoosterPump;
                    const effBoost = ds?.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                    const isCustom = ds?.isCustomBoosterPressure;
                    return (
                      <React.Fragment key={`m-${c.dropperIndex}`}>
                        {i > 0 && ', '}
                        <strong
                          className={
                            isBoosted
                              ? isCustom
                                ? 'text-[#1d4ed8]'
                                : 'text-[#0369a1]'
                              : 'text-[#121212]'
                          }
                        >
                          D{c.dropperIndex} (
                          {isBoosted
                            ? `Boost +${effBoost.toFixed(1)}b${isCustom ? '*' : ''}`
                            : 'Grav'}
                          ): {c.workingPressureBar!.toFixed(2)} bar
                        </strong>
                        {c.hasPrv && c.prvDetail && (
                          <span className="text-[#b45309]">
                            {' '}
                            (PRV {c.prvDetail.upstreamPressureBar.toFixed(2)}→
                            {c.prvDetail.downstreamPressureBar.toFixed(2)}
                            {c.prvDetail.isCustomSetPressure ? ' Custom' : ''})
                          </span>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {inspectedServedSubCells.map((c, i) => {
                    const sdObj = subDropperSummaries.find((s) => s.id === c.subDropperId);
                    const sdLabel = sdObj?.label ?? c.subDropperId;
                    const effBoost = sdObj?.boosterPressureBar ?? parameters.boosterPumpBoostBar;
                    const isCustom = sdObj?.isCustomBoosterPressure;
                    const sdMode = sdObj?.hasBoosterPump
                      ? `Boost +${effBoost.toFixed(1)}b${isCustom ? '*' : ''}`
                      : sdObj?.zoneType === 'Booster'
                      ? '←Boost'
                      : 'Grav';
                    return (
                      <React.Fragment key={`s-${c.subDropperId}`}>
                        {(inspectedServedMainCells.length > 0 || i > 0) && ', '}
                        <strong className="text-[#0891b2]">
                          {sdLabel} ({sdMode}): {c.workingPressureBar!.toFixed(2)} bar
                        </strong>
                        {c.hasPrv && c.prvDetail && (
                          <span className="text-[#b45309]">
                            {' '}
                            (PRV {c.prvDetail.upstreamPressureBar.toFixed(2)}→
                            {c.prvDetail.downstreamPressureBar.toFixed(2)}
                            {c.prvDetail.isCustomSetPressure ? ' Custom' : ''})
                          </span>
                        )}
                      </React.Fragment>
                    );
                  })}
                </>
              ) : inspectedRow.input.supplyMode === SupplyMode.ROOF_HEADER ? (
                <strong className="text-[#121212]">Tank Header</strong>
              ) : (
                <strong className="text-[#121212]">—</strong>
              )}
            </span>
          </div>
          <span className="text-[11px] text-[#666666]">Hover floor level to inspect</span>
        </div>
      )}

      {/* Legend Strip (Two-Row Layout) */}
      <div
        className={`px-4 py-1.5 border-b border-[#e0e0e0] bg-white flex flex-col gap-1.5 text-[11px] text-[#555555] ${
          stickyHeader ? 'shrink-0' : ''
        }`}
      >
        {/* Row 1: Reference Indicators & Pressure Parameters Summary */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-[#888888] inline-block" />
              <span>Unreduced Static Head</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-[#15803d] inline-block" />
              <span>PRV Set (Pset)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-[#d90000] inline-block" />
              <span>Max Allowable (Pmax)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dotted border-[#555555] inline-block" />
              <span>Express Pass-Through</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#d97706] inline-block" />
              <span>PRV Station</span>
            </span>
            {(result.boosterDropperPipes > 0 || result.boosterSubDropperPipes > 0) && (
              <span className="inline-flex items-center gap-1.5 text-[#0369a1]">
                <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0" aria-hidden="true">
                  <circle cx="6" cy="6" r="4.8" fill="#e0f2fe" stroke="#0369a1" strokeWidth="1.3" />
                  <polygon points="4.5,3.7 8.8,6 4.5,8.3" fill="#0369a1" />
                </svg>
                <span>Booster Pump</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 font-mono tabular-nums text-[11px] text-[#333333]">
            {(result.boosterDropperPipes > 0 || result.boosterSubDropperPipes > 0) && (
              <>
                <span className="text-[#0369a1] font-medium">
                  Global Boost = +{parameters.boosterPumpBoostBar.toFixed(2)}b
                  {dropperSummaries.some((d) => d.isCustomBoosterPressure) ||
                  subDropperSummaries.some((s) => s.isCustomBoosterPressure) ? (
                    <span className="text-[#1d4ed8]"> (*Custom)</span>
                  ) : null}
                </span>
                <span className="text-[#cccccc]" aria-hidden="true">|</span>
              </>
            )}
            <span>Pset = {parameters.prvSetPressureBar.toFixed(2)}b</span>
            <span className="text-[#cccccc]" aria-hidden="true">|</span>
            <span>Pmax = {parameters.maxStaticPressureBar.toFixed(2)}b</span>
          </div>
        </div>

        {/* Row 2: Dropper & Sub-Dropper Series */}
        {(dropperSummaries.length > 0 || subDropperSummaries.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {dropperSummaries.map((d) => {
              const color = DROPPER_COLORS[(d.dropperIndex - 1) % DROPPER_COLORS.length];
              const isHighlighted =
                highlightedRiser?.kind === 'main' &&
                highlightedRiser.dropperIndex === d.dropperIndex;
              return (
                <span
                  key={`legend-d-${d.dropperIndex}`}
                  className={`inline-flex items-center gap-1.5 ${
                    isHighlighted ? 'font-bold text-[#121212]' : ''
                  }`}
                >
                  <span
                    className="w-3 h-0.5 inline-block"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className={`font-mono ${
                      d.hasBoosterPump
                        ? d.isCustomBoosterPressure
                          ? 'text-[#1d4ed8] font-semibold'
                          : 'text-[#0369a1] font-semibold'
                        : 'text-[#121212]'
                    }`}
                  >
                    D{d.dropperIndex} (
                    {d.hasBoosterPump
                      ? `+${(d.boosterPressureBar ?? parameters.boosterPumpBoostBar).toFixed(1)}b${
                          d.isCustomBoosterPressure ? '*' : ''
                        }`
                      : 'Grav'}
                    )
                  </span>
                </span>
              );
            })}
            {subDropperSummaries.map((sd, sdIdx) => {
              const color = SUB_DROPPER_COLORS[sdIdx % SUB_DROPPER_COLORS.length];
              const isHighlighted =
                highlightedRiser?.kind === 'sub' &&
                highlightedRiser.subDropperId === sd.id;
              return (
                <span
                  key={`legend-sd-${sd.id}`}
                  className={`inline-flex items-center gap-1.5 ${
                    isHighlighted ? 'font-bold text-[#121212]' : ''
                  }`}
                >
                  <span
                    className="w-3 h-0.5 inline-block"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono text-[#0891b2]">
                    {sd.label} (
                    {sd.hasBoosterPump
                      ? `+${(sd.boosterPressureBar ?? parameters.boosterPumpBoostBar).toFixed(1)}b${
                          sd.isCustomBoosterPressure ? '*' : ''
                        }`
                      : sd.zoneType === 'Booster'
                      ? '←Boost'
                      : 'Grav'}{' '}
                    · ←D{sd.parentDropperIndex}@{sd.branchFloorLabel})
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Pressure Profile Chart Canvas */}
      <div
        ref={stickyHeader ? scrollContainerRef : undefined}
        onScroll={
          stickyHeader
            ? (e) => {
                const scrolled = e.currentTarget.scrollTop > 4;
                if (scrolled !== isScrolled) {
                  setIsScrolled(scrolled);
                }
              }
            : undefined
        }
        className={
          stickyHeader
            ? 'flex-1 min-h-0 max-h-[70vh] lg:max-h-none overflow-y-auto overflow-x-auto bg-white relative'
            : 'px-4 py-2 overflow-x-auto'
        }
      >
        <div
          className={stickyHeader ? 'px-4 pb-2 mx-auto' : undefined}
          style={stickyHeader ? { minWidth: '572px', maxWidth: '1072px' } : undefined}
        >
          {stickyHeader && (
            <div
              className={`sticky top-0 z-10 bg-white pt-1.5 transition-shadow ${
                isScrolled ? 'shadow-[0_1px_0_0_#d4d4d4]' : ''
              }`}
            >
              <svg
                viewBox={`0 0 ${chartWidth} ${chartTopPad}`}
                className="w-full h-auto block select-none"
                aria-hidden="true"
              >
                {renderChartHeader(true)}
              </svg>
            </div>
          )}

          <svg
            viewBox={`0 0 ${chartWidth} ${totalSvgHeight}`}
            style={stickyHeader ? undefined : { minWidth: '540px', maxWidth: '1040px' }}
            className={
              stickyHeader
                ? 'w-full h-auto block select-none'
                : 'w-full h-auto mx-auto select-none'
            }
            role="img"
            aria-label="Static and Regulated Pressure Profile Graph"
          >
            {renderChartBodyContent()}
          </svg>
        </div>
      </div>
    </div>
  );
};

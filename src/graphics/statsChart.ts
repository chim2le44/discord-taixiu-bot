import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { RoundHistoryItem, RoundOutcome } from '../engine/types.js';
import { FONT_FAMILY, PALETTE } from './tokens.js';

const WIDTH = 860;
const HEIGHT = 560;

function drawRoundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function outcomeShortName(outcome: RoundOutcome): string {
  if (outcome === 'TAI') return 'TÀI';
  if (outcome === 'XIU') return 'XỈU';
  return 'BÃO';
}

function computeStreak(history: readonly RoundHistoryItem[]): {
  outcome: RoundOutcome;
  count: number;
} | null {
  if (history.length === 0) return null;
  const last = history[history.length - 1].outcome;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].outcome === last) {
      count += 1;
    } else {
      break;
    }
  }
  return count >= 2 ? { outcome: last, count } : null;
}

/**
 * Renders a 20-round dark-mode statistics chart:
 * - Header with Tài/Xỉu/Bão ratios + active streak badge
 * - Top chart: Total dice sum (3..18) with color-coded TAI/XIU/BAO nodes
 * - Bottom chart: Individual dice lines (Xí Ngầu 1, 2, 3)
 */
export function renderStatsChartPng(history: readonly RoundHistoryItem[]): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Canvas background
  ctx.fillStyle = PALETTE.bgCanvas;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Header
  ctx.fillStyle = PALETTE.goldTitle;
  ctx.font = `bold 24px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`THỐNG KÊ ${Math.max(history.length, 20)} PHIÊN`, 26, 30);

  if (history.length > 0) {
    const latest = history[history.length - 1];
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.fillText(
      `Phiên gần nhất: #${latest.roundId} ${outcomeShortName(latest.outcome)} (${latest.d1}-${latest.d2}-${latest.d3})`,
      WIDTH - 26,
      30,
    );
  }

  // Ratio & streak bar
  const total = history.length;
  const taiCnt = history.filter((h) => h.outcome === 'TAI').length;
  const xiuCnt = history.filter((h) => h.outcome === 'XIU').length;
  const baoCnt = history.filter((h) => h.outcome === 'BAO').length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  ctx.textAlign = 'left';
  ctx.font = `600 13px ${FONT_FAMILY}`;
  let cursorX = 28;
  const ratioY = 62;

  const drawRatioChip = (dotColor: string, label: string) => {
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(cursorX + 6, ratioY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.textPrimary;
    ctx.fillText(label, cursorX + 16, ratioY);
    cursorX += ctx.measureText(label).width + 34;
  };

  drawRatioChip(PALETTE.outcomeTai, `Tài: ${pct(taiCnt)}% (${taiCnt})`);
  drawRatioChip(PALETTE.outcomeXiu, `Xỉu: ${pct(xiuCnt)}% (${xiuCnt})`);
  drawRatioChip(PALETTE.outcomeBao, `Bão: ${pct(baoCnt)}% (${baoCnt})`);

  const streak = computeStreak(history);
  if (streak) {
    const streakText = `Bệt ${outcomeShortName(streak.outcome)} x${streak.count}`;
    ctx.font = `bold 13px ${FONT_FAMILY}`;
    const pillW = ctx.measureText(streakText).width + 24;
    const pillX = WIDTH - 26 - pillW;
    drawRoundedRect(ctx, pillX, ratioY - 12, pillW, 24, 12);
    ctx.fillStyle =
      streak.outcome === 'TAI'
        ? PALETTE.outcomeTai
        : streak.outcome === 'XIU'
          ? PALETTE.outcomeXiu
          : PALETTE.outcomeBao;
    ctx.fill();
    ctx.fillStyle = streak.outcome === 'BAO' ? '#111214' : '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(streakText, pillX + pillW / 2, ratioY);
  }

  // Panel 1: Sum chart
  const p1 = { x: 24, y: 86, w: WIDTH - 48, h: 214 };
  drawRoundedRect(ctx, p1.x, p1.y, p1.w, p1.h, 10);
  ctx.fillStyle = PALETTE.bgPanel;
  ctx.fill();
  ctx.strokeStyle = PALETTE.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Panel 2: Individual dice chart
  const p2 = { x: 24, y: 314, w: WIDTH - 48, h: 222 };
  drawRoundedRect(ctx, p2.x, p2.y, p2.w, p2.h, 10);
  ctx.fillStyle = PALETTE.bgPanel;
  ctx.fill();
  ctx.strokeStyle = PALETTE.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (history.length === 0) {
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = `16px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('Chưa có dữ liệu phiên đã mở bát để vẽ biểu đồ.', WIDTH / 2, p1.y + p1.h / 2);
    ctx.fillText('Hãy chơi ít nhất 1 phiên Tài Xỉu rồi xem lại nhé!', WIDTH / 2, p2.y + p2.h / 2);
    return canvas.toBuffer('image/png');
  }

  // Shared horizontal positions for up to 20 points
  const plotLeft = p1.x + 54;
  const plotRight = p1.x + p1.w - 28;
  const xForIndex = (i: number) =>
    history.length === 1
      ? (plotLeft + plotRight) / 2
      : plotLeft + (i / (history.length - 1)) * (plotRight - plotLeft);

  // --- Draw Panel 1 (Sum 3..18) ---
  const p1Top = p1.y + 24;
  const p1Bottom = p1.y + p1.h - 22;
  const yForSum = (sum: number) => p1Bottom - ((sum - 3) / 15) * (p1Bottom - p1Top);

  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = 'right';
  for (const tick of [3, 6, 9, 12, 15, 18]) {
    const ty = yForSum(tick);
    ctx.strokeStyle = PALETTE.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft - 10, ty);
    ctx.lineTo(plotRight + 8, ty);
    ctx.stroke();

    ctx.fillStyle = PALETTE.textMuted;
    ctx.fillText(String(tick), plotLeft - 16, ty);
  }

  // Subtle dashed TAI/XIU threshold at 10.5
  const thresholdY = yForSum(10.5);
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = '#525666';
  ctx.beginPath();
  ctx.moveTo(plotLeft - 10, thresholdY);
  ctx.lineTo(plotRight + 8, thresholdY);
  ctx.stroke();
  ctx.restore();

  // Vertical gridlines
  for (let i = 0; i < history.length; i += 1) {
    const px = xForIndex(i);
    ctx.strokeStyle = 'rgba(56, 58, 66, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, p1Top);
    ctx.lineTo(px, p1Bottom);
    ctx.stroke();
  }

  // Connecting white line
  ctx.strokeStyle = PALETTE.textPrimary;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  history.forEach((h, i) => {
    const sum = h.d1 + h.d2 + h.d3;
    const px = xForIndex(i);
    const py = yForSum(sum);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Sum badges
  ctx.textAlign = 'center';
  ctx.font = `bold 12px ${FONT_FAMILY}`;
  history.forEach((h, i) => {
    const sum = h.d1 + h.d2 + h.d3;
    const px = xForIndex(i);
    const py = yForSum(sum);
    const r = 13.5;

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    if (h.outcome === 'TAI') {
      ctx.fillStyle = PALETTE.taiFill;
      ctx.strokeStyle = PALETTE.taiStroke;
    } else if (h.outcome === 'XIU') {
      ctx.fillStyle = PALETTE.xiuFill;
      ctx.strokeStyle = PALETTE.xiuStroke;
    } else {
      ctx.fillStyle = PALETTE.baoFill;
      ctx.strokeStyle = PALETTE.baoStroke;
    }
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle =
      h.outcome === 'TAI'
        ? PALETTE.taiText
        : h.outcome === 'XIU'
          ? PALETTE.xiuText
          : PALETTE.baoText;
    ctx.fillText(String(sum), px, py + 0.5);
  });

  // --- Draw Panel 2 (3 Dice lines 1..6) ---
  const legendY = p2.y + 20;
  const legendItems = [
    { label: 'Xí Ngầu 1', color: PALETTE.die1 },
    { label: 'Xí Ngầu 2', color: PALETTE.die2 },
    { label: 'Xí Ngầu 3', color: PALETTE.die3 },
  ];
  const legendStartX = WIDTH / 2 - 170;
  ctx.font = `600 13px ${FONT_FAMILY}`;
  ctx.textAlign = 'left';
  legendItems.forEach((item, idx) => {
    const lx = legendStartX + idx * 125;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(lx, legendY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.textPrimary;
    ctx.fillText(item.label, lx + 12, legendY);
  });

  const p2Top = p2.y + 44;
  const p2Bottom = p2.y + p2.h - 22;
  const yForDie = (v: number) => p2Bottom - ((v - 1) / 5) * (p2Bottom - p2Top);

  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = 'right';
  for (let tick = 1; tick <= 6; tick += 1) {
    const ty = yForDie(tick);
    ctx.strokeStyle = PALETTE.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft - 10, ty);
    ctx.lineTo(plotRight + 8, ty);
    ctx.stroke();

    ctx.fillStyle = PALETTE.textMuted;
    ctx.fillText(String(tick), plotLeft - 16, ty);
  }

  for (let i = 0; i < history.length; i += 1) {
    const px = xForIndex(i);
    ctx.strokeStyle = 'rgba(56, 58, 66, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, p2Top);
    ctx.lineTo(px, p2Bottom);
    ctx.stroke();
  }

  const series: ReadonlyArray<{ color: string; pick: (h: RoundHistoryItem) => number }> = [
    { color: PALETTE.die1, pick: (h) => h.d1 },
    { color: PALETTE.die2, pick: (h) => h.d2 },
    { color: PALETTE.die3, pick: (h) => h.d3 },
  ];

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    history.forEach((h, i) => {
      const px = xForIndex(i);
      const py = yForDie(s.pick(h));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.fillStyle = s.color;
    history.forEach((h, i) => {
      const px = xForIndex(i);
      const py = yForDie(s.pick(h));
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  return canvas.toBuffer('image/png');
}

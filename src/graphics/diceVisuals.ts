import { createRequire } from 'node:module';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type * as GifencTypes from 'gifenc';
import { classifyRoll, getParity } from '../engine/dice.js';
import type { DiceRoll } from '../engine/types.js';
import { FONT_FAMILY, PALETTE } from './tokens.js';

const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require('gifenc') as typeof GifencTypes;

const PIP_POSITIONS: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.24],
    [0.73, 0.24],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.76],
    [0.73, 0.76],
  ],
};

/**
 * Draws a rounded die (1..6 with Asian-style red pips for 1 & 4) or an unrevealed `?` slot.
 */
export function drawDie(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  value: number | null,
): void {
  const radius = Math.round(size * 0.18);

  ctx.save();
  ctx.shadowColor = PALETTE.dieFaceShadow;
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.fillStyle = value === null ? PALETTE.mysteryBg : PALETTE.dieFaceBg;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.strokeStyle = value === null ? PALETTE.mysteryBorder : PALETTE.dieFaceBorder;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  if (value === null) {
    ctx.fillStyle = PALETTE.goldTitle;
    ctx.font = `bold ${Math.round(size * 0.48)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + size / 2, y + size / 2 + 2);
    return;
  }

  const pips = PIP_POSITIONS[value] ?? [];
  const pipRadius = value === 1 ? size * 0.13 : size * 0.092;
  ctx.fillStyle = value === 1 || value === 4 ? PALETTE.pipRed : PALETTE.pipDark;

  for (const [px, py] of pips) {
    ctx.beginPath();
    ctx.arc(x + size * px, y + size * py, pipRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Renders the 3-dice reveal image for step 1 (`[d1][?][?]`), step 2 (`[d1][d2][?]`),
 * or final step 3 (`[d1][d2][d3]`).
 */
export function renderDiceRevealPng(params: {
  dice: DiceRoll;
  revealedCount: 1 | 2 | 3;
  roundId: number;
}): Buffer {
  const width = 520;
  const height = 195;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PALETTE.bgCanvas;
  ctx.fillRect(0, 0, width, height);

  const dieSize = 108;
  const gap = 26;
  const startX = (width - (dieSize * 3 + gap * 2)) / 2;
  const dieY = 20;

  for (let i = 0; i < 3; i += 1) {
    const val = i < params.revealedCount ? params.dice[i] : null;
    drawDie(ctx, startX + i * (dieSize + gap), dieY, dieSize, val);
  }

  // Bottom status bar
  const barY = 144;
  const barH = 36;
  ctx.beginPath();
  ctx.roundRect(24, barY, width - 48, barH, 10);
  ctx.fillStyle = PALETTE.bgPanel;
  ctx.fill();
  ctx.strokeStyle = PALETTE.borderSubtle;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  const textY = barY + barH / 2;

  if (params.revealedCount === 1) {
    ctx.fillStyle = PALETTE.textPrimary;
    ctx.font = `600 15px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Mở viên 1: [ ${params.dice[0]} ] — Đang mở tiếp...`, width / 2, textY);
  } else if (params.revealedCount === 2) {
    const tempSum = params.dice[0] + params.dice[1];
    ctx.fillStyle = PALETTE.goldTitle;
    ctx.font = `bold 15px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(
      `Tạm tính: ${params.dice[0]} + ${params.dice[1]} = ${tempSum} — Chờ viên cuối!`,
      width / 2,
      textY,
    );
  } else {
    const { sum, outcome } = classifyRoll(params.dice);
    const parity = getParity(sum);
    const outcomeText = outcome === 'BAO' ? 'BÃO' : `${outcome === 'TAI' ? 'TÀI' : 'XỈU'} - ${parity}`;

    ctx.fillStyle = PALETTE.textPrimary;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(
      `Phiên #${params.roundId}: ${params.dice[0]} + ${params.dice[1]} + ${params.dice[2]} = ${sum}`,
      42,
      textY,
    );

    ctx.font = `bold 13px ${FONT_FAMILY}`;
    const pillW = ctx.measureText(outcomeText).width + 26;
    const pillX = width - 38 - pillW;
    ctx.beginPath();
    ctx.roundRect(pillX, barY + 6, pillW, 24, 12);
    ctx.fillStyle =
      outcome === 'TAI'
        ? PALETTE.outcomeTai
        : outcome === 'XIU'
          ? PALETTE.outcomeXiu
          : PALETTE.outcomeBao;
    ctx.fill();

    ctx.fillStyle = outcome === 'BAO' ? '#111214' : '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(outcomeText, pillX + pillW / 2, textY);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Renders a 2-row dice comparison card for `/solo` 1v1 duels.
 */
export function renderSoloComparisonPng(params: {
  challengerName: string;
  challengerDice: DiceRoll;
  opponentName: string;
  opponentDice: DiceRoll;
}): Buffer {
  const width = 560;
  const height = 240;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PALETTE.bgCanvas;
  ctx.fillRect(0, 0, width, height);

  const cSum = params.challengerDice[0] + params.challengerDice[1] + params.challengerDice[2];
  const oSum = params.opponentDice[0] + params.opponentDice[1] + params.opponentDice[2];

  const drawRow = (
    rowY: number,
    name: string,
    dice: DiceRoll,
    sum: number,
    isWinner: boolean,
  ) => {
    ctx.beginPath();
    ctx.roundRect(18, rowY, width - 36, 98, 12);
    ctx.fillStyle = PALETTE.bgPanel;
    ctx.fill();
    ctx.strokeStyle = isWinner ? PALETTE.goldTitle : PALETTE.borderSubtle;
    ctx.lineWidth = isWinner ? 2 : 1;
    ctx.stroke();

    const safeName = name.length > 16 ? `${name.slice(0, 15)}…` : name;
    ctx.fillStyle = isWinner ? PALETTE.goldTitle : PALETTE.textPrimary;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(isWinner ? `👑 ${safeName}` : safeName, 34, rowY + 34);

    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = `600 14px ${FONT_FAMILY}`;
    ctx.fillText(`Tổng: ${sum} điểm`, 34, rowY + 64);

    const dieSize = 66;
    const gap = 14;
    const diceStartX = width - 34 - (dieSize * 3 + gap * 2);
    for (let i = 0; i < 3; i += 1) {
      drawDie(ctx, diceStartX + i * (dieSize + gap), rowY + 16, dieSize, dice[i]);
    }
  };

  drawRow(16, params.challengerName, params.challengerDice, cSum, cSum > oSum);
  drawRow(126, params.opponentName, params.opponentDice, oSum, oSum > cSum);

  return canvas.toBuffer('image/png');
}

let cachedBowlGif: Buffer | null = null;

/**
 * Generates and caches an animated GIF showing a traditional bowl shaking over a plate.
 */
export function getBowlShakeGif(): Buffer {
  if (cachedBowlGif) {
    return cachedBowlGif;
  }

  const width = 420;
  const height = 200;
  const frameCount = 12;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const encoder = GIFEncoder();

  for (let frame = 0; frame < frameCount; frame += 1) {
    const phase = (frame / frameCount) * Math.PI * 2;
    const dx = Math.sin(phase * 2) * 14;
    const dy = -Math.abs(Math.cos(phase * 2)) * 5;
    const tilt = Math.sin(phase * 2) * 0.08;

    // Dark felt background
    ctx.fillStyle = PALETTE.bgCanvas;
    ctx.fillRect(0, 0, width, height);

    // Subtle green/charcoal felt table oval
    ctx.beginPath();
    ctx.ellipse(width / 2, 128, 175, 42, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#23272F';
    ctx.fill();
    ctx.strokeStyle = PALETTE.borderSubtle;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Ceramic plate under the bowl
    ctx.beginPath();
    ctx.ellipse(width / 2, 126, 98, 25, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#E5E7EB';
    ctx.fill();
    ctx.strokeStyle = '#9CA3AF';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(width / 2, 125, 74, 16, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Motion arc lines around the shaking bowl
    ctx.strokeStyle = PALETTE.goldTitle;
    ctx.lineWidth = 2.5;
    const arcAlpha = 0.45 + 0.4 * Math.abs(Math.sin(phase * 2));
    ctx.save();
    ctx.globalAlpha = arcAlpha;
    ctx.beginPath();
    ctx.arc(width / 2 - 86, 86, 22, Math.PI * 0.72, Math.PI * 1.28);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(width / 2 + 86, 86, 22, -Math.PI * 0.28, Math.PI * 0.28);
    ctx.stroke();
    ctx.restore();

    // Shaking inverted bowl
    ctx.save();
    ctx.translate(width / 2 + dx, 118 + dy);
    ctx.rotate(tilt);

    // Bowl dome
    ctx.beginPath();
    ctx.ellipse(0, 0, 68, 56, 0, Math.PI, 0);
    ctx.quadraticCurveTo(68, 8, 0, 8);
    ctx.quadraticCurveTo(-68, 8, -68, 0);
    ctx.closePath();

    const grad = ctx.createLinearGradient(-60, -55, 60, 10);
    grad.addColorStop(0, '#3F4454');
    grad.addColorStop(0.45, '#272A34');
    grad.addColorStop(1, '#14161C');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = PALETTE.goldTitle;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Decorative gold rim & top knob
    ctx.beginPath();
    ctx.ellipse(0, 2, 66, 9, 0, 0, Math.PI);
    ctx.strokeStyle = PALETTE.goldTitle;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -56, 9, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.goldTitle;
    ctx.fill();
    ctx.restore();

    // Bottom status text
    const dots = '.'.repeat((frame % 3) + 1);
    ctx.fillStyle = PALETTE.goldTitle;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ĐANG LẮC BÁT${dots}`, width / 2, 182);

    const imageData = ctx.getImageData(0, 0, width, height);
    const palette = quantize(imageData.data, 128);
    const index = applyPalette(imageData.data, palette);
    encoder.writeFrame(index, width, height, {
      palette,
      delay: 90,
      repeat: 0,
    });
  }

  encoder.finish();
  cachedBowlGif = Buffer.from(encoder.bytes());
  return cachedBowlGif;
}

import { randomInt } from 'node:crypto';
import { GAME_CONFIG, type DiceRoll, type RoundOutcome } from './types.js';

/** Roll three fair 6-sided dice using Node's CSPRNG. */
export function rollDice(): DiceRoll {
  return [randomInt(1, 7), randomInt(1, 7), randomInt(1, 7)];
}

/** Determine randomly whether a new round is a Golden Round. */
export function rollIsGolden(chance: number = GAME_CONFIG.GOLDEN_ROUND_CHANCE): boolean {
  const clamped = Math.max(0, Math.min(1, chance));
  return randomInt(0, 10_000) < Math.round(clamped * 10_000);
}

/** Classify a 3-dice roll into TAI (11-17), XIU (4-10), or BAO (triple). */
export function classifyRoll(dice: DiceRoll): {
  sum: number;
  outcome: RoundOutcome;
  isBao: boolean;
} {
  const [d1, d2, d3] = dice;
  const sum = d1 + d2 + d3;
  const isBao = d1 === d2 && d2 === d3;
  if (isBao) {
    return { sum, outcome: 'BAO', isBao: true };
  }
  return {
    sum,
    outcome: sum >= 11 ? 'TAI' : 'XIU',
    isBao: false,
  };
}

/** Return Vietnamese parity label for a dice sum. */
export function getParity(sum: number): 'CHẴN' | 'LẺ' {
  return sum % 2 === 0 ? 'CHẴN' : 'LẺ';
}

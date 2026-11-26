import { randomInt } from 'node:crypto';

/**
 * Draws a random integer share for one lixi slot using double-average bounds
 * while reserving at least 1 xu for every remaining slot.
 */
export function drawLixiAmount(remainingPool: number, remainingSlots: number): number {
  if (remainingSlots <= 0 || remainingPool <= 0) {
    throw new Error('Invalid lixi pool or slot count.');
  }
  if (remainingPool < remainingSlots) {
    throw new Error('Remaining lixi pool cannot be smaller than remaining slots.');
  }
  if (remainingSlots === 1) {
    return remainingPool;
  }

  const maxAllowed = Math.min(
    remainingPool - (remainingSlots - 1),
    Math.max(1, Math.floor((remainingPool / remainingSlots) * 2)),
  );

  if (maxAllowed <= 1) {
    return 1;
  }
  return randomInt(1, maxAllowed + 1);
}

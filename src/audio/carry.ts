/**
 * P-14 (15 Nov) Listen <-> Watch: the position to carry over when switching media
 * on the same lesson. The element's clock wins when it has a real value; otherwise
 * (not loaded yet) the saved resume point is used, so a switch never jumps to 0.
 */
export function carryPosition(elementPos: number, savedPos: number): number {
  return Number.isFinite(elementPos) && elementPos > 0 ? elementPos : Math.max(0, Number(savedPos) || 0);
}

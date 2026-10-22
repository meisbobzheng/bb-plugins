import type { CSSProperties } from "react";
import { hash } from "../../spectrum";

export const FILLS = ["pink", "mint", "butter", "lilac", "sky"] as const;
export const DOODLES = ["star", "heart", "moon", "cloud", "sparkle", "note", "flower"] as const;
export type DoodleKind = (typeof DOODLES)[number];

const FRESH_DAYS = [7, 14, 30, 60, 90, 180, 365] as const;

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function tilt(seed: string, range = 2): number {
  return ((hash(seed) % 1001) / 1000) * 2 * range - range;
}

export const fillOf = (seed: string): string => `var(--${FILLS[hash(seed) % FILLS.length]})`;

export const doodleOf = (seed: string): DoodleKind => DOODLES[(hash(seed) >>> 5) % DOODLES.length]!;

export const fractionAt = (clientX: number, left: number, width: number): number => (width > 0 ? clamp((clientX - left) / width, 0, 1) : 0);

const DIAL_SWEEP = 135;

export const dialAngle = (percent: number): number => -DIAL_SWEEP + (clamp(percent, 0, 100) / 100) * DIAL_SWEEP * 2;

export function dialPercent(dx: number, dy: number): number {
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.round(((clamp(angle, -DIAL_SWEEP, DIAL_SWEEP) + DIAL_SWEEP) / (DIAL_SWEEP * 2)) * 100);
}

export function stepDays(days: number, direction: 1 | -1): number {
  const next = direction === 1 ? FRESH_DAYS.find((value) => value > days) : [...FRESH_DAYS].reverse().find((value) => value < days);
  return next ?? days;
}

export function scallop(bumps: number, radius: number, depth: number, center = 50): string {
  const point = (turn: number, distance: number) => {
    const angle = turn * Math.PI * 2 - Math.PI / 2;
    return `${(center + Math.cos(angle) * distance).toFixed(1)} ${(center + Math.sin(angle) * distance).toFixed(1)}`;
  };
  let path = `M${point(0, radius)}`;
  for (let index = 1; index <= bumps; index += 1) path += `Q${point((index - 0.5) / bumps, radius + depth)} ${point(index / bumps, radius)}`;
  return `${path}Z`;
}

export interface Springs {
  position: Float32Array;
  velocity: Float32Array;
}

export const springs = (count: number): Springs => ({ position: new Float32Array(count), velocity: new Float32Array(count) });

export function wobble(state: Springs, targets: Float32Array, seconds: number, stiffness = 170, damping = 11): void {
  const dt = clamp(seconds, 0, 0.05);
  for (let index = 0; index < state.position.length; index += 1) {
    const acceleration = stiffness * ((targets[index] ?? 0) - state.position[index]!) - damping * state.velocity[index]!;
    state.velocity[index] += acceleration * dt;
    state.position[index] += state.velocity[index]! * dt;
  }
}

export const squash = (velocity: number): number => clamp(1 - velocity * 0.05, 0.72, 1.3);

export const vars = (values: Record<`--${string}`, string>): CSSProperties => values as CSSProperties;

export const stuck = (seed: string, range = 2, fill = fillOf(seed)): CSSProperties => vars({ "--tilt": `${tilt(seed, range).toFixed(2)}deg`, "--fill": fill });

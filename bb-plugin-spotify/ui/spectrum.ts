import { useEffect, useRef } from "react";

export function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

export function bpmFor(trackId: string | null | undefined): number {
  return trackId ? 84 + (hash(trackId) % 49) : 112;
}

export function envelope(fraction: number): number {
  if (fraction < 0.06) return 0.45 + fraction * 5;
  if (fraction > 0.92) return Math.max(0.2, 0.75 - (fraction - 0.92) * 6);
  return 0.7 + 0.25 * Math.sin(fraction * Math.PI * 2.3 - 0.6);
}

export interface Signal {
  playing: boolean;
  progressMs: number;
  durationMs: number;
  trackId: string | null;
}

export function beat(signal: Signal): number {
  const seconds = signal.progressMs / 1000;
  return signal.playing ? Math.pow(Math.max(0, Math.sin(seconds * Math.PI * (bpmFor(signal.trackId) / 60))), 10) : 0;
}

export function energy(signal: Signal): number {
  if (!signal.playing) return 0;
  return envelope(signal.durationMs > 0 ? signal.progressMs / signal.durationMs : 0) * (0.55 + 0.45 * beat(signal));
}

export function fillLevels(out: Float32Array, signal: Signal, wallSeconds: number): void {
  const bands = out.length;
  if (!signal.playing) {
    out.fill(0);
    return;
  }
  const seed = hash(signal.trackId ?? "") % 997;
  const kick = beat(signal);
  const shape = envelope(signal.durationMs > 0 ? signal.progressMs / signal.durationMs : 0);
  for (let band = 0; band < bands; band += 1) {
    const position = band / Math.max(1, bands - 1);
    const tilt = 1 - position * 0.55;
    const wobble = 0.5 + 0.5 * Math.sin(wallSeconds * (1.1 + position * 6.3) + band * 1.7 + seed) * Math.sin(wallSeconds * 0.55 + band * 0.9 + seed * 0.3);
    const hit = kick * (position < 0.32 ? 1 : 0.35);
    const noise = (Math.sin(wallSeconds * 37.1 + band * 12.9 + seed) + 1) * 0.04;
    out[band] = Math.min(1, ((0.22 + 0.5 * wobble) * shape + 0.48 * hit) * tilt + noise);
  }
}

export function useFrame(callback: (now: number) => void, active: boolean, fps = 60, deps: readonly unknown[] = []): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (!active) {
      latest.current(Date.now());
      return;
    }
    let frame = 0;
    let last = -Infinity;
    const interval = 1000 / fps;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < interval - 1) return;
      last = now;
      latest.current(Date.now());
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active, fps, ...deps]);
}

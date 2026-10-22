import { useEffect, useRef, useState } from "react";
import type { Device, PlayerState } from "../../../contract";
import { useArt, useSample, type Sample } from "../../art";
import { clock } from "../../format";
import { progressAt } from "../../model";
import { beat, energy, fillLevels, useFrame } from "../../spectrum";
import { signalOf } from "../console/visuals";

type Tone = (u: number, v: number) => [number, number];

interface Inks {
  ink: string;
  accent: string;
  rule: string;
  dark: boolean;
  shift: number;
}

function inksOf(element: HTMLElement): Inks {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { ink: read("--l-plate-ink"), accent: read("--l-plate-accent"), rule: read("--l-rule"), dark: read("--l-plate-mode") === "dark", shift: Number(read("--l-plate-shift")) || 0 };
}

function fit(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  const [w, h] = [Math.round(width * ratio), Math.round(height * ratio)];
  if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
  const context = canvas.getContext("2d");
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  context?.clearRect(0, 0, width, height);
  return context;
}

function sampled(sample: Sample, dark: boolean): Tone {
  return (u, v) => {
    const index = Math.min(sample.rows - 1, Math.floor(v * sample.rows)) * sample.cols + Math.min(sample.cols - 1, Math.floor(u * sample.cols));
    const luma = sample.luma[index]!;
    const [r, g, b] = [sample.rgb[index * 3]!, sample.rgb[index * 3 + 1]!, sample.rgb[index * 3 + 2]!];
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const light = dark ? luma : 1 - luma;
    return [Math.pow(Math.max(0, (light - 0.1) / 0.9), 1.2), Math.min(1, chroma * 1.3) * (dark ? 0.8 : 0.9)];
  };
}

function sun(time: number, kick: number): Tone {
  return (u, v) => {
    const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.58) * (2.6 - kick * 0.5));
    const wave = 0.5 + 0.5 * Math.sin(v * 12 - time * 1.2 + Math.sin(u * 6.6 + time * 0.4));
    return v > 0.62 ? [0.25 + 0.55 * wave * v, 0] : [0, glow];
  };
}

function screen(context: CanvasRenderingContext2D, size: number, step: number, angle: number, level: (u: number, v: number) => number, color: string, swell: number, shift: number) {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const reach = Math.ceil((size * 0.75) / step);
  context.fillStyle = color;
  context.beginPath();
  for (let i = -reach; i <= reach; i += 1)
    for (let j = -reach; j <= reach; j += 1) {
      const x = size / 2 + (i * cos - j * sin) * step + shift;
      const y = size / 2 + (i * sin + j * cos) * step - shift * 0.6;
      if (x < -step / 2 || y < -step / 2 || x > size + step / 2 || y > size + step / 2) continue;
      const value = level(Math.min(0.999, Math.max(0, x / size)), Math.min(0.999, Math.max(0, y / size)));
      if (value < 0.03) continue;
      const radius = Math.min(step * 0.72, step * 0.56 * Math.sqrt(value) * swell);
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
  context.fill();
}

export function Halftone({ player, demo, size, palette }: { player: PlayerState; demo: boolean; size: number; palette: string }) {
  const art = useArt(player.track?.album.imageUrl, demo);
  const sample = useSample(art, 48, 48);
  const canvas = useRef<HTMLCanvasElement>(null);
  useFrame(
    (now) => {
      const element = canvas.current;
      if (element === null) return;
      const context = fit(element, size, size);
      if (context === null) return;
      const inks = inksOf(element);
      const kick = player.isPlaying ? beat(signalOf(player, Date.now())) : 0;
      const tone = sample === null ? sun(player.isPlaying ? now / 1000 : 0, kick) : sampled(sample, inks.dark);
      const step = size / (size > 100 ? 30 : 15);
      context.save();
      context.beginPath();
      context.rect(0, 0, size, size);
      context.clip();
      context.globalCompositeOperation = inks.dark ? "screen" : "multiply";
      screen(context, size, step, 0.26, (u, v) => tone(u, v)[1], inks.accent, 1 + 0.16 * kick, inks.shift);
      screen(context, size, step, Math.PI / 4, (u, v) => tone(u, v)[0], inks.ink, 1 + 0.1 * kick, 0);
      context.restore();
    },
    player.isPlaying,
    30,
    [sample, palette, size],
  );
  return <canvas ref={canvas} className="l-plate" aria-hidden="true" />;
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const seekFrom = (event: React.MouseEvent<HTMLElement>, duration: number, onSeek: (ms: number) => void) => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (duration > 0) onSeek(((event.clientX - rect.left) / rect.width) * duration);
};

export function Oscillogram({ player, palette, onSeek }: { player: PlayerState; palette: string; onSeek(ms: number): void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useWidth(box);
  const levels = useRef(new Float32Array(6));
  useFrame(
    (now) => {
      const element = canvas.current;
      if (element === null || width === 0) return;
      const height = element.clientHeight;
      const context = fit(element, width, height);
      if (context === null) return;
      const inks = inksOf(element);
      const signal = signalOf(player, Date.now());
      const level = levels.current;
      fillLevels(level, signal, now / 1000);
      const time = signal.playing ? now / 1000 : 0;
      const amount = signal.playing ? 0.35 + 0.65 * energy(signal) : 0.04;
      const played = signal.durationMs > 0 ? signal.progressMs / signal.durationMs : 0;
      context.strokeStyle = inks.rule;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
      for (const pass of [0, 1]) {
        context.beginPath();
        context.strokeStyle = pass ? inks.accent : inks.ink;
        context.lineWidth = pass ? 2 : 1.1;
        for (let x = 0; x <= width; x += 1.5) {
          const u = x / width;
          if (pass && u > played) break;
          const band = u * (level.length - 1);
          const low = Math.floor(band);
          const local = level[low]! + ((level[Math.min(level.length - 1, low + 1)] ?? 0) - level[low]!) * (band - low);
          const shape = Math.sin(u * Math.PI) * (pass ? 1 : 0.8) * (signal.playing ? 0.55 + 0.9 * local : 1);
          const wave = Math.sin(u * 90 + time * 6) * 0.6 + Math.sin(u * 37 - time * 3.1) * 0.4 + Math.sin(u * 211 + time * 13) * 0.18;
          const y = height / 2 + shape * amount * height * 0.42 * wave;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
    },
    player.isPlaying,
    30,
    [width, palette, player.progressMs, player.fetchedAt, player.track?.id],
  );
  return (
    <div ref={box} className="l-scope" onClick={(event) => seekFrom(event, player.track?.durationMs ?? 0, onSeek)} title="Click to seek">
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}

export function ProgressRule({ player, onSeek, compact = false }: { player: PlayerState; onSeek(ms: number): void; compact?: boolean }) {
  const fill = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const duration = player.track?.durationMs ?? 0;
  const share = (position: number) => `${duration > 0 ? (position / duration) * 100 : 0}%`;
  useFrame(
    () => {
      const position = progressAt(player, Date.now());
      fill.current?.style.setProperty("--played", share(position));
      if (elapsed.current !== null) elapsed.current.textContent = clock(position);
    },
    player.isPlaying,
    8,
    [player.progressMs, player.fetchedAt, duration],
  );
  return (
    <div className={`l-progress l-num ${compact ? "l-compact" : ""}`}>
      <span ref={elapsed}>{clock(progressAt(player, Date.now()))}</span>
      <div
        ref={fill}
        className="l-bar"
        style={{ "--played": share(progressAt(player, Date.now())) } as React.CSSProperties}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={player.progressMs}
        onClick={(event) => seekFrom(event, duration, onSeek)}
      >
        <i />
        <b />
      </div>
      <span>{clock(duration)}</span>
    </div>
  );
}

export function VolumeRule({ device, onChange }: { device: Device | null; onChange(percent: number): void }) {
  const rule = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLSpanElement>(null);
  const volume = device?.volumePercent ?? null;
  const usable = volume !== null && device?.supportsVolume !== false;
  const show = (percent: number) => {
    rule.current?.style.setProperty("--level", `${percent}%`);
    if (figure.current !== null) figure.current.textContent = String(percent);
  };
  useEffect(() => {
    if (volume !== null) show(volume);
  }, [volume]);
  const at = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 100);
  };
  return (
    <div className={`l-volume ${usable ? "" : "l-off"}`}>
      <span className="l-sc">Volume</span>
      <div
        ref={rule}
        className="l-vrule"
        style={{ "--level": `${volume ?? 0}%` } as React.CSSProperties}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volume ?? 0}
        onPointerDown={(event) => {
          if (!usable) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          show(at(event));
        }}
        onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && show(at(event))}
        onPointerUp={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && onChange(at(event))}
      >
        <i />
      </div>
      <span ref={figure} className="l-num l-vfig">
        {volume ?? "—"}
      </span>
    </div>
  );
}

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlayerState, Track } from "../../../contract";
import { useArt, useSample } from "../../art";
import { clock } from "../../format";
import { progressAt } from "../../model";
import { beat, fillLevels, useFrame } from "../../spectrum";
import { signalOf } from "../console/visuals";
import { coverTones, fitPixels, GLYPHS, headCell, ICONS, identicon, pixelable, plain, runs, textPath, tonePaths, vox, type IconName } from "./pixels";
import { cityGrid, donut, type CityShape } from "./scene";

export type VisMode = "waterfall" | "skyline" | "off";
export const VIS_MODES: VisMode[] = ["waterfall", "skyline", "off"];

export function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function Pixels({ text, scale = 2, shadow = false, className = "" }: { text: string; scale?: number; shadow?: boolean; className?: string }) {
  if (!pixelable(text))
    return (
      <span className={`v-pxfb ${className}`} style={{ fontSize: 7 * scale + 1 }}>
        {text}
      </span>
    );
  const { d, width, height } = textPath(text, scale);
  const offset = shadow ? scale : 0;
  const [w, h] = [width + offset, height + offset];
  return (
    <svg className={`v-pt ${className}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role="img" aria-label={text}>
      <title>{text}</title>
      {shadow ? <path className="v-ts" transform={`translate(${offset} ${offset})`} d={d} /> : null}
      <path d={d} />
    </svg>
  );
}

export function PixelTitle({ text, scales, lines, className = "" }: { text: string; scales: number[]; lines: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  if (!pixelable(text))
    return (
      <div ref={box} className={`v-title v-title-text ${className}`} style={{ WebkitLineClamp: lines, fontSize: scales[scales.length - 1]! * 7 + 2 }} title={text}>
        {text}
      </div>
    );
  const fit = fitPixels(plain(text), width - scales[0]!, scales, lines);
  return (
    <div ref={box} className={`v-title ${className}`}>
      {fit.lines.map((line, index) => (
        <Pixels key={index} text={line} scale={fit.scale} shadow />
      ))}
    </div>
  );
}

export function Icon({ name, scale = 2, className = "" }: { name: IconName; scale?: number; className?: string }) {
  const rows = ICONS[name];
  const [w, h] = [rows[0]!.length * scale, rows.length * scale];
  return (
    <svg className={`v-ic ${className}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true">
      <path d={runs(rows, scale)} />
    </svg>
  );
}

const IDENT_FILLS = ["var(--v-hi)", "var(--v-hi2)", "var(--v-hi3)", "var(--v-title)"];

export function Ident({ seed, liked = false }: { seed: string; liked?: boolean }) {
  const { rows, tone } = identicon(seed);
  return (
    <svg className="v-ic v-ident" width="16" height="16" viewBox="-1 -1 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="-1" y="-1" width="16" height="16" />
      <path style={{ fill: liked ? "var(--v-hi2)" : IDENT_FILLS[tone] }} d={runs(liked ? ICONS.heart : rows, 2)} />
    </svg>
  );
}

const COVER_FILLS = ["--v-surf2", "--v-line", "--v-hi", "--v-hi2", "--v-title"];

export function Cover({ track, demo, scale }: { track: Track | null; demo: boolean; scale: number }) {
  const art = useArt(track?.album.imageUrl, demo);
  const sample = useSample(art, 16, 16);
  const paths = useMemo(() => tonePaths(coverTones(sample?.luma ?? null, 16), 16, scale), [sample, scale]);
  const size = 16 * scale;
  return (
    <svg className="v-ic v-cover" width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={track ? `${track.album.name} cover` : "No cover"}>
      {paths.map((d, index) => (
        <path key={index} style={{ fill: `var(${COVER_FILLS[index]})` }} d={d} />
      ))}
    </svg>
  );
}

const degrees = (radians: number) => String(Math.abs(Math.round(radians * 57.3))).padStart(2, "0");

export function Record({ player, demo, cols, rows, labels }: { player: PlayerState; demo: boolean; cols: number; rows: number; labels: boolean }) {
  const pre = useRef<HTMLPreElement>(null);
  const angle = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState({ aspect: 0.6, width: 0 });
  const render = useMemo(() => donut(cols, rows), [cols, rows]);
  const pose = useRef({ spin: 0.6, tumble: 0, last: 0 });
  const live = player.isPlaying && player.track !== null;
  useLayoutEffect(() => {
    const element = pre.current;
    if (element === null) return;
    const probe = document.createElement("span");
    probe.textContent = "@".repeat(20);
    element.appendChild(probe);
    const charWidth = probe.getBoundingClientRect().width / 20;
    probe.remove();
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
    if (charWidth > 0 && lineHeight > 0) setMetrics({ aspect: charWidth / lineHeight, width: Math.ceil(charWidth * cols) });
  }, [cols, rows]);
  useFrame(
    (now) => {
      const element = pre.current;
      if (element === null) return;
      const state = pose.current;
      const dt = live ? Math.min(0.1, Math.max(0, (now - state.last) / 1000)) : 0;
      state.last = now;
      state.spin += dt * 2.4;
      state.tumble += dt;
      const tilt = 0.98 + 0.3 * Math.sin(state.tumble * 0.31);
      const roll = 0.2 * Math.sin(state.tumble * 0.23);
      element.innerHTML = render({ tilt, roll, spin: state.spin, pulse: beat(signalOf(player, now)), aspect: metrics.aspect });
      if (angle.current !== null) angle.current.textContent = `rx ${degrees(tilt)}° rz ${roll < 0 ? "-" : "+"}${degrees(roll)}°`;
    },
    live,
    24,
    [render, metrics.aspect, player.track?.id],
  );
  return (
    <div className={`v-view ${player.track === null ? "v-empty" : ""}`}>
      <pre ref={pre} className="v-tor" style={metrics.width > 0 ? { width: metrics.width } : undefined} aria-hidden="true" />
      {player.track === null ? <Pixels text="NO DISC" className="v-nodisc" /> : null}
      {labels ? (
        <>
          <span className="v-vt v-tl">{vox(player.track?.album.name ?? "")}</span>
          <span className="v-vt v-tr">
            tex <Cover track={player.track} demo={demo} scale={1} />
          </span>
          <span ref={angle} className="v-vt v-bl" />
          <span className="v-vt v-br">{live ? "33⅓ rpm" : "0 rpm"}</span>
        </>
      ) : null}
    </div>
  );
}

interface CityLook extends CityShape {
  voxel: number;
  levels: number;
  gain: number;
  peaks: boolean;
}

const FULL_CITY: CityLook = { pitch: 13, width: 10, depth: 3, rows: 6, voxel: 6, levels: 11, gain: 1.45, peaks: true };
const MINI_CITY: CityLook = { pitch: 8, width: 6, depth: 2, rows: 3, voxel: 4, levels: 7, gain: 1.2, peaks: false };
const TIERS = [
  ["line", "lit", "shade"],
  ["hi", "ink", "vs1"],
  ["hi2", "title", "vs2"],
] as const;
const FOG = ["surf2", "line", "shade"] as const;
const COLOR_KEYS = ["line", "lit", "shade", "hi", "ink", "vs1", "hi2", "title", "vs2", "surf2", "dim"] as const;
type Colors = Record<(typeof COLOR_KEYS)[number], string>;

function readColors(element: HTMLElement): Colors {
  const style = getComputedStyle(element);
  return Object.fromEntries(COLOR_KEYS.map((key) => [key, style.getPropertyValue(`--v-${key}`).trim() || "#888"])) as Colors;
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

function pixelLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number) {
  [...text].forEach((char, index) => (GLYPHS[char] ?? []).forEach((row, ry) => [...row].forEach((bit, rx) => bit === "1" && context.fillRect(x + (index * 6 + rx) * scale, y + ry * scale, scale, scale))));
}

export function City({ player, mode, palette, mini = false, height }: { player: PlayerState; mode: VisMode; palette: string; mini?: boolean; height: number }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const measured = useWidth(box);
  const look = mini ? MINI_CITY : FULL_CITY;
  const width = mini ? 62 : measured;
  const grid = useMemo(() => cityGrid(width, look), [width, look]);
  const state = useMemo(() => ({ history: Array.from({ length: look.rows }, () => new Float32Array(grid.bands)), peaks: new Float32Array(grid.bands), target: new Float32Array(grid.bands), last: 0, shift: 0 }), [grid.bands, look]);
  const colors = useRef<{ palette: string; values: Colors } | null>(null);
  const live = player.isPlaying && player.track !== null && mode !== "off";
  useFrame(
    (now) => {
      const element = canvas.current;
      if (element === null || width <= 0) return;
      const context = fit(element, width, height);
      if (context === null) return;
      if (colors.current?.palette !== palette) colors.current = { palette, values: readColors(element) };
      const color = colors.current.values;
      const { history, peaks, target } = state;
      const front = history[0]!;
      const dt = Math.min(0.1, Math.max(0, (now - state.last) / 1000));
      state.last = now;
      if (live) {
        fillLevels(target, signalOf(player, now), now / 1000);
        for (let band = 0; band < grid.bands; band += 1) {
          front[band] = front[band]! + (Math.min(1, target[band]! * look.gain) - front[band]!) * 0.55;
          peaks[band] = Math.max(front[band]!, peaks[band]! - dt * 0.5);
        }
        state.shift += dt;
        if (state.shift > 0.11) {
          state.shift = 0;
          for (let row = history.length - 1; row > 0; row -= 1) history[row]!.set(history[row - 1]!);
        }
      } else {
        history.forEach((row) => row.fill(0));
        peaks.fill(0);
      }
      const { bands, left, step, rise } = grid;
      const base = height - 3;
      context.fillStyle = color.line;
      for (let row = 0; row < look.rows; row += 1) for (let band = 0; band < bands; band += 1) context.fillRect(left + band * look.pitch + row * step, base - row * rise, 2, 1);
      for (let row = look.rows - 1; row >= 0; row -= 1) {
        const fog = row >= look.rows - 2 ? 9 : row >= 2 ? 1 : 0;
        for (let band = 0; band < bands; band += 1) {
          const level = mode === "skyline" ? front[(band * 3 + row * 7) % bands]! * (1 - row * 0.07) : history[row]![band]!;
          const stack = Math.round(level * look.levels);
          const x = left + band * look.pitch + row * step;
          const floor = base - row * rise;
          for (let voxel = 0; voxel < stack; voxel += 1) {
            const tier = fog === 9 ? FOG : TIERS[Math.max(0, (voxel < look.levels * 0.4 ? 0 : voxel < look.levels * 0.75 ? 1 : 2) - fog)]!;
            const top = floor - (voxel + 1) * look.voxel;
            context.fillStyle = color[tier[0]];
            context.fillRect(x, top + 1, look.width, look.voxel - 1);
            context.fillStyle = color[tier[2]];
            for (let side = 0; side < 2 * look.depth; side += 1) context.fillRect(x + look.width + side, top + 1 - ((side + 1) >> 1), 1, look.voxel - 1);
            if (voxel === stack - 1) {
              context.fillStyle = color[tier[1]];
              for (let lid = 1; lid <= look.depth; lid += 1) context.fillRect(x + 2 * lid - 1, top + 1 - lid, look.width, 1);
            }
          }
          if (row === 0 && look.peaks && peaks[band]! > 0.08 && peaks[band]! - level > 0.04) {
            context.fillStyle = color.title;
            context.fillRect(x, floor - Math.round(peaks[band]! * look.levels) * look.voxel - 2, look.width, 2);
          }
        }
      }
      if (!live && !mini) {
        const label = mode === "off" ? "VIS OFF - V" : player.track === null ? "NO DISC" : "PAUSED";
        context.fillStyle = color.dim;
        pixelLabel(context, label, Math.floor((width - (label.length * 6 - 1) * 2) / 2), 8, 2);
      }
    },
    live,
    30,
    [grid, state, palette, mode, width, height, player.track?.id],
  );
  return (
    <div ref={box} className={mini ? "v-city v-city-mini" : "v-city"}>
      <canvas ref={canvas} style={{ width: width || undefined, height }} aria-hidden="true" />
    </div>
  );
}

export function Seek({ player, cells, thin = false, onSeek }: { player: PlayerState; cells: number; thin?: boolean; onSeek(ms: number): void }) {
  const bar = useRef<HTMLDivElement>(null);
  const duration = player.track?.durationMs ?? 0;
  useFrame(
    (now) => {
      const element = bar.current;
      if (element === null) return;
      const head = duration > 0 ? headCell(progressAt(player, now) / duration, cells) : -1;
      Array.from(element.children).forEach((cell, index) => {
        cell.className = index < head ? "v-on" : index === head ? "v-hd" : "";
      });
    },
    player.isPlaying,
    4,
    [player.progressMs, player.fetchedAt, player.track?.id, cells],
  );
  return (
    <div
      ref={bar}
      className={`v-seek ${thin ? "v-thin" : ""}`}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={player.progressMs}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width > 0) onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration);
      }}
    >
      {Array.from({ length: cells }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}

export function Clock({ player, remaining = false }: { player: PlayerState; remaining?: boolean }) {
  const span = useRef<HTMLSpanElement>(null);
  useFrame(
    (now) => {
      if (span.current === null) return;
      const position = progressAt(player, now);
      span.current.textContent = remaining ? `-${clock((player.track?.durationMs ?? 0) - position)}` : clock(position);
    },
    player.isPlaying,
    4,
    [player.progressMs, player.fetchedAt, player.track?.id],
  );
  return <span ref={span} className="v-clock" />;
}

export function Volume({ player, label = true, onChange }: { player: PlayerState; label?: boolean; onChange(percent: number): void }) {
  const volume = player.device?.volumePercent ?? null;
  const fixed = volume === null || player.device?.supportsVolume === false;
  const lit = Math.round((volume ?? 0) / 10);
  return (
    <div className="v-vol">
      <Icon name="speaker" />
      <div className={`v-vcells ${fixed ? "v-fixed" : ""}`} role="slider" aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={volume ?? 0}>
        {Array.from({ length: 10 }, (_, index) => (
          <i key={index} className={index < lit ? "v-on" : ""} style={{ height: 3 + index }} onClick={() => !fixed && onChange((index + 1) * 10)} />
        ))}
      </div>
      {label ? (
        <span className="v-voll">
          {fixed ? "fixed" : volume}
          {player.duck.active ? <em> ♪</em> : null}
        </span>
      ) : null}
    </div>
  );
}

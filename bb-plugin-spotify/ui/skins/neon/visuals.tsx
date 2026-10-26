import { useId, useLayoutEffect, useRef } from "react";
import type { PlayerState, Track } from "../../../contract";
import { useArt } from "../../art";
import { clock } from "../../format";
import { progressAt } from "../../model";
import { fillLevels, hash, useFrame } from "../../spectrum";
import { signalOf } from "../console/visuals";
import { fitSize, flickerAt, igniteDelay } from "./tubes";

const ICONS = {
  prev: (
    <>
      <path d="M6.5 5.5v13" />
      <path d="M18.5 6.2 9.8 12l8.7 5.8z" />
    </>
  ),
  next: (
    <>
      <path d="M17.5 5.5v13" />
      <path d="M5.5 6.2l8.7 5.8-8.7 5.8z" />
    </>
  ),
  play: <path d="M8.5 5.8v12.4L18.5 12z" />,
  pause: <path d="M9 5.5v13M15 5.5v13" />,
  heart: <path d="M12 19.5s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.1c0 5.1-7 9.4-7 9.4z" />,
  link: (
    <>
      <path d="M10 14l4-4" />
      <path d="M8.5 11.5l-2 2a3 3 0 0 0 4.2 4.2l2-2M15.5 12.5l2-2a3 3 0 0 0-4.2-4.2l-2 2" />
    </>
  ),
  at: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7" />
    </>
  ),
  card: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M7 14.5h6M7 11h10" />
    </>
  ),
  volume: (
    <>
      <path d="M4 10v4h3.5L12 18V6L7.5 10z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5.5" width="14" height="10" rx="1.5" />
      <path d="M3 18.5h18" />
    </>
  ),
  speaker: (
    <>
      <rect x="6.5" y="3.5" width="11" height="17" rx="2" />
      <circle cx="12" cy="14" r="3" />
      <path d="M12 7.5h.01" />
    </>
  ),
  phone: (
    <>
      <rect x="7.5" y="3.5" width="9" height="17" rx="2" />
      <path d="M11 17.5h2" />
    </>
  ),
  shuffle: (
    <>
      <path d="M4 7h3c5 0 5 10 10 10h3M4 17h3c1.6 0 2.6-1 3.4-2.3M13.6 9.3C14.4 8 15.4 7 17 7h3" />
      <path d="M18 5l2 2-2 2M18 15l2 2-2 2" />
    </>
  ),
  repeat: (
    <>
      <path d="M5 11V9a2 2 0 0 1 2-2h11M19 13v2a2 2 0 0 1-2 2H6" />
      <path d="M16 4.5 18.5 7 16 9.5M8 14.5 5.5 17 8 19.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5 20 20" />
    </>
  ),
  plus: <path d="M12 6v12M6 12h12" />,
  close: <path d="M7 7l10 10M17 7 7 17" />,
  up: <path d="M8 14l4-4 4 4" />,
  open: <path d="M14 5h5v5M19 5l-8 8M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7h4" />,
};

export type IconName = keyof typeof ICONS;

export const Icon = ({ name, className = "" }: { name: IconName; className?: string }) => (
  <svg className={`n-ic ${className}`} viewBox="0 0 24 24" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

export const vars = (values: Record<string, string>) => values as React.CSSProperties;

export const Eq = () => (
  <span className="n-eq" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);

const HUES = ["play", "spread", "fresh", "uv", "warn", "clear"];

function tube(color: string, width: number, opacity = 1) {
  return { fill: "none", stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round", opacity } as const;
}

function shapes(kind: number, a: string, b: string, letter: string): React.ReactNode {
  switch (kind) {
    case 0:
      return (
        <>
          <circle cx="50" cy="46" r="24" {...tube(a, 3)} />
          <circle cx="50" cy="46" r="12" {...tube(b, 1.8)} />
          <path d="M24 82h52" {...tube(a, 1.4, 0.45)} />
        </>
      );
    case 1:
      return (
        <>
          <path d="M22 82V54a28 28 0 0 1 56 0v28" {...tube(a, 3)} />
          <path d="M35 82V56a15 15 0 0 1 30 0v26" {...tube(b, 2)} />
        </>
      );
    case 2:
      return (
        <>
          <path d="M24 60a26 26 0 0 1 52 0" {...tube(a, 3)} />
          <path d="M12 60h76" {...tube(b, 1.6)} />
          <path d="M28 68h44M37 75h26M45 82h10" {...tube(a, 1.6, 0.5)} />
        </>
      );
    case 3:
      return (
        <>
          <path d="M32 76V34M50 76V22M68 76V44" {...tube(a, 3.2)} />
          <path d="M24 80h52" {...tube(b, 1.6)} />
        </>
      );
    case 4:
      return (
        <>
          <text x="50" y="68" textAnchor="middle" className="n-glyph-letter" fill="none" stroke={a} strokeWidth="2.2">
            {letter}
          </text>
          <path d="M26 82h48" {...tube(b, 1.4)} />
        </>
      );
    case 5:
      return (
        <>
          <path d="M8 72C30 40 52 84 92 30" {...tube(a, 2.6)} />
          <path d="M8 82C34 54 56 92 92 44" {...tube(b, 1.8)} />
          <path d="M8 62C28 28 50 72 92 16" {...tube(a, 1.4, 0.55)} />
          <circle cx="66" cy="47" r="4.5" fill={b} />
        </>
      );
    default:
      return <path d="M50 74s-22-13.5-22-29.5A12 12 0 0 1 50 37.5a12 12 0 0 1 22 7c0 16-22 29.5-22 29.5z" {...tube(a, 3)} />;
  }
}

export function Glyph({ seed, liked = false }: { seed: string; liked?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const value = hash(seed);
  const first = HUES[value % 4]!;
  const second = HUES[(value >>> 4) % 6]!;
  const a = liked ? "var(--play)" : `var(--${first})`;
  const b = `var(--${second === first ? "clear" : second})`;
  return (
    <svg className="n-glyph" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <filter id={`${id}g`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${id}s`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="11" />
        </filter>
      </defs>
      <rect width="100" height="100" fill="#0b0a10" />
      <circle cx="50" cy="50" r="30" fill={a} opacity=".18" filter={`url(#${id}s)`} />
      <g filter={`url(#${id}g)`}>{shapes(liked ? 6 : (value >>> 9) % 6, a, b, (seed[0] ?? "♪").toLowerCase())}</g>
    </svg>
  );
}

export function Cover({ seed, liked, className = "" }: { seed: string; liked?: boolean; className?: string }) {
  return (
    <span className={`n-cv ${className}`}>
      <Glyph seed={seed} liked={liked} />
    </span>
  );
}

export function Art({ track, demo, className = "" }: { track: Track | null; demo: boolean; className?: string }) {
  const art = useArt(track?.album.imageUrl, demo);
  return <span className={`n-cv ${className}`}>{art === null ? <Glyph seed={track?.album.name ?? "nothing"} /> : <img src={art} alt="" draggable={false} />}</span>;
}

export function Sign({ text, lit, max, single = false, ignite }: { text: string; lit: boolean; max: number; single?: boolean; ignite: string }) {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const fit = () => {
      const layer = element.firstElementChild;
      if (!(layer instanceof HTMLElement)) return;
      element.style.fontSize = `${max}px`;
      element.style.whiteSpace = "nowrap";
      const { size, wrap } = fitSize(max, layer.offsetWidth, element.clientWidth);
      element.style.fontSize = `${size}px`;
      element.style.whiteSpace = wrap && !single ? "normal" : "nowrap";
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, max, single]);
  const flicker = flickerAt(text);
  return (
    <span ref={box} className={`n-sign ${single ? "n-one" : ""}`} data-t={text} title={text}>
      <span key={ignite} className={`n-lay ${lit ? "n-lit" : "n-unlit"}`}>
        {lit
          ? [...text].map((char, index) => (
              <span key={index} className={index === flicker ? "n-ltr n-flk" : "n-ltr"} style={vars({ "--d": `${igniteDelay(index)}ms` })}>
                {char}
              </span>
            ))
          : text}
      </span>
    </span>
  );
}

interface Inks {
  palette: string;
  play: string;
  clear: string;
  off: string;
}

function sized(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  const [width, height] = [Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio)];
  if (width === 0 || height === 0) return null;
  if (canvas.width !== width || canvas.height !== height) [canvas.width, canvas.height] = [width, height];
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, width, height);
  return context;
}

function inksOf(element: HTMLElement, palette: string): Inks {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { palette, play: read("--play"), clear: read("--clear"), off: read("--off") };
}

function bars(context: CanvasRenderingContext2D, levels: Float32Array, peaks: Float32Array, inks: Inks, lit: boolean) {
  const { width, height } = context.canvas;
  const ratio = window.devicePixelRatio || 1;
  const gap = width / levels.length;
  const line = Math.max(2 * ratio, gap * 0.34);
  const room = height - 6 * ratio - line;
  const path = new Path2D();
  for (let band = 0; band < levels.length; band += 1) {
    const x = gap * (band + 0.5);
    path.moveTo(x, height - line / 2);
    path.lineTo(x, height - line / 2 - Math.max(0.5, levels[band]! * room));
  }
  context.lineCap = "round";
  if (!lit) {
    context.strokeStyle = inks.off;
    context.lineWidth = line;
    context.stroke(path);
    return;
  }
  context.strokeStyle = inks.play;
  context.globalAlpha = 0.2;
  context.lineWidth = line * 2.8;
  context.stroke(path);
  context.globalAlpha = 1;
  context.lineWidth = line;
  context.stroke(path);
  context.strokeStyle = "rgba(255,255,255,.55)";
  context.lineWidth = line * 0.32;
  context.stroke(path);
  context.fillStyle = inks.clear;
  for (let band = 0; band < peaks.length; band += 1) {
    if (peaks[band]! > 0.06) context.fillRect(gap * (band + 0.5) - line / 2, height - peaks[band]! * room - line - 2 * ratio, line, 1.5 * ratio);
  }
}

function puddle(source: HTMLCanvasElement, target: HTMLCanvasElement, seconds: number) {
  const context = sized(target);
  if (context === null || source.height === 0) return;
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = target;
  for (let row = 0; row < height; row += 1) {
    const from = source.height - 1 - Math.floor(row * 1.5);
    if (from < 0) break;
    const ripple = Math.sin((row * 0.5) / ratio + seconds * 2.6) * (0.5 + (row / height) * 3.5) * ratio;
    context.drawImage(source, 0, from, source.width, 1, ripple, row, width, 1);
  }
}

export function Equalizer({ player, palette, bands, reflect = false, className = "" }: { player: PlayerState; palette: string; bands: number; reflect?: boolean; className?: string }) {
  const tubes = useRef<HTMLCanvasElement>(null);
  const wet = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Float32Array(bands));
  const peaks = useRef(new Float32Array(bands));
  const inks = useRef<Inks | null>(null);
  if (levels.current.length !== bands) [levels.current, peaks.current] = [new Float32Array(bands), new Float32Array(bands)];
  const lit = player.isPlaying && player.track !== null;
  useFrame(
    (now) => {
      const canvas = tubes.current;
      if (canvas === null) return;
      const context = sized(canvas);
      if (context === null) return;
      if (inks.current?.palette !== palette) inks.current = inksOf(canvas, palette);
      const signal = signalOf(player, now);
      fillLevels(levels.current, signal, now / 1000);
      for (let band = 0; band < bands; band += 1) peaks.current[band] = lit ? Math.max(levels.current[band]!, peaks.current[band]! - 0.016) : 0;
      bars(context, levels.current, peaks.current, inks.current, lit);
      if (reflect && wet.current !== null) puddle(canvas, wet.current, now / 1000);
    },
    lit,
    30,
    [palette, bands, reflect],
  );
  if (!reflect) return <canvas ref={tubes} className={`n-eqc ${className}`} aria-hidden="true" />;
  return (
    <div className={`n-vis ${className}`} aria-hidden="true">
      <canvas ref={tubes} className="n-eqc" />
      <div className="n-puddle">
        <canvas ref={wet} />
      </div>
    </div>
  );
}

type Ref = React.RefObject<HTMLElement | null>;

function useProgress(player: PlayerState, { fill, knob, elapsed }: { fill?: Ref; knob?: Ref; elapsed?: Ref }) {
  const duration = player.track?.durationMs ?? 0;
  useFrame(
    (now) => {
      const at = progressAt(player, now);
      const percent = `${duration > 0 ? (at / duration) * 100 : 0}%`;
      if (fill?.current) fill.current.style.width = percent;
      if (knob?.current) knob.current.style.left = percent;
      if (elapsed?.current) elapsed.current.textContent = clock(at);
    },
    player.isPlaying,
    10,
    [player.progressMs, player.fetchedAt, duration],
  );
}

export function Seek({ player, onSeek }: { player: PlayerState; onSeek(ms: number): void }) {
  const fill = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const duration = player.track?.durationMs ?? 0;
  useProgress(player, { fill, knob, elapsed });
  return (
    <>
      <span ref={elapsed} className="n-tm">
        {clock(progressAt(player, Date.now()))}
      </span>
      <div
        className="n-track"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={player.progressMs}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (duration > 0) onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration);
        }}
      >
        <div ref={fill} className="n-fill" />
        <div ref={knob} className="n-knob" />
      </div>
      <span className="n-tm">{clock(duration)}</span>
    </>
  );
}

export function Hairline({ player }: { player: PlayerState }) {
  const fill = useRef<HTMLDivElement>(null);
  useProgress(player, { fill });
  return (
    <div className="n-mline">
      <div ref={fill} className="n-fill" />
    </div>
  );
}

export function Elapsed({ player }: { player: PlayerState }) {
  const elapsed = useRef<HTMLSpanElement>(null);
  useProgress(player, { elapsed });
  return (
    <span className="n-tm">
      <span ref={elapsed}>{clock(progressAt(player, Date.now()))}</span> / {clock(player.track?.durationMs ?? 0)}
    </span>
  );
}

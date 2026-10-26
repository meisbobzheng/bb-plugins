import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Device, PlayerState, Track } from "../../../contract";
import { clock } from "../../format";
import { progressAt } from "../../model";
import { fillLevels, hash, useFrame, type Signal } from "../../spectrum";
import { box, plot, rng, strokes, type Shape } from "./pencil";
import { fractionAt } from "./sheet";

const watched = new Map<Element, Set<() => void>>();
let observer: ResizeObserver | null = null;

function watch(element: Element, callback: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  observer ??= new ResizeObserver((entries) => entries.forEach((entry) => watched.get(entry.target)?.forEach((run) => run())));
  const callbacks = watched.get(element) ?? new Set();
  if (callbacks.size === 0) observer.observe(element);
  callbacks.add(callback);
  watched.set(element, callbacks);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size > 0) return;
    watched.delete(element);
    observer?.unobserve(element);
  };
}

export function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setSize((value) => (value.width === element.clientWidth && value.height === element.clientHeight ? value : { width: element.clientWidth, height: element.clientHeight }));
    measure();
    return watch(element, measure);
  }, [ref]);
  return size;
}

export const filterIds = (id: string) => ({ rough: `${id}r`, fine: `${id}s` });

export function Filters({ id, boiling }: { id: string; boiling: boolean }) {
  const turbulence = useRef<(SVGFETurbulenceElement | null)[]>([]);
  const step = useRef(0);
  const ids = filterIds(id);
  useFrame(
    () => {
      if (!boiling) return;
      step.current = (step.current + 1) % 3;
      turbulence.current.forEach((element) => element?.setAttribute("seed", String(1 + step.current * 7)));
    },
    boiling,
    7,
  );
  return (
    <svg className="g-defs" width="0" height="0" aria-hidden="true">
      <filter id={ids.rough} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence ref={(element) => void (turbulence.current[0] = element)} type="fractalNoise" baseFrequency="0.045" numOctaves={2} seed={1} />
        <feDisplacementMap in="SourceGraphic" scale={2.4} xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id={ids.fine} x="-15%" y="-15%" width="130%" height="130%">
        <feTurbulence ref={(element) => void (turbulence.current[1] = element)} type="fractalNoise" baseFrequency="0.09" numOctaves={1} seed={1} />
        <feDisplacementMap in="SourceGraphic" scale={1.3} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

export function useFilterId(): string {
  return `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

export function Outline({ shape = "box", tone, seed = "" }: { shape?: Shape; tone?: "red" | "soft"; seed?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [[width, height], setSize] = useState<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    const host = svg.current?.parentElement;
    if (!host) return;
    const measure = () => setSize((value) => (value[0] === host.offsetWidth && value[1] === host.offsetHeight ? value : [host.offsetWidth, host.offsetHeight]));
    measure();
    return watch(host, measure);
  }, []);
  const paths = useMemo(() => strokes(shape, width, height, seed), [shape, width, height, seed]);
  return (
    <svg ref={svg} className="g-l" data-tone={tone} width={width + 8} height={height + 8} viewBox={`-4 -4 ${width + 8} ${height + 8}`} aria-hidden="true">
      {paths.map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}

const ICONS = {
  prev: "M6.2 5.4 6 18.6M18.2 5.6 8.8 12.2l9.3 6.3z",
  next: "M17.8 5.4l.2 13.2M5.8 5.6l9.4 6.6-9.3 6.3z",
  play: "M8.2 4.6l11.2 7.5-11.4 7.3z",
  pause: "M8.6 5.2l.2 13.8M15.2 5l.1 14",
  heart: "M12 19.6C7 16 3.6 13 3.8 9 4 6 6.4 4.6 8.4 4.8c1.8.2 2.9 1.5 3.6 3 .8-1.6 2-2.8 3.8-2.9 2.2-.1 4.5 1.5 4.3 4.4-.2 3.9-3.5 6.7-8.1 10.3z",
  shuffle: "M3 7h4c4 0 6 10 10 10h3.5M18.5 14.6 21 17l-2.5 2.4M3 17h4c1.6 0 2.6-1.6 3.6-3.4m2.8-3.2c1-1.8 2-3.4 3.6-3.4h3.5M18.5 4.6 21 7l-2.5 2.4",
  repeat: "M4 11V9c0-1.7 1.3-3 3-3h12M16.5 3.6 19 6l-2.5 2.4M20 13v2c0 1.7-1.3 3-3 3H5m2.5-2.4L5 18l2.5 2.4",
  link: "M10 14l4-4m-5.4 1.4-2 2a3.2 3.2 0 0 0 4.5 4.5l2-2m2.3-3.3 2-2a3.2 3.2 0 0 0-4.5-4.5l-2 2",
  at: "M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zm0 0v1.5c0 1.5 1 2.5 2.3 2.5 1.4 0 2.2-1.4 2.2-4a8 8 0 1 0-3.4 6.6",
  card: "M4 5h16v14H4zM7 8h6v6H7zm8 1h3m-3 3h3M7 16.5h10",
  search: "M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM15 15l5 5",
  laptop: "M5.5 6h13v9h-13zM3 18.2h18",
  lock: "M7 11h10v8H7zm2 0V8.5a3 3 0 0 1 6 0V11",
  speaker: "M4 9.5h3.5L12 5.5v13l-4.5-4H4zm11.5-.5a4 4 0 0 1 0 6",
  close: "M6 6.2 18 17.8M17.8 6 6.2 18",
  plus: "M12 5v14M5 12.2h14",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className={`g-ic g-ic-${name}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Kc({ children }: { children: React.ReactNode }) {
  return (
    <span className="g-kc">
      {children}
      <Outline seed={String(children)} />
    </span>
  );
}

export function Delta() {
  return (
    <svg className="g-delta" viewBox="0 0 22 20" aria-hidden="true">
      <path d="M11 2.2 20.6 18.3 1.5 18.5z" />
      <text x="11" y="15.6" textAnchor="middle">
        1
      </text>
    </svg>
  );
}

export function Arrow({ to }: { to: "left" | "down" }) {
  return to === "left" ? (
    <svg className="g-arw g-arw-left" viewBox="0 0 40 20" aria-hidden="true">
      <path d="M38 5C27 1.5 15 4 4 14.5M4 14.5l8.2-.6M4 14.5l2.4-7.6" />
    </svg>
  ) : (
    <svg className="g-arw g-arw-down" viewBox="0 0 26 26" aria-hidden="true">
      <path d="M2 2C13 3 20 10 19 24M19 24l-4.6-5.4M19 24l4.2-5.8" />
    </svg>
  );
}

export function Check() {
  return (
    <svg className="g-chk" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.5 11.5 7.6 16.2 18.8 1.2" />
    </svg>
  );
}

const f = (value: number) => value.toFixed(1);
const KINDS = ["sun", "rings", "grid", "flow"] as const;

function flow(): string[] {
  const [cx, cy, radius] = [76, 54, 21];
  return Array.from({ length: 16 }, (_, row) => {
    let path = "";
    for (let x = -6; x <= 126; x += 6) {
      let y = -48 + row * 11.5 + x * 0.34 + Math.sin((x + row * 13) / 22) * 3;
      const distance = Math.hypot(x - cx, y - cy);
      if (distance < radius + 15) y += (y >= cy ? 1 : -1) * (radius + 15 - distance) * 0.95;
      path += `${path ? "L" : "M"}${f(x)} ${f(y)}`;
    }
    return path;
  });
}

function Plate({ album, id }: { album: string; id: string }) {
  const kind = KINDS[hash(album) % KINDS.length]!;
  const rand = rng(hash(`${album}·plate`));
  const [hatch, cross] = [`url(#${id}h)`, `url(#${id}x)`];
  if (kind === "flow")
    return (
      <>
        {flow().map((path, row) => (
          <path key={row} className={`g-flow ${row % 3 ? "" : "g-thick"}`} d={path} style={{ animationDelay: `-${(row * 0.37).toFixed(2)}s` }} />
        ))}
        <ellipse cx="82" cy="86" rx="22" ry="4.5" style={{ fill: hatch }} />
        <circle cx="76" cy="54" r="23" className="g-paperfill" />
        <g clipPath={`url(#${id}s)`}>
          <rect x="50" y="28" width="60" height="52" style={{ fill: hatch }} />
          <circle cx="69" cy="46" r="15" className="g-paperfill" />
          <circle cx="88" cy="66" r="13" style={{ fill: cross }} />
        </g>
        <circle cx="76" cy="54" r="21" className="g-ln" />
        <path className="g-ln g-thin" d="M63 46Q65 40 71 37.5" />
      </>
    );
  if (kind === "sun") {
    const [sx, sr] = [28 + rand() * 60, 13 + rand() * 9];
    return (
      <>
        <rect x="0" y="76" width="120" height="44" style={{ fill: cross }} opacity=".7" />
        <path className="g-ln" d="M0 76.5Q60 74.5 120 77" />
        <circle cx={f(sx)} cy="46" r={f(sr)} className="g-ln" />
        <path className="g-ln g-thin" d={`M${f(sx - sr - 8)} 46h-8M${f(sx + sr + 8)} 46h8M${f(sx)} ${f(46 - sr - 8)}v-8`} />
        <path className="g-ln g-thin" d="M18 26q3-3 6 0q3-3 6 0M88 18q3-3 6 0q3-3 6 0" />
      </>
    );
  }
  if (kind === "rings") {
    const [cx, cy] = [40 + rand() * 40, 40 + rand() * 40];
    return (
      <>
        {Array.from({ length: 8 }, (_, ring) => (
          <circle key={ring} cx={f(cx)} cy={f(cy)} r={(ring + 1) * 7} className={`g-ln ${ring % 2 ? "" : "g-thin"}`} />
        ))}
        <path d={`M${f(cx)} ${f(cy)}L${f(cx + 60)} ${f(cy)}A60 60 0 0 1 ${f(cx)} ${f(cy + 60)}z`} style={{ fill: hatch }} />
      </>
    );
  }
  return (
    <>
      {Array.from({ length: 9 }, (_, cell) => {
        const value = rand();
        return <rect key={cell} x={12 + (cell % 3) * 34} y={12 + Math.floor(cell / 3) * 34} width="28" height="28" className="g-ln g-thin" style={value < 0.35 ? { fill: hatch } : value < 0.6 ? { fill: cross } : undefined} />;
      })}
    </>
  );
}

export function Cover({ track }: { track: Track | null }) {
  const id = useFilterId();
  const album = track?.album.name ?? "";
  const frame = useMemo(() => box(rng(hash(`${album}·frame`)), 120, 120, 1.6), [album]);
  return (
    <svg className="g-cover" viewBox="0 0 120 120" role="img" aria-label={track === null ? "Empty cover" : `${album} cover sketch`}>
      <defs>
        <pattern id={`${id}h`} width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <path className="g-hp" d="M0 0V3.4" />
        </pattern>
        <pattern id={`${id}x`} width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <path className="g-hp" d="M0 0V3.4M0 0H3.4" />
        </pattern>
        <clipPath id={`${id}c`}>
          <rect x="2" y="2" width="116" height="116" />
        </clipPath>
        <clipPath id={`${id}s`}>
          <circle cx="76" cy="54" r="21" />
        </clipPath>
      </defs>
      <g className="g-rough">
        <g clipPath={`url(#${id}c)`}>{track === null ? <path className="g-ln g-thin" d="M6 6 114 114M114 6 6 114" /> : <Plate album={album} id={id} />}</g>
        <path className="g-ln g-frame" d={frame} />
      </g>
    </svg>
  );
}

export function Plot({ picks, rising, ends }: { picks: number; rising: boolean; ends: [string, string] }) {
  const { curve, now, dots } = plot(picks, rising);
  return (
    <svg className="g-plot" viewBox="0 0 256 62" aria-hidden="true">
      <path className="g-base" d="M4 56H250" />
      <path className="g-curve" d={curve} />
      <circle className="g-dot g-now" cx={f(now[0])} cy={f(now[1])} r="3.6" />
      <text x={f(now[0] + 6)} y={f(now[1] - 6)}>
        now
      </text>
      {dots.map(([x, y], index) => (
        <g key={index}>
          <circle className="g-dot" cx={f(x)} cy={f(y)} r="3.3" />
          <text className="g-num" x={f(x)} y={f(y - 7)} textAnchor="middle">
            {index + 1}
          </text>
        </g>
      ))}
      <text x="44" y="70">
        {ends[0]}
      </text>
      <text x="250" y="6" textAnchor="end">
        {ends[1]} {rising ? "↗" : ""}
      </text>
    </svg>
  );
}

const signalOf = (player: PlayerState, now: number): Signal => ({ playing: player.isPlaying, progressMs: progressAt(player, now), durationMs: player.track?.durationMs ?? 0, trackId: player.track?.id ?? null });

export function Waveform({ player, palette, split = false }: { player: PlayerState; palette: string; split?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ghost = useRef<Path2D | null>(null);
  const levels = useRef(new Float32Array(40));
  const inks = useRef({ ink: "#2e2d2a", soft: "#857f6f" });
  useLayoutEffect(() => {
    if (canvas.current === null) return;
    const style = getComputedStyle(canvas.current);
    inks.current = { ink: style.getPropertyValue("--ink").trim() || inks.current.ink, soft: style.getPropertyValue("--soft").trim() || inks.current.soft };
  }, [palette]);
  const live = player.isPlaying && player.track !== null;
  useFrame(
    (now) => {
      const element = canvas.current;
      if (element === null) return;
      const [width, height] = [element.clientWidth, element.clientHeight];
      if (width === 0 || height === 0) return;
      const ratio = window.devicePixelRatio || 1;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) [element.width, element.height] = [Math.round(width * ratio), Math.round(height * ratio)];
      const context = element.getContext("2d");
      if (context === null) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";
      const signal = signalOf(player, now);
      fillLevels(levels.current, signal, now / 1000);
      const bands = levels.current;
      const [middle, reach] = [height / 2, height / 2 - 1.5];
      const amplitude = (x: number) => {
        if (!live) return 0.8 + Math.random() * 0.6;
        const at = (x / width) * (bands.length - 1);
        const low = Math.floor(at);
        const level = bands[low]! + (bands[Math.min(bands.length - 1, low + 1)]! - bands[low]!) * (at - low);
        return reach * Math.min(1, (0.1 + 0.9 * level) * (0.78 + 0.22 * Math.random()));
      };
      const scribble = new Path2D();
      const crest = new Path2D();
      scribble.moveTo(0, middle);
      let up = true;
      for (let x = 0; x <= width; x += 2.4) {
        const y = middle + (up ? -1 : 1) * amplitude(x) + (Math.random() - 0.5);
        scribble.lineTo(x + (Math.random() - 0.5) * 1.2, y);
        if (up) (x === 0 ? crest.moveTo(x, y - 0.6) : crest.lineTo(x, y - 0.6));
        up = !up;
      }
      const played = split && signal.durationMs > 0 ? signal.progressMs / signal.durationMs : 1;
      const { ink, soft } = inks.current;
      if (ghost.current !== null) {
        context.globalAlpha = 0.13;
        context.strokeStyle = ink;
        context.lineWidth = 0.8;
        context.stroke(ghost.current);
      }
      context.save();
      context.beginPath();
      context.rect(0, 0, width * played, height);
      context.clip();
      context.strokeStyle = ink;
      context.globalAlpha = 0.78;
      context.lineWidth = 0.75;
      context.stroke(scribble);
      context.globalAlpha = 0.9;
      context.lineWidth = 1.1;
      context.stroke(crest);
      context.restore();
      if (played < 1) {
        context.save();
        context.beginPath();
        context.rect(width * played, 0, width, height);
        context.clip();
        context.globalAlpha = 0.45;
        context.strokeStyle = soft;
        context.lineWidth = 0.7;
        context.stroke(scribble);
        context.restore();
      }
      context.globalAlpha = 0.35;
      context.strokeStyle = soft;
      context.lineWidth = 0.6;
      context.setLineDash([2, 3]);
      context.beginPath();
      context.moveTo(0, middle);
      context.lineTo(width, middle);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
      ghost.current = scribble;
    },
    live,
    10,
    [player, palette, split],
  );
  return <canvas ref={canvas} className="g-viz" aria-hidden="true" />;
}

function useScrub(player: PlayerState, onSeek: (ms: number) => void, paint: (ms: number) => void) {
  const held = useRef<number | null>(null);
  const duration = player.track?.durationMs ?? 0;
  const at = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.round(fractionAt(event.clientX, rect.left, rect.width) * duration);
  };
  return {
    held,
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (duration === 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        held.current = at(event);
        paint(held.current);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (held.current === null) return;
        held.current = at(event);
        paint(held.current);
      },
      onPointerUp: () => {
        if (held.current === null) return;
        onSeek(held.current);
        held.current = null;
      },
      onPointerCancel: () => void (held.current = null),
    },
  };
}

export function Seek({ player, onSeek, small = false }: { player: PlayerState; onSeek(ms: number): void; small?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const duration = player.track?.durationMs ?? 0;
  const paint = (ms: number) => {
    root.current?.style.setProperty("--p", `${duration > 0 ? ((ms / duration) * 100).toFixed(2) : 0}%`);
    if (elapsed.current !== null) elapsed.current.textContent = clock(ms);
  };
  const { held, handlers } = useScrub(player, onSeek, paint);
  useFrame(() => held.current === null && paint(progressAt(player, Date.now())), player.isPlaying, 4, [player]);
  return (
    <div ref={root} className={`g-seek ${small ? "g-sm" : ""}`} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration / 1000)} aria-valuenow={Math.round(progressAt(player, Date.now()) / 1000)} {...handlers}>
      {small ? null : (
        <div className="g-dim">
          <span ref={elapsed}>0:00</span>
        </div>
      )}
      <div className="g-track">
        <div className="g-played g-hatch" />
        <Outline seed="track" />
      </div>
      <div className="g-thumb">
        <Outline shape="circle" seed="thumb" />
      </div>
      {small ? null : (
        <div className="g-dim g-dim-all">
          <span>{clock(duration)}</span>
        </div>
      )}
    </div>
  );
}

export function Clock({ player }: { player: PlayerState }) {
  const text = useRef<HTMLSpanElement>(null);
  useFrame(
    () => {
      if (text.current !== null) text.current.textContent = clock(progressAt(player, Date.now()));
    },
    player.isPlaying,
    2,
    [player],
  );
  return <span ref={text}>{clock(progressAt(player, Date.now()))}</span>;
}

export function Volume({ device, onChange }: { device: Device | null; onChange(percent: number): void }) {
  const value = device?.supportsVolume ? device.volumePercent : null;
  const [draft, setDraft] = useState<number | null>(null);
  const held = useRef(false);
  useEffect(() => setDraft(null), [value]);
  const shown = draft ?? value ?? 0;
  const at = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.round(fractionAt(event.clientX, rect.left, rect.width) * 100);
  };
  return (
    <div
      className={`g-vol ${value === null ? "g-off" : ""}`}
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? 0}
      style={{ "--v": `${shown}%` } as React.CSSProperties}
      onPointerDown={(event) => {
        if (value === null) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        held.current = true;
        setDraft(at(event));
      }}
      onPointerMove={(event) => held.current && setDraft(at(event))}
      onPointerUp={(event) => {
        if (!held.current) return;
        held.current = false;
        onChange(at(event));
      }}
    >
      <div className="g-scale">
        <i className="g-vrest" />
      </div>
      <span className="g-vmark" />
      <span className="g-vnum">{value === null ? "—" : shown}</span>
    </div>
  );
}

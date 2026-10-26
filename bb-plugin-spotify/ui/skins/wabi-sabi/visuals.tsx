import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlayerState } from "../../../contract";
import { useArt } from "../../art";
import { clock } from "../../format";
import { progressAt } from "../../model";
import { beat, hash, useFrame } from "../../spectrum";
import { signalOf } from "../console/visuals";
import { crack, crackY, rgbOf, SEAM_H, SEAM_W } from "./brush";
import { enso, fire, glazed, ratio } from "./paint";

export const Ink = createContext("#27231e");

export type IconName = "prev" | "next" | "play" | "pause";

const PATHS: Record<IconName, string[]> = {
  prev: ["M4.2 3.6c.7-.3 1.5-.2 1.6.5l.3 11.6c0 .7-1 .9-1.7.5z", "M16.3 3.9 7.9 9.2c-.5.4-.5.9 0 1.3l8.1 5.4c.6.3 1-.1 1-.7V4.5c0-.6-.3-.9-.7-.6z"],
  next: ["M15.8 3.6c-.7-.3-1.5-.2-1.6.5l-.3 11.6c0 .7 1 .9 1.7.5z", "M3.7 3.9l8.4 5.3c.5.4.5.9 0 1.3l-8.1 5.4c-.6.3-1-.1-1-.7V4.5c0-.6.3-.9.7-.6z"],
  play: ["M6 3.4c0-.8.9-1.2 1.6-.7l8.6 6.3c.6.5.6 1.2 0 1.6l-8.7 6c-.7.5-1.6.1-1.6-.7z"],
  pause: ["M5.4 3.2c.9-.5 2.3-.4 2.5.4l.1 12.6c-.1.8-1.7 1-2.5.4z", "M12.3 3.5c.9-.4 2.2-.3 2.3.5l-.2 12.1c-.2.8-1.6.9-2.4.3z"],
};

export function Filters() {
  return (
    <svg className="w-defs" width="0" height="0" aria-hidden="true">
      <filter id="w-rough" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="1.4" />
      </filter>
      <filter id="w-rough2" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="3" seed="8" />
        <feDisplacementMap in="SourceGraphic" scale="1.6" />
      </filter>
    </svg>
  );
}

export function Icon({ name }: { name: IconName }) {
  return (
    <span className="w-ico" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        {PATHS[name].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

export function Enso({ size, seed, className }: { size: number; seed: number; className?: string }) {
  const ink = useContext(Ink);
  const url = useMemo(() => enso(size, ink, seed), [size, ink, seed]);
  return url === null ? null : <img className={`w-enso ${className ?? ""}`} src={url} width={size} height={size} alt="" draggable={false} />;
}

export function useCover(album: string, imageUrl: string | null | undefined, demo: boolean, size: number): string | null {
  const art = useArt(demo ? null : imageUrl);
  const generated = useMemo(() => (art === null ? glazed(album, size) : null), [art, album, size]);
  const [fromArt, setFromArt] = useState<string | null>(null);
  useEffect(() => {
    setFromArt(null);
    if (art === null) return;
    let live = true;
    void fire(art, size).then((url) => live && setFromArt(url));
    return () => {
      live = false;
    };
  }, [art, size]);
  return art === null ? generated : (fromArt ?? glazed(album, size));
}

export function Cover({ album, imageUrl, demo, size, className }: { album: string; imageUrl?: string | null; demo: boolean; size: number; className?: string }) {
  const url = useCover(album, imageUrl, demo, size);
  return url === null ? <span className={`w-cover w-cover-empty ${className ?? ""}`} style={{ width: size, height: size }} /> : <img className={`w-cover ${className ?? ""}`} src={url} width={size} height={size} alt="" draggable={false} />;
}

export function Disc({ player, demo, size, seed, onClick, title }: { player: PlayerState; demo: boolean; size: number; seed: number; onClick(): void; title?: string }) {
  const track = player.track;
  const cover = Math.round(size * 0.63);
  return (
    <button type="button" className="w-disc" style={{ width: size, height: size }} onClick={onClick} aria-label={player.isPlaying ? "Pause" : "Play"} title={title}>
      <span className="w-disc-cover" style={{ left: Math.round(size * 0.2), top: Math.round(size * 0.21) }}>
        <Cover album={track?.album.name ?? ""} imageUrl={track?.album.imageUrl} demo={demo} size={cover} />
      </span>
      <Enso size={size} seed={seed} />
    </button>
  );
}

export function PlayButton({ playing, size, onClick }: { playing: boolean; size: number; onClick(): void }) {
  return (
    <button type="button" className="w-playb" style={{ width: size, height: size }} onClick={onClick} aria-label={playing ? "Pause" : "Play"} title="Play or pause (space)">
      <Enso size={size} seed={5} />
      <Icon name={playing ? "pause" : "play"} />
    </button>
  );
}

export function Seam({ player, onSeek, times = true, seed }: { player: PlayerState; onSeek(ms: number): void; times?: boolean; seed?: number }) {
  const id = `w${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const line = useMemo(() => crack(seed ?? (21 + (hash(player.track?.id ?? "") % 89))), [seed, player.track?.id]);
  const rect = useRef<SVGRectElement>(null);
  const bead = useRef<HTMLElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const duration = player.track?.durationMs ?? 0;
  useFrame(
    (now) => {
      const position = progressAt(player, now);
      const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
      const x = fraction * SEAM_W;
      rect.current?.setAttribute("width", x.toFixed(1));
      if (bead.current !== null) {
        bead.current.style.left = `${(fraction * 100).toFixed(2)}%`;
        bead.current.style.top = `${((crackY(line.points, x) / SEAM_H) * 100).toFixed(2)}%`;
      }
      if (elapsed.current !== null) elapsed.current.textContent = clock(position);
    },
    player.isPlaying,
    12,
    [player.progressMs, player.fetchedAt, player.track?.id, line],
  );
  const seam = (
    <div
      className="w-seam"
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={player.progressMs}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (duration > 0 && box.width > 0) onSeek(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * duration);
      }}
    >
      <svg viewBox={`0 0 ${SEAM_W} ${SEAM_H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" x2="170" spreadMethod="reflect">
            <stop offset="0" className="w-au-lo" />
            <stop offset=".45" className="w-au" />
            <stop offset=".62" className="w-au-hi" />
            <stop offset="1" className="w-au" />
            {player.isPlaying ? <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="340 0" dur="9s" repeatCount="indefinite" /> : null}
          </linearGradient>
          <clipPath id={`${id}c`}>
            <rect ref={rect} width="0" height="40" y="-6" />
          </clipPath>
        </defs>
        <path className="w-groove" d={line.path} />
        <path className="w-crk" d={`${line.path} ${line.branches}`} />
        <g className="w-gold" clipPath={`url(#${id}c)`}>
          <path className="w-gld" stroke={`url(#${id})`} d={line.path} />
          <path className="w-gld w-gld-b" stroke={`url(#${id})`} d={line.branches} />
        </g>
      </svg>
      <i ref={bead} className="w-bead" />
    </div>
  );
  if (!times) return seam;
  return (
    <div className="w-seek">
      <span ref={elapsed}>{clock(progressAt(player, Date.now()))}</span>
      {seam}
      <span>{clock(duration)}</span>
    </div>
  );
}

export function Elapsed({ player }: { player: PlayerState }) {
  const span = useRef<HTMLSpanElement>(null);
  useFrame(
    (now) => {
      if (span.current !== null) span.current.textContent = clock(progressAt(player, now));
    },
    player.isPlaying,
    2,
    [player.progressMs, player.fetchedAt],
  );
  return <span ref={span}>{clock(progressAt(player, Date.now()))}</span>;
}

interface Ripple {
  x: number;
  born: number;
  life: number;
  reach: number;
  amp: number;
  rings: number;
}

export function Pond({ player }: { player: PlayerState }) {
  const ink = useContext(Ink);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ ripples: [] as Ripple[], last: 0, beats: 0, seed: 42 });
  const active = player.isPlaying && player.track !== null;
  const color = rgbOf(ink);
  useFrame(
    (now) => {
      const element = canvas.current;
      if (element === null) return;
      const scale = ratio();
      const [width, height] = [Math.round(element.clientWidth * scale), Math.round(element.clientHeight * scale)];
      if (width === 0 || height === 0) return;
      if (element.width !== width || element.height !== height) [element.width, element.height] = [width, height];
      const context = element.getContext("2d");
      if (context === null) return;
      const pond = state.current;
      const time = now / 1000;
      const quiet = player.duck.active ? 0.45 : 1;
      const level = 0.55 + (player.device?.volumePercent ?? 50) / 110;
      if (active) {
        const kick = beat(signalOf(player, now));
        if (kick > 0.4 && pond.last <= 0.4) {
          pond.beats += 1;
          const big = pond.beats % 8 === 0;
          pond.seed = (pond.seed * 9301 + 49297) % 233280;
          if (big || (pond.beats % 2 === 0 && pond.seed / 233280 > 0.35))
            pond.ripples.push({ x: 0.46 + 0.3 * Math.sin(pond.beats * 0.37) + (pond.seed / 233280 - 0.5) * 0.12, born: time, life: big ? 4.2 : 3, reach: width * (big ? 0.24 : 0.14) * (player.duck.active ? 0.6 : 1), amp: (big ? 0.7 : 0.45) * quiet * level, rings: big ? 3 : 2 });
        }
        pond.last = kick;
      } else pond.ripples = [];
      context.clearRect(0, 0, width, height);
      for (let index = 0; index < 5; index += 1) {
        const y = height * (0.22 + 0.14 * index);
        const drift = active ? time * (5 + index) * (index % 2 ? 1 : -1) * 2 * scale : 0;
        const x0 = (((index * 211 * scale + drift) % width) + width) % width;
        context.strokeStyle = `rgba(${color},${(0.05 + 0.015 * index).toFixed(3)})`;
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x0 - width * 0.16, y);
        context.lineTo(x0 + width * 0.08, y);
        context.stroke();
      }
      pond.ripples = pond.ripples.filter((ripple) => time - ripple.born < ripple.life);
      for (const ripple of pond.ripples) {
        const age = (time - ripple.born) / ripple.life;
        const radius = ripple.reach * Math.sqrt(age);
        for (let ring = 0; ring < ripple.rings; ring += 1) {
          const r = radius - ring * width * 0.014;
          if (r <= 1) continue;
          context.strokeStyle = `rgba(${color},${(ripple.amp * (1 - age) * (1 - ring * 0.3)).toFixed(3)})`;
          context.lineWidth = 2.2 * (1 - age * 0.5);
          context.beginPath();
          context.ellipse(ripple.x * width, height * 0.56, r, r * 0.2, 0, 0, Math.PI * 2);
          context.stroke();
        }
      }
      const [sx, sy] = [width * 0.87, height * 0.6];
      context.fillStyle = `rgba(${color},.5)`;
      context.beginPath();
      context.ellipse(sx, sy, width * 0.014, height * 0.1, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = `rgba(${color},.12)`;
      context.beginPath();
      context.ellipse(sx, sy + height * 0.03, width * 0.024 + (active ? Math.sin(time * 0.8) * 2 : 0), height * 0.14, 0, 0, Math.PI * 2);
      context.stroke();
    },
    active,
    30,
    [color, player.duck.active],
  );
  return <canvas ref={canvas} className="w-pond" aria-hidden="true" />;
}

export function Seal({ liked, size }: { liked: boolean; size?: "small" | "mini" }) {
  const was = useRef(liked);
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    if (liked && !was.current) setStamp((value) => value + 1);
    was.current = liked;
  }, [liked]);
  return (
    <span key={stamp} className={`w-seal ${size ? `w-seal-${size}` : ""} ${stamp > 0 && liked ? "w-stamp" : ""}`} aria-hidden="true">
      好
    </span>
  );
}

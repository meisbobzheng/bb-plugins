import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlayerState } from "../../../contract";
import { clock } from "../../format";
import { progressAt } from "../../model";
import { beat, fillLevels, useFrame } from "../../spectrum";
import { signalOf } from "../console/visuals";
import { clamp, dialAngle, dialPercent, FILLS, fractionAt, scallop, springs, squash, vars, wobble } from "./stickers";

const useSvgId = () => `k${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

function useWidth(ref: React.RefObject<Element | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const NOTES = 5;
const NUDGE: Record<string, number> = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 };
const ARM = "M252 46 L256 140 L186 176";

export function Turntable({ player, art }: { player: PlayerState; art: string | null }) {
  const clip = useSvgId();
  const notes = useRef<SVGGElement>(null);
  const flight = useRef({ born: new Float64Array(NOTES).fill(-Infinity), next: 0, last: 0 });
  useFrame(
    (now) => {
      const group = notes.current;
      if (group === null) return;
      const state = flight.current;
      const kick = beat(signalOf(player, now));
      if (kick > 0.6 && state.last <= 0.6) state.born[state.next++ % NOTES] = now;
      state.last = kick;
      Array.from(group.children).forEach((node, index) => {
        const age = player.isPlaying ? (now - state.born[index]!) / 1700 : 2;
        if (age > 1) {
          node.setAttribute("opacity", "0");
          return;
        }
        const x = 196 + (index % 3) * 14 - 8 + Math.sin(age * 7) * 7 + age * 26;
        node.setAttribute("opacity", (1 - age * age).toFixed(2));
        node.setAttribute("transform", `translate(${x.toFixed(1)} ${(52 - age * 92).toFixed(1)}) rotate(${(Math.sin(age * 5) * 16).toFixed(1)}) scale(${(0.7 + age * 0.4).toFixed(2)})`);
      });
    },
    player.isPlaying,
  );
  return (
    <svg className="k-deck" viewBox="0 -44 300 290" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="118" cy="124" r="36" />
        </clipPath>
      </defs>
      <rect x="10" y="12" width="282" height="226" rx="30" fill="var(--edge)" />
      <rect x="4" y="6" width="282" height="226" rx="30" className="k-plinth" />
      <path d="M22 30 q 8 -10 20 -8" className="k-line" fill="none" strokeWidth="2" opacity=".5" />
      <circle cx="30" cy="208" r="8" fill="var(--pink)" className="k-line" />
      <circle cx="54" cy="208" r="8" fill="var(--sky)" className="k-line" />
      <circle cx="262" cy="210" r="5.5" className="k-led" />
      <circle cx="118" cy="124" r="101" fill="var(--card)" className="k-line" />
      {player.track === null ? (
        <path d="M108 118 q 10 -8 20 0 M96 136 q 22 14 44 0" fill="none" className="k-line" opacity=".35" />
      ) : (
        <>
          <g className="k-disc">
            <circle cx="118" cy="124" r="92" fill="var(--record)" className="k-line" />
            <circle cx="118" cy="124" r="80" fill="none" stroke="rgba(255,255,255,.13)" strokeWidth="1.5" />
            <circle cx="118" cy="124" r="68" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1.5" />
            <circle cx="118" cy="124" r="56" fill="none" stroke="rgba(255,255,255,.13)" strokeWidth="1.5" />
            <circle cx="118" cy="124" r="45" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3" />
            <circle cx="118" cy="124" r="36" fill="var(--pink)" />
            {art === null ? null : <image href={art} x="82" y="88" width="72" height="72" clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />}
            <circle cx="118" cy="124" r="36" fill="none" className="k-line" />
            <circle cx="118" cy="97" r="3.2" fill="var(--card)" className="k-line" strokeWidth="1.5" />
          </g>
          <path d="M48 92 A 78 78 0 0 1 84 54 M42 112 A 78 78 0 0 1 44 102" fill="none" stroke="#fff" strokeOpacity=".42" strokeWidth="5" strokeLinecap="round" />
        </>
      )}
      <circle cx="118" cy="124" r="4.5" fill="var(--card)" className="k-line" strokeWidth="2" />
      <g className="k-arm">
        <path d={ARM} fill="none" className="k-line" strokeWidth="11" />
        <path d={ARM} fill="none" stroke="var(--card)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="170" y="167" width="28" height="18" rx="5" fill="var(--pink)" className="k-line" transform="rotate(-28 184 176)" />
        <circle cx="252" cy="46" r="20" fill="var(--lilac)" className="k-line" />
        <circle cx="252" cy="46" r="7" fill="var(--edge)" />
        <circle cx="246" cy="40" r="3" fill="#fff" opacity=".7" />
      </g>
      <g ref={notes}>
        {FILLS.map((fill) => (
          <g key={fill} opacity="0">
            <path d="M2 8 V-11 q 7 2 8 9" fill="none" className="k-line" strokeWidth="2.2" />
            <ellipse cx="-2" cy="8.5" rx="4.6" ry="3.6" transform="rotate(-20 -2 8.5)" fill={`var(--${fill})`} className="k-line" strokeWidth="2" />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function MiniDisc({ art }: { art: string | null }) {
  const clip = useSvgId();
  return (
    <svg viewBox="-26 -26 52 52" aria-hidden="true">
      <circle r="24" cx="2" cy="2" fill="var(--edge)" />
      <g className="k-disc">
        <circle r="24" fill="var(--record)" stroke="var(--edge)" strokeWidth="2" />
        <circle r="18.5" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1.2" />
        <clipPath id={clip}>
          <circle r="10" />
        </clipPath>
        <circle r="10" fill="var(--pink)" />
        {art === null ? null : <image href={art} x="-10" y="-10" width="20" height="20" clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />}
        <circle r="10" fill="none" stroke="var(--edge)" strokeWidth="1.8" />
        <circle cy="-7" r="1.6" fill="var(--card)" />
      </g>
      <path d="M-15 -8 A 17 17 0 0 1 -6 -16" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="2.5" strokeLinecap="round" />
      <circle r="2" fill="var(--card)" stroke="var(--edge)" strokeWidth="1.2" />
    </svg>
  );
}

export function JellyBand({ player, mini = false }: { player: PlayerState; mini?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const width = useWidth(svg, mini ? 64 : 560);
  const height = mini ? 34 : 112;
  const count = mini ? 5 : clamp(Math.floor(width / 34), 6, 30);
  const ground = height - (mini ? 3 : 12);
  const gap = width / count;
  const body = Math.min(mini ? 9 : 24, gap * 0.72);
  const state = useMemo(() => ({ springs: springs(count), levels: new Float32Array(count), last: 0 }), [count]);
  useFrame(
    (now) => {
      const element = svg.current;
      if (element === null) return;
      if (player.isPlaying) {
        fillLevels(state.levels, signalOf(player, now), now / 1000);
        wobble(state.springs, state.levels, state.last === 0 ? 0 : (now - state.last) / 1000);
        state.last = now;
      } else {
        state.springs.position.fill(0);
        state.springs.velocity.fill(0);
        state.last = 0;
      }
      const rest = mini ? 7 : 16;
      const peak = ground - (mini ? 1 : 8);
      Array.from(element.querySelectorAll(".k-jel-g")).forEach((group, index) => {
        const lift = Math.max(0, state.springs.position[index]!);
        const tall = rest + lift * (peak - rest);
        const wide = body * squash(state.springs.velocity[index]!);
        const [shadow, jelly, shine, face] = mini ? [null, group.firstElementChild, null, null] : Array.from(group.children);
        jelly?.setAttribute("x", (-wide / 2).toFixed(1));
        jelly?.setAttribute("width", wide.toFixed(1));
        jelly?.setAttribute("y", (-tall).toFixed(1));
        jelly?.setAttribute("height", tall.toFixed(1));
        jelly?.setAttribute("rx", (Math.min(wide, tall) / 2).toFixed(1));
        shadow?.setAttribute("rx", (wide * (0.9 - lift * 0.3)).toFixed(1));
        shine?.setAttribute("x", (-wide / 2 + 4).toFixed(1));
        shine?.setAttribute("y", (5 - tall).toFixed(1));
        shine?.setAttribute("height", Math.min(10, tall * 0.35).toFixed(1));
        face?.setAttribute("transform", `translate(0 ${(Math.min(13, tall * 0.55) - tall).toFixed(1)})`);
      });
    },
    player.isPlaying,
    60,
    [state, body, ground],
  );
  const wave = Array.from({ length: 24 }, (_, index) => `Q ${(((index + 0.5) * (width - 8)) / 24 + 4).toFixed(1)} ${ground + (index % 2 ? 6 : 0)} ${(((index + 1) * (width - 8)) / 24 + 4).toFixed(1)} ${ground + 3}`).join(" ");
  return (
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} className={player.isPlaying ? "k-awake" : ""} aria-hidden="true">
      {mini ? null : <path className="k-ground" d={`M4 ${ground + 3} ${wave}`} />}
      {Array.from({ length: count }, (_, index) => (
        <g key={index} className="k-jel-g" transform={`translate(${(gap * (index + 0.5)).toFixed(1)} ${ground})`}>
          {mini ? null : <ellipse className="k-jel-shadow" cx="0" cy="2" rx={body * 0.9} ry="3" />}
          <rect className="k-jel" fill={`var(--${FILLS[index % FILLS.length]})`} x={-body / 2} y={-16} width={body} height={16} rx={body / 2} />
          {mini ? null : (
            <>
              <rect className="k-jel-hi" x={-body / 2 + 4} y={-11} width="3.5" height="5" rx="1.75" />
              <g className="k-jel-face" transform="translate(0 -7)">
                <circle className="k-jel-eye" cx="-3.5" cy="0" r="1.8" />
                <circle className="k-jel-eye" cx="3.5" cy="0" r="1.8" />
                <path className="k-jel-shut" d="M-5.5 0 q 2 1.8 4 0 M1.5 0 q 2 1.8 4 0" />
              </g>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

const Head = () => (
  <svg viewBox="-17 -17 34 34" aria-hidden="true">
    <path d="M-5 -11 q -3 -6 -7 -6 M5 -11 q 3 -6 7 -6" fill="none" stroke="var(--edge)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="-12" cy="-17" r="2.4" fill="var(--hot)" stroke="var(--edge)" strokeWidth="1.5" />
    <circle cx="12" cy="-17" r="2.4" fill="var(--hot)" stroke="var(--edge)" strokeWidth="1.5" />
    <circle r="12.5" fill="var(--mint)" stroke="var(--edge)" strokeWidth="2.2" />
    <circle cx="-4.5" cy="-2" r="2" fill="var(--edge)" />
    <circle cx="4.5" cy="-2" r="2" fill="var(--edge)" />
    <circle cx="-8" cy="3.5" r="2.4" fill="var(--pink)" />
    <circle cx="8" cy="3.5" r="2.4" fill="var(--pink)" />
    <path d="M-3 4 q 3 3 6 0" fill="none" stroke="var(--edge)" strokeWidth="1.8" strokeLinecap="round" />
    <ellipse cx="-5" cy="-8" rx="3" ry="1.6" fill="#fff" opacity=".7" transform="rotate(-25 -5 -8)" />
  </svg>
);

export function Caterpillar({ player, onSeek }: { player: PlayerState; onSeek(positionMs: number): void }) {
  const fill = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const hold = useRef<{ fraction: number; dragging: boolean } | null>(null);
  const duration = player.track?.durationMs ?? 0;
  const paint = (fraction: number) => {
    if (fill.current !== null) fill.current.style.width = `${fraction * 100}%`;
    if (head.current !== null) head.current.style.left = `${fraction * 100}%`;
    if (elapsed.current !== null) elapsed.current.textContent = clock(fraction * duration);
  };
  useEffect(() => {
    if (hold.current?.dragging === false) hold.current = null;
  }, [player.fetchedAt, player.track?.id]);
  useFrame((now) => paint(hold.current?.fraction ?? (duration > 0 ? progressAt(player, now) / duration : 0)), player.isPlaying, 12, [player.progressMs, player.fetchedAt, duration]);
  const grab = (event: React.PointerEvent<HTMLDivElement>, dragging: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    hold.current = { fraction: fractionAt(event.clientX, rect.left, rect.width), dragging };
    paint(hold.current.fraction);
  };
  return (
    <>
      <div
        className="k-cat"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={player.progressMs}
        onPointerDown={(event) => {
          if (duration === 0 || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          grab(event, true);
        }}
        onPointerMove={(event) => hold.current?.dragging && grab(event, true)}
        onPointerUp={(event) => {
          if (!hold.current?.dragging) return;
          grab(event, false);
          onSeek(Math.round(hold.current.fraction * duration));
        }}
        onPointerCancel={() => (hold.current = null)}
      >
        <div className="k-cat-track">
          <div ref={fill} className="k-cat-fill" />
        </div>
        <div ref={head} className="k-cat-head">
          <Head />
        </div>
      </div>
      <div className="k-times">
        <span ref={elapsed}>0:00</span>
        <span>{clock(duration)}</span>
      </div>
    </>
  );
}

export function VolumeDial({ volume, onChange }: { volume: number | null; onChange(percent: number): void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? volume ?? 0;
  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setDrag(dialPercent(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2));
  };
  const nudge = (event: React.KeyboardEvent) => {
    const delta = NUDGE[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onChange(clamp(shown + delta, 0, 100));
  };
  return (
    <div className={`k-dial ${volume === null ? "k-off" : ""}`} role="slider" tabIndex={volume === null ? -1 : 0} aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown} onKeyDown={nudge}>
      <svg
        viewBox="-30 -30 60 60"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => drag !== null && pick(event)}
        onPointerUp={() => {
          if (drag !== null) onChange(drag);
          setDrag(null);
        }}
      >
        {Array.from({ length: 11 }, (_, index) => {
          const angle = (dialAngle(index * 10) * Math.PI) / 180;
          const [x, y] = [Math.sin(angle), -Math.cos(angle)];
          return <path key={index} d={`M${(x * 24).toFixed(1)} ${(y * 24).toFixed(1)} L${(x * 28).toFixed(1)} ${(y * 28).toFixed(1)}`} stroke="var(--edge)" strokeWidth="2" strokeLinecap="round" opacity={index * 10 <= shown ? 1 : 0.3} />;
        })}
        <circle r="19" cx="2" cy="2" fill="var(--edge)" />
        <circle r="19" fill="var(--butter)" stroke="var(--edge)" strokeWidth="2" />
        <g transform={`rotate(${dialAngle(shown)})`}>
          <circle r="12" fill="var(--card)" stroke="var(--edge)" strokeWidth="2" />
          <path d="M0 -6 V-15" stroke="var(--edge)" strokeWidth="3.2" strokeLinecap="round" />
        </g>
        <ellipse cx="-8" cy="-11" rx="4" ry="2" fill="#fff" opacity=".7" transform="rotate(-35 -8 -11)" />
      </svg>
      <span className="k-dial-label">
        vol<b>{volume === null ? "–" : shown}</b>
      </span>
    </div>
  );
}

export function Badge({ big, small, fill, tilt }: { big: string; small: string; fill: string; tilt: number }) {
  const path = scallop(14, 42, 6);
  return (
    <div className="k-badge" style={vars({ "--tilt": `${tilt.toFixed(1)}deg` })}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d={path} transform="translate(4 4)" fill="var(--edge)" />
        <path d={path} fill={fill} stroke="var(--edge)" strokeWidth="2.2" />
        <circle cx="50" cy="50" r="34" fill="none" stroke="var(--edge)" strokeWidth="1.5" strokeDasharray="3 4" opacity=".5" />
      </svg>
      <span>
        <span className="k-badge-big">{big}</span>
        <span className="k-badge-small">{small}</span>
      </span>
    </div>
  );
}

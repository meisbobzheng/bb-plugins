import type { DoodleKind } from "./stickers";
import { doodleOf, fillOf } from "./stickers";

const HEART = "M12 20.4c-4.2-2.8-8.6-6.2-8.6-10.6 0-2.9 2.1-5 4.6-5 1.7 0 3.1.9 4 2.4.9-1.5 2.3-2.4 4-2.4 2.5 0 4.6 2.1 4.6 5 0 4.4-4.4 7.8-8.6 10.6z";

const SHAPES: Record<DoodleKind, React.ReactNode> = {
  star: <path d="M12 2.6l2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 16.9l-5.7 3 1.2-6.3-4.6-4.4 6.3-.8z" />,
  heart: <path d={HEART} />,
  moon: <path d="M15.8 3.2a8.8 8.8 0 1 0 5.6 14.6 7.2 7.2 0 0 1-5.6-14.6z" />,
  cloud: <path d="M7.2 18.6h10.2a3.9 3.9 0 0 0 .7-7.7 5.4 5.4 0 0 0-10.3-1.6 4.7 4.7 0 0 0-.6 9.3z" />,
  sparkle: <path d="M12 2.5Q13.3 10.7 21.5 12 13.3 13.3 12 21.5 10.7 13.3 2.5 12 10.7 10.7 12 2.5z" />,
  note: (
    <>
      <path d="M10.6 16.6V5.4l8.2-2.3v3.8l-8.2 2.3" fill="none" />
      <ellipse cx="7.4" cy="16.9" rx="3.6" ry="2.8" transform="rotate(-20 7.4 16.9)" />
    </>
  ),
  flower: (
    <>
      <circle cx="12" cy="6.6" r="3.5" />
      <circle cx="17.1" cy="10.3" r="3.5" />
      <circle cx="15.2" cy="16.4" r="3.5" />
      <circle cx="8.8" cy="16.4" r="3.5" />
      <circle cx="6.9" cy="10.3" r="3.5" />
      <circle cx="12" cy="12" r="2.6" fill="var(--butter)" />
    </>
  ),
};

export function Doodle({ kind, fill, size = 20, className = "" }: { kind: DoodleKind; fill: string; size?: number; className?: string }) {
  return (
    <svg className={`k-doodle ${className}`} width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-hidden="true">
      {SHAPES[kind]}
    </svg>
  );
}

export const DoodleFor = ({ seed, size }: { seed: string; size?: number }) => <Doodle kind={doodleOf(seed)} fill={fillOf(`${seed}!`)} size={size} />;

const ICONS = {
  prev: (
    <>
      <rect x="5" y="5.5" width="3" height="13" rx="1" />
      <path d="M19 6v12l-9-6z" />
    </>
  ),
  next: (
    <>
      <rect x="16" y="5.5" width="3" height="13" rx="1" />
      <path d="M5 6v12l9-6z" />
    </>
  ),
  play: <path d="M8 5v14l11-7z" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1.6" />
      <rect x="14" y="5" width="4" height="14" rx="1.6" />
    </>
  ),
  heart: <path className="k-hollow" d={HEART} />,
  link: <path className="k-hollow" d="M10 14l4-4M8.6 11.4l-2 2a3.2 3.2 0 0 0 4.5 4.5l2-2M15.4 12.6l2-2a3.2 3.2 0 0 0-4.5-4.5l-2 2" />,
  tag: (
    <>
      <path className="k-hollow" d="M3.8 12V4.3h7.7l8.8 8.8-7.7 7.7z" />
      <path d="M8.4 7.4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" />
    </>
  ),
  bubble: <path className="k-hollow" d="M4 5h16v10.5h-8.6L6.8 19v-3.5H4zM9.6 9.2h.1M12 9.2h.1M14.4 9.2h.1" />,
  card: (
    <>
      <rect className="k-hollow" x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M7.5 6.5h9v8h-9z" />
    </>
  ),
  search: <path className="k-hollow" d="M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l5 5" />,
  plus: <path className="k-hollow" d="M12 6v12M6 12h12" />,
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path className="k-hollow" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export const Icon = ({ name, size }: { name: IconName; size?: number }) => (
  <svg className="k-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    {ICONS[name]}
  </svg>
);

export const Tick = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

export const Squiggle = () => (
  <svg viewBox="0 0 200 8" preserveAspectRatio="none" aria-hidden="true">
    <path d="M2 5 Q 25 1 50 4 T 100 4 T 150 4 T 198 3" />
  </svg>
);

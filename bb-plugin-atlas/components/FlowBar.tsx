import type { Diagram, Flow } from "../contract";
import { nodeIn } from "./describe";

interface FlowBarProps {
  diagram: Diagram;
  flow: Flow;
  index: number;
  playing: boolean;
  onStep: (delta: number) => void;
  onToggle: () => void;
  onClose: () => void;
}

export function FlowBar({ diagram, flow, index, playing, onStep, onToggle, onClose }: FlowBarProps) {
  const step = flow.steps[index];
  if (step === undefined) return null;
  const control = "rounded-md border border-border px-2 py-0.5 hover:bg-accent";
  return (
    <div className="absolute inset-x-2.5 bottom-2.5 z-10 flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <span className="whitespace-nowrap font-mono text-muted-foreground">
        {index + 1}/{flow.steps.length}
      </span>
      <span className="min-w-0 flex-1">
        <b>
          {nodeIn(diagram, step.from)?.label ?? step.from} → {nodeIn(diagram, step.to)?.label ?? step.to}
        </b>
        <span className="text-muted-foreground"> · </span>
        {step.text}
      </span>
      <button type="button" aria-label="Previous step" className={control} onClick={() => onStep(-1)}>
        ◀
      </button>
      <button type="button" aria-label={playing ? "Pause" : "Play"} className={control} onClick={onToggle}>
        {playing ? "⏸" : "▶"}
      </button>
      <button type="button" aria-label="Next step" className={control} onClick={() => onStep(1)}>
        ▶▶
      </button>
      <button type="button" aria-label="Stop flow" className={control} onClick={onClose}>
        ✕
      </button>
      <div className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width]" style={{ width: `${((index + 1) / flow.steps.length) * 100}%` }} />
    </div>
  );
}

import { useCallback, useMemo, useState } from "react";
import type { Element } from "../model";

const LIMIT = 200;

interface HistoryState {
  past: Element[][];
  present: Element[];
  future: Element[][];
}

export function useHistory(initial: Element[]) {
  const [state, setState] = useState<HistoryState>({ past: [], present: initial, future: [] });

  const replace = useCallback((update: (elements: Element[]) => Element[]) => {
    setState((current) => ({ ...current, present: update(current.present) }));
  }, []);

  const commit = useCallback((before: Element[]) => {
    setState((current) =>
      before === current.present
        ? current
        : { past: [...current.past.slice(1 - LIMIT), before], present: current.present, future: [] },
    );
  }, []);

  const apply = useCallback((update: (elements: Element[]) => Element[]) => {
    setState((current) => {
      const next = update(current.present);
      return next === current.present
        ? current
        : { past: [...current.past.slice(1 - LIMIT), current.present], present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setState(({ past, present, future }) =>
      past.length === 0
        ? { past, present, future }
        : { past: past.slice(0, -1), present: past[past.length - 1]!, future: [present, ...future] },
    );
  }, []);

  const redo = useCallback(() => {
    setState(({ past, present, future }) =>
      future.length === 0
        ? { past, present, future }
        : { past: [...past, present], present: future[0]!, future: future.slice(1) },
    );
  }, []);

  return useMemo(
    () => ({
      elements: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      replace,
      commit,
      apply,
      undo,
      redo,
    }),
    [state, replace, commit, apply, undo, redo],
  );
}

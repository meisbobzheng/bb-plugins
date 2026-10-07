import { useCallback, useEffect, useRef, useState } from "react";

export type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLoad<T>(key: string, load: () => Promise<T>): [Load<T>, () => void] {
  const [state, setState] = useState<{ key: string; load: Load<T> }>({ key, load: { status: "loading" } });
  const [generation, setGeneration] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let current = true;
    latest.current().then(
      (value) => {
        if (current) setState({ key, load: { status: "ready", value } });
      },
      (error: unknown) => {
        if (!current) return;
        setState((previous) =>
          previous.key === key && previous.load.status === "ready"
            ? previous
            : { key, load: { status: "error", message: errorMessage(error) } },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [key, generation]);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  return [state.key === key ? state.load : { status: "loading" }, reload];
}

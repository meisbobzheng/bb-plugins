import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { useAppearance } from "./appearance";
import { Bridge, mini, useMiniOpen } from "./bridge";
import { useAuth, useSpotify } from "./data";
import { SKIN_COMPONENTS } from "./skins";
import "./overlay.css";

interface Position {
  right: number;
  bottom: number;
}

function useStoredPosition(key: string): [Position, (next: Position) => void] {
  const [position, setPosition] = useState<Position>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as Position | null;
      if (parsed !== null && Number.isFinite(parsed.right) && Number.isFinite(parsed.bottom)) return parsed;
    } catch {
      localStorage.removeItem(key);
    }
    return { right: 24, bottom: 24 };
  });
  const save = (next: Position) => {
    setPosition(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  return [position, save];
}

function MiniHost() {
  const pluginId = experimental_usePluginId();
  const { auth } = useAuth();
  const { skin, palette } = useAppearance();
  const { data, actions } = useSpotify("mini", auth !== null && !auth.connected);
  const [position, setPosition] = useStoredPosition(`${pluginId}:mini-position`);
  const frame = useRef<HTMLDivElement>(null);
  const Skin = SKIN_COMPONENTS[skin];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && frame.current?.contains(document.activeElement)) mini.set(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || event.target.closest("[data-sp-drag]") === null || event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY, ...position };
    const element = frame.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const right = Math.min(window.innerWidth - rect.width, Math.max(0, start.right - (moveEvent.clientX - start.x)));
      const bottom = Math.min(window.innerHeight - rect.height, Math.max(0, start.bottom - (moveEvent.clientY - start.y)));
      element.style.right = `${right}px`;
      element.style.bottom = `${bottom}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPosition({ right: parseFloat(element.style.right) || 0, bottom: parseFloat(element.style.bottom) || 0 });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={frame} className="sp-mini-frame" style={{ right: position.right, bottom: position.bottom }} onPointerDown={drag} role="dialog" aria-label="Spotify mini player">
      <Skin.Mini data={data} actions={actions} palette={palette} close={() => mini.set(false)} />
    </div>
  );
}

export function SpotifyOverlay() {
  const open = useMiniOpen();
  return (
    <>
      <Bridge />
      {open ? <MiniHost /> : null}
    </>
  );
}

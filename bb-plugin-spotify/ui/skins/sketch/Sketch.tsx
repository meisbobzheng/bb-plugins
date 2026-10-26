import type { MiniProps, Skin, SkinProps } from "../../model";

function SketchPage({ data }: SkinProps) {
  return <div>{data.player.track?.name ?? "nothing playing"}</div>;
}

function SketchMini({ data }: MiniProps) {
  return <div>{data.player.track?.name ?? "nothing playing"}</div>;
}

export const sketchSkin: Skin = { id: "sketch", Page: SketchPage, Mini: SketchMini };

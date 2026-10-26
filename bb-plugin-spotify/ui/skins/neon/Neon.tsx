import type { MiniProps, Skin, SkinProps } from "../../model";

function NeonPage({ data }: SkinProps) {
  return <div>{data.player.track?.name ?? "nothing playing"}</div>;
}

function NeonMini({ data }: MiniProps) {
  return <div>{data.player.track?.name ?? "nothing playing"}</div>;
}

export const neonSkin: Skin = { id: "neon", Page: NeonPage, Mini: NeonMini };

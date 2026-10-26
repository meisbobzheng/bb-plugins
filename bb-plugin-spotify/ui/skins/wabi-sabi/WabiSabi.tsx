import type { MiniProps, Skin, SkinProps } from "../../model";

function WabiSabiPage({ data }: SkinProps) {
  return <div>{data.player.track?.name ?? "nothing playing"}</div>;
}

function WabiSabiMini({ data }: MiniProps) {
  return <div>{data.player.track?.name ?? "nothing playing"}</div>;
}

export const wabiSabiSkin: Skin = { id: "wabi-sabi", Page: WabiSabiPage, Mini: WabiSabiMini };

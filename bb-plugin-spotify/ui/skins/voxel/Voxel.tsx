import type { MiniProps, Skin, SkinProps } from "../../model";

function VoxelPage({ data }: SkinProps) {
  return <div>{data.player.track?.name ?? "nothing playing"}</div>;
}

function VoxelMini({ data }: MiniProps) {
  return <div>{data.player.track?.name ?? "nothing playing"}</div>;
}

export const voxelSkin: Skin = { id: "voxel", Page: VoxelPage, Mini: VoxelMini };

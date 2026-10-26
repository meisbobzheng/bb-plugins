import type { SkinId } from "../contract";
import type { Skin } from "./model";
import { consoleSkin } from "./skins/console/Console";
import { linerNotesSkin } from "./skins/liner-notes/LinerNotes";
import { neonSkin } from "./skins/neon/Neon";
import { pastelSkin } from "./skins/pastel/Pastel";
import { receiverSkin } from "./skins/receiver/Receiver";
import { sketchSkin } from "./skins/sketch/Sketch";
import { voxelSkin } from "./skins/voxel/Voxel";
import { wabiSabiSkin } from "./skins/wabi-sabi/WabiSabi";

export const SKIN_COMPONENTS: Record<SkinId, Skin> = {
  console: consoleSkin,
  receiver: receiverSkin,
  "liner-notes": linerNotesSkin,
  pastel: pastelSkin,
  voxel: voxelSkin,
  neon: neonSkin,
  sketch: sketchSkin,
  "wabi-sabi": wabiSabiSkin,
};

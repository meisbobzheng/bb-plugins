import type { SkinId } from "../contract";
import type { Skin } from "./model";
import { consoleSkin } from "./skins/console/Console";
import { linerNotesSkin } from "./skins/liner-notes/LinerNotes";
import { pastelSkin } from "./skins/pastel/Pastel";
import { receiverSkin } from "./skins/receiver/Receiver";

export const SKIN_COMPONENTS: Record<SkinId, Skin> = {
  console: consoleSkin,
  receiver: receiverSkin,
  "liner-notes": linerNotesSkin,
  pastel: pastelSkin,
};

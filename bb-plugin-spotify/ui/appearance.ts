import { useSettings } from "@get-bb/plugin-sdk/app";
import { PALETTE_SETTING, PALETTES, SKINS, type SkinId } from "../contract";

export function useAppearance(): { skin: SkinId; palette: string } {
  const { values } = useSettings();
  const raw = values?.skin;
  const skin = SKINS.find((id) => id === raw) ?? "console";
  const options: readonly string[] = PALETTES[skin];
  const stored = values?.[PALETTE_SETTING[skin]];
  const palette = typeof stored === "string" && options.includes(stored) ? stored : options[0]!;
  return { skin, palette };
}

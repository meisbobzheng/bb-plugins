import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Vim keys",
      description: "Use vim-style keys everywhere in bb while you are not typing in a text field.",
      default: true,
    },
    showModeIndicator: {
      type: "boolean",
      label: "Show mode indicator",
      description: "Show NORMAL, INSERT, or HINT and any pending keys in the bottom-right corner.",
      default: true,
    },
  });
}

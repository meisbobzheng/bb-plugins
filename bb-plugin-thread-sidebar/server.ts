import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { DENSITIES } from "./sidebar/model";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    density: {
      type: "select",
      label: "Row density",
      description: "Comfortable rows show the branch and machine under the title; compact rows are one line.",
      options: [...DENSITIES],
      experimental_optionLabels: { comfortable: "Comfortable", compact: "Compact" },
      default: "comfortable",
    },
  });
}

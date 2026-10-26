// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PALETTES, SKINS, type SkinId } from "../contract";
import { useDemo } from "./demo";
import type { SpotifyActions } from "./model";
import { SKIN_COMPONENTS } from "./skins";

vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<object>()),
  useRpc: () => ({ call: () => Promise.reject(new Error("offline")) }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

const noop = () => {};

function Demo({ skin, palette, mini }: { skin: SkinId; palette: string; mini: boolean }) {
  const demo = useDemo(true);
  const actions = { ...new Proxy({}, { get: () => noop }), search: async () => ({ tracks: [], playlists: [], artists: [], albums: [] }), ...demo.actions } as SpotifyActions;
  const { Page, Mini } = SKIN_COMPONENTS[skin];
  return mini ? <Mini data={demo.data} actions={actions} palette={palette} close={noop} /> : <Page data={demo.data} actions={actions} palette={palette} />;
}

describe("every look", () => {
  for (const skin of SKINS) {
    for (const palette of PALETTES[skin]) {
      it(`renders ${skin} in ${palette}, page and mini player`, () => {
        const page = render(<Demo skin={skin} palette={palette} mini={false} />);
        expect(page.container.textContent).toMatch(/Let It Happen/i);
        page.unmount();
        const mini = render(<Demo skin={skin} palette={palette} mini />);
        expect(mini.container.textContent).toMatch(/Let It Happen/i);
      });
    }
  }
});

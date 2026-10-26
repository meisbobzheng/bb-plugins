// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useDemo } from "../../demo";
import type { SpotifyActions } from "../../model";
import { wabiSabiSkin } from "./WabiSabi";

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

const spies = { queue: vi.fn(), setShuffle: vi.fn(), refreshDevices: vi.fn() };

function Page() {
  const demo = useDemo(true);
  const actions = { ...new Proxy({}, { get: () => () => {} }), ...spies, ...demo.actions } as SpotifyActions;
  return <wabiSabiSkin.Page data={demo.data} actions={actions} palette="washi" />;
}

const press = (element: Element, key: string) => act(() => void fireEvent.keyDown(element, { key }));

describe("wabi-sabi page", () => {
  it("searches, queues a result, and returns to the playlist with Esc", async () => {
    const { container, findByText, getByLabelText, queryByText } = render(<Page />);
    const root = container.querySelector(".sp-wabi")!;
    press(root, "s");
    const input = getByLabelText("Search Spotify") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "kerala" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await findByText(/back to Deep Work/)).toBeTruthy();
    fireEvent.click(container.querySelector(".w-q")!);
    expect(spies.queue).toHaveBeenCalledWith(expect.objectContaining({ name: "Kerala" }));
    press(root, "Escape");
    expect(queryByText(/back to Deep Work/)).toBeNull();
  });

  it("opens help on ? and closes it on any key, toggles shuffle on x, opens devices on d", () => {
    const { container, queryByRole } = render(<Page />);
    const root = container.querySelector(".sp-wabi")!;
    press(root, "?");
    expect(queryByRole("dialog")).not.toBeNull();
    press(root, "j");
    expect(queryByRole("dialog")).toBeNull();
    press(root, "x");
    expect(spies.setShuffle).toHaveBeenCalledWith(true);
    press(root, "d");
    expect(spies.refreshDevices).toHaveBeenCalled();
    expect(container.querySelector(".w-dev-m")?.textContent).toContain("iPhone");
  });
});

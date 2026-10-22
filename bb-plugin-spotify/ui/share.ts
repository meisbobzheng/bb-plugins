import { experimental_copyToClipboard, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Track } from "../contract";
import { artists, trackUrl } from "./format";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export async function copyLink(track: Track) {
  const url = trackUrl(track);
  const label = `${track.name} — ${artists(track)}`;
  const ok = await experimental_copyToClipboard({ text: url, html: `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` });
  ok ? toast.success("Copied the song link", { description: url }) : toast.error("Could not copy the link");
}

export async function copyUri(track: Track) {
  const ok = await experimental_copyToClipboard({ text: track.uri });
  ok ? toast.success("Copied the Spotify URI", { description: track.uri }) : toast.error("Could not copy the URI");
}

let composers: readonly PluginComposerApi[] = [];

export function setComposers(next: readonly PluginComposerApi[]) {
  composers = next;
}

export async function mention(track: Track) {
  const target = [...composers].reverse().find((composer) => composer.scope.kind === "thread") ?? composers[composers.length - 1];
  if (target !== undefined) {
    target.insert([{ provider: "track", id: track.id, label: `${track.name} — ${artists(track)}` }, " "]);
    target.focus();
    toast.success("Mentioned the song in the composer");
    return;
  }
  const ok = await experimental_copyToClipboard({ text: `[${track.name} — ${artists(track)}](${trackUrl(track)})` });
  toast.info(ok ? "No composer is open, so the song link was copied as Markdown." : "Open a thread, then type @ to mention the song.");
}

interface CardTheme {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  titleFont: string;
  bodyFont: string;
}

function themeOf(root: HTMLElement | null): CardTheme {
  const style = root === null ? null : getComputedStyle(root);
  const read = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  return {
    bg: read("--card-bg", "#0b0d10"),
    ink: read("--card-ink", "#e7e9ec"),
    muted: read("--card-muted", "#8a909a"),
    accent: read("--card-accent", "#ffc72c"),
    titleFont: read("--card-title-font", "700 64px Menlo, monospace"),
    bodyFont: read("--card-body-font", "400 28px Menlo, monospace"),
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export async function renderCard(track: Track, art: string | null, root: HTMLElement | null): Promise<Blob | null> {
  const theme = themeOf(root);
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.fillStyle = theme.bg;
  context.fillRect(0, 0, 1200, 630);
  const image = art === null ? null : await loadImage(art);
  if (image !== null) context.drawImage(image, 70, 95, 440, 440);
  else {
    context.fillStyle = theme.accent;
    context.fillRect(70, 95, 440, 440);
  }
  context.fillStyle = theme.accent;
  context.fillRect(560, 120, 64, 8);
  context.fillStyle = theme.ink;
  context.font = theme.titleFont;
  context.fillText(fitText(context, track.name, 580), 560, 230);
  context.font = theme.bodyFont;
  context.fillStyle = theme.ink;
  context.fillText(fitText(context, artists(track), 580), 560, 300);
  context.fillStyle = theme.muted;
  context.fillText(fitText(context, track.album.year === null ? track.album.name : `${track.album.name} · ${track.album.year}`, 580), 560, 350);
  for (let bar = 0; bar < 36; bar += 1) {
    const height = 10 + Math.abs(Math.sin(bar * 1.7 + track.id.length) * 46) + (bar % 5) * 3;
    context.fillStyle = bar % 7 === 0 ? theme.accent : theme.muted;
    context.fillRect(560 + bar * 16, 470 - height, 10, height);
  }
  context.fillStyle = theme.muted;
  context.font = theme.bodyFont.replace(/\d+px/, "22px");
  context.fillText(fitText(context, trackUrl(track).replace(/^https:\/\//, ""), 580), 560, 520);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function shareCard(track: Track, art: string | null, root: HTMLElement | null) {
  const blob = await renderCard(track, art, root);
  if (blob === null) {
    toast.error("Could not draw the share card");
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast.success("Copied a share card image");
  } catch {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${track.name.replace(/[^\w\- ]+/g, "").trim() || "song"}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    toast.success("Saved a share card image");
  }
}

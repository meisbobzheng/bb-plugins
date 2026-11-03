import { z } from "zod";

export const VIDEO_TOOL = "pr_board_record_video";

const WORDS_PER_SECOND = 2.5;
const MIN_SCENE_SECONDS = 6;

export const videoSceneSchema = z.object({
  title: z.string().min(1).max(120).describe("Short heading shown above the scene"),
  narration: z
    .string()
    .min(1)
    .max(1_200)
    .describe("One to three short plain sentences, shown as the caption and read aloud when the viewer turns the voice on"),
  visual: z
    .string()
    .min(1)
    .max(60_000)
    .describe("Self-contained HTML fragment for the stage, usually an inline SVG diagram with a viewBox; no external resources"),
});
export type VideoScene = z.infer<typeof videoSceneSchema>;

export const videoInputSchema = z.object({
  title: z.string().min(1).max(200).describe("The video's title, usually the PR's title"),
  scenes: z.array(videoSceneSchema).min(2).max(16),
});

export interface Video {
  title: string;
  scenes: VideoScene[];
  headSha: string | null;
  createdAt: number;
}

export function sceneSeconds(narration: string): number {
  const words = narration.trim().split(/\s+/).length;
  return Math.max(MIN_SCENE_SECONDS, Math.ceil(words / WORDS_PER_SECOND) + 1);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const STYLE = `
:root {
  color-scheme: dark;
  --bg: #0d1117; --panel: #161b22; --line: #30363d; --fg: #e6edf3; --muted: #8b949e;
  --accent: #58a6ff; --good: #3fb950; --bad: #f85149; --warn: #d29922;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 16px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
body { display: flex; flex-direction: column; overflow: hidden; }
#stage { position: relative; flex: 1; min-height: 0; cursor: pointer; }
.scene { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 14px; padding: 28px 40px 18px; opacity: 0; visibility: hidden; transition: opacity .5s, visibility .5s; }
.scene.active { opacity: 1; visibility: visible; }
.scene > h2 { margin: 0; font-size: 26px; font-weight: 650; letter-spacing: -.01em; }
.visual { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.visual > svg { width: 100%; height: 100%; }
.caption { margin: 0 auto; max-width: 960px; text-align: center; font-size: 18px; background: rgba(0, 0, 0, .35); padding: 8px 16px; border-radius: 8px; }
svg { font-family: inherit; fill: var(--fg); }
[data-step] { opacity: 0; transition: opacity .6s ease, transform .6s ease; }
:not(svg *)[data-step] { transform: translateY(10px); }
[data-step].shown { opacity: 1; transform: none; }
.draw { stroke-dasharray: 1; stroke-dashoffset: 1; }
.scene.active .draw { animation: draw 1.2s ease forwards; }
.scene.active [data-step]:not(.shown) .draw, .scene.active .draw[data-step]:not(.shown) { animation: none; }
@keyframes draw { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } .draw { stroke-dashoffset: 0; } }
.row { display: flex; gap: 24px; align-items: center; justify-content: center; flex-wrap: wrap; }
.col { display: flex; flex-direction: column; gap: 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; width: 100%; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; }
.pill { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 1px 10px; font-size: 13px; font-weight: 600; }
.big { font-size: 40px; font-weight: 700; letter-spacing: -.02em; }
.muted { color: var(--muted); } .good { color: var(--good); } .bad { color: var(--bad); } .warn { color: var(--warn); } .accent { color: var(--accent); }
pre { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-align: left; }
footer { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 16px; border-top: 1px solid var(--line); background: var(--panel); }
footer button { background: none; border: 1px solid var(--line); border-radius: 6px; color: var(--fg); font: inherit; font-size: 13px; padding: 4px 10px; cursor: pointer; }
footer button[aria-pressed="true"] { background: var(--line); }
#bar { display: flex; flex: 1; gap: 4px; }
#bar button { flex: 1; height: 6px; padding: 0; border: none; border-radius: 3px; background: var(--line); overflow: hidden; }
#bar i { display: block; height: 100%; width: 0; background: var(--accent); }
#count { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
`;

const SCRIPT = `
const scenes = [...document.querySelectorAll(".scene")];
const segments = [...document.querySelectorAll("#bar button")];
const play = document.getElementById("play");
const voice = document.getElementById("voice");
const count = document.getElementById("count");
const speech = window.speechSynthesis;
let index = 0, elapsed = 0, playing = false, utterance = null, last = performance.now();
const duration = (scene) => Number(scene.dataset.seconds) * 1000;
const steps = (scene) => [...new Set([...scene.querySelectorAll("[data-step]")].map((el) => Number(el.dataset.step)))].sort((a, b) => a - b);
for (const path of document.querySelectorAll(".draw")) path.setAttribute("pathLength", "1");
if (speech === undefined) voice.hidden = true;

function speak() {
  utterance = null;
  speech?.cancel();
  if (!playing || voice.getAttribute("aria-pressed") !== "true") return;
  const next = new SpeechSynthesisUtterance(scenes[index].querySelector(".caption").textContent);
  next.onend = next.onerror = () => { if (utterance === next) utterance = null; };
  utterance = next;
  speech.speak(next);
}
function show(next) {
  index = Math.max(0, Math.min(scenes.length - 1, next));
  elapsed = 0;
  scenes.forEach((scene, i) => scene.classList.toggle("active", i === index));
  for (const el of scenes[index].querySelectorAll("[data-step]")) el.classList.remove("shown");
  count.textContent = (index + 1) + " / " + scenes.length;
  speak();
  render();
}
function render() {
  const scene = scenes[index], total = duration(scene), order = steps(scene);
  order.forEach((step, i) => {
    const at = 300 + (total * 0.7 * i) / order.length;
    for (const el of scene.querySelectorAll('[data-step="' + step + '"]')) el.classList.toggle("shown", elapsed >= at);
  });
  segments.forEach((segment, i) => {
    segment.firstChild.style.width = (i < index ? 100 : i > index ? 0 : Math.min(100, (elapsed / total) * 100)) + "%";
  });
}
function setPlaying(next) {
  if (next && index === scenes.length - 1 && elapsed >= duration(scenes[index])) show(0);
  playing = next;
  play.textContent = playing ? "Pause" : "Play";
  play.setAttribute("aria-pressed", String(playing));
  speak();
}
function tick(now) {
  if (playing) {
    elapsed += now - last;
    if (elapsed >= duration(scenes[index]) && utterance === null) {
      if (index === scenes.length - 1) setPlaying(false);
      else show(index + 1);
    }
    render();
  }
  last = now;
  requestAnimationFrame(tick);
}
play.onclick = () => setPlaying(!playing);
document.getElementById("stage").onclick = () => setPlaying(!playing);
voice.onclick = () => { voice.setAttribute("aria-pressed", String(voice.getAttribute("aria-pressed") !== "true")); speak(); };
segments.forEach((segment, i) => { segment.onclick = () => show(i); });
document.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "k") setPlaying(!playing);
  else if (event.key === "ArrowRight" || event.key === "l") show(index + 1);
  else if (event.key === "ArrowLeft" || event.key === "j") show(index - 1);
  else if (event.key === "v") voice.click();
  else return;
  event.preventDefault();
});
show(0);
setPlaying(true);
requestAnimationFrame(tick);
`;

export function videoDocument(video: Pick<Video, "title" | "scenes">): string {
  const scenes = video.scenes.map(
    (scene) =>
      `<section class="scene" data-seconds="${sceneSeconds(scene.narration)}"><h2>${escapeHtml(scene.title)}</h2><div class="visual">${scene.visual}</div><p class="caption">${escapeHtml(scene.narration)}</p></section>`,
  );
  const segments = video.scenes.map((scene, index) => `<button type="button" aria-label="Scene ${index + 1}: ${escapeHtml(scene.title)}"><i></i></button>`);
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">`,
    `<title>${escapeHtml(video.title)}</title><style>${STYLE}</style></head><body>`,
    `<main id="stage">${scenes.join("")}</main>`,
    `<footer><button type="button" id="play" title="Play or pause (space)">Play</button><div id="bar">${segments.join("")}</div><span id="count"></span><button type="button" id="voice" aria-pressed="false" title="Read the narration aloud (v)">Voice</button></footer>`,
    `<script>${SCRIPT}</script></body></html>`,
  ].join("\n");
}

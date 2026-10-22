import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../contract";

const cache = new Map<string, Promise<string | null>>();

export function useArt(url: string | null | undefined, demo = false): string | null {
  const rpc = useRpc<RpcContract>();
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    if (!url) return;
    if (demo || url.startsWith("data:")) {
      setData(url);
      return;
    }
    let live = true;
    let pending = cache.get(url);
    if (pending === undefined) {
      pending = rpc.call("art_get", { url }).then(
        (result) => result.dataUrl,
        () => null,
      );
      cache.set(url, pending);
      if (cache.size > 40) cache.delete(cache.keys().next().value!);
    }
    void pending.then((value) => live && setData(value));
    return () => {
      live = false;
    };
  }, [url, demo, rpc]);
  return data;
}

export interface Sample {
  cols: number;
  rows: number;
  luma: Float32Array;
  rgb: Uint8ClampedArray;
}

export function sample(dataUrl: string, cols: number, rows: number): Promise<Sample | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = rows;
      const context = canvas.getContext("2d");
      if (context === null) return resolve(null);
      context.drawImage(image, 0, 0, cols, rows);
      const pixels = context.getImageData(0, 0, cols, rows).data;
      const luma = new Float32Array(cols * rows);
      const rgb = new Uint8ClampedArray(cols * rows * 3);
      for (let index = 0; index < cols * rows; index += 1) {
        const [r, g, b] = [pixels[index * 4]!, pixels[index * 4 + 1]!, pixels[index * 4 + 2]!];
        luma[index] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        rgb.set([r, g, b], index * 3);
      }
      resolve({ cols, rows, luma, rgb });
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

export function useSample(dataUrl: string | null, cols: number, rows: number): Sample | null {
  const [result, setResult] = useState<Sample | null>(null);
  useEffect(() => {
    let live = true;
    setResult(null);
    if (dataUrl !== null) void sample(dataUrl, cols, rows).then((value) => live && setResult(value));
    return () => {
      live = false;
    };
  }, [dataUrl, cols, rows]);
  return result;
}

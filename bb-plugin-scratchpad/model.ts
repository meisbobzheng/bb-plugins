import * as z from "zod/mini";
import { COLORS, SHAPE_KINDS } from "./constants.js";

export type Color = (typeof COLORS)[number];
export type ShapeKind = (typeof SHAPE_KINDS)[number];

const coordinate = z.number().check(z.gte(-1e7), z.lte(1e7));
const point = z.tuple([coordinate, coordinate]);
const size = z.number().check(z.gte(0), z.lte(1e6));
const color = z.enum(COLORS);
const strokeWidth = z.number().check(z.gte(0.5), z.lte(48));
const id = z.string().check(z.minLength(1), z.maxLength(64));
const text = z.string().check(z.maxLength(20_000));

const penSchema = z.object({
  id,
  type: z.literal("pen"),
  points: z.array(point).check(z.minLength(1), z.maxLength(20_000)),
  color,
  width: strokeWidth,
});
const lineSchema = z.object({
  id,
  type: z.literal("line"),
  points: z.tuple([point, point]),
  arrow: z.boolean(),
  color,
  width: strokeWidth,
});
const shapeSchema = z.object({
  id,
  type: z.literal("shape"),
  kind: z.enum(SHAPE_KINDS),
  x: coordinate,
  y: coordinate,
  w: size,
  h: size,
  color,
  width: strokeWidth,
  fill: z.boolean(),
});
const polygonSchema = z.object({
  id,
  type: z.literal("polygon"),
  points: z.array(point).check(z.minLength(3), z.maxLength(2_000)),
  color,
  width: strokeWidth,
  fill: z.boolean(),
});
const textSchema = z.object({
  id,
  type: z.literal("text"),
  x: coordinate,
  y: coordinate,
  text,
  color,
  size: z.number().check(z.gte(6), z.lte(400)),
});
const noteSchema = z.object({
  id,
  type: z.literal("note"),
  x: coordinate,
  y: coordinate,
  w: size,
  h: size,
  text,
  color,
});

export const elementSchema = z.discriminatedUnion("type", [
  penSchema,
  lineSchema,
  shapeSchema,
  polygonSchema,
  textSchema,
  noteSchema,
]);
export const elementsSchema = z.array(elementSchema).check(z.maxLength(10_000));

export type Point = z.infer<typeof point>;
export type Element = z.infer<typeof elementSchema>;
export type ElementOf<T extends Element["type"]> = Extract<Element, { type: T }>;

export const boardSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  elementCount: z.number(),
  updatedAt: z.string(),
});
export type BoardSummary = z.infer<typeof boardSummarySchema>;

export const boardSchema = z.extend(boardSummarySchema, {
  elements: elementsSchema,
});
export type Board = z.infer<typeof boardSchema>;

export const boardNameSchema = z.string().check(z.trim(), z.minLength(1), z.maxLength(120));

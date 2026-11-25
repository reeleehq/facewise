/**
 * The canonical face schema (`faces/1`), as Zod: the single source of truth for every
 * type in facewise, and, exported as JSON Schema (`schemas/`), the contract a Python
 * or server-side producer validates against.
 *
 * Conventions (docs/research/face-facade-synthesis.md):
 * - coordinates are normalised to [0, 1] of the image passed in, top-left origin, and
 *   NOT clamped (a partial face outside the frame must still be covered inside it);
 *   the image size travels in `FaceResult.image`, so pixels are one call away (`toPixels`);
 * - scores are in [0, 1], or `null` when a backend gives none (never invented);
 * - left and right are the SUBJECT's own (MediaPipe, COCO): on an upright, unmirrored,
 *   frontal face `leftEye.x > rightEye.x`;
 * - angles are degrees; roll > 0 means the face is rotated clockwise as displayed;
 * - time is seconds of media time.
 */
import { z } from 'zod';

export const SCHEMA_ID = 'faces/1' as const;

export const Point = z.object({ x: z.number(), y: z.number(), z: z.number().optional() });
export type Point = z.infer<typeof Point>;

/** `{x, y, w, h}`, normalised, top-left origin, unclamped. */
export const Box = z.object({ x: z.number(), y: z.number(), w: z.number().nonnegative(), h: z.number().nonnegative() });
export type Box = z.infer<typeof Box>;

export const KEYPOINTS = ['rightEye', 'leftEye', 'noseTip', 'mouthCenter', 'mouthRight', 'mouthLeft', 'rightEar', 'leftEar'] as const;
export const KeypointName = z.enum(KEYPOINTS);
export type KeypointName = z.infer<typeof KeypointName>;
export const Keypoints = z.partialRecord(KeypointName, Point);
export type Keypoints = z.infer<typeof Keypoints>;

/** A dense landmark set, tagged with its topology (`mediapipe-478`, `insightface-106`, `ibug-68`…). */
export const Mesh = z.object({ topology: z.string(), points: z.array(Point) });
export type Mesh = z.infer<typeof Mesh>;

/** Head pose in degrees. */
export const Pose = z.object({ yaw: z.number(), pitch: z.number(), roll: z.number() });
export type Pose = z.infer<typeof Pose>;

/** An identity vector; only comparable with vectors of the same `space`. */
export const Embedding = z.object({ space: z.string(), vector: z.array(z.number()), normalized: z.boolean() });
export type Embedding = z.infer<typeof Embedding>;

export const DetectedFace = z.object({
  box: Box,
  score: z.number().min(0).max(1).nullable(),
  keypoints: Keypoints.optional(),
  mesh: Mesh.optional(),
  pose: Pose.optional(),
  /** Native names (MediaPipe uses ARKit's); 0..1. */
  blendshapes: z.record(z.string(), z.number()).optional(),
  quality: z.object({ blur: z.number(), occluded: z.number(), exposure: z.number() }).partial().optional(),
  embedding: Embedding.optional(),
  /** A server-side handle (a vendor's face id); never an embedding. */
  ref: z.object({ backend: z.string(), id: z.string(), expiresAt: z.string().optional() }).optional(),
  trackId: z.string().optional(),
  /** JSON-safe native-only fields, under their native names. */
  extras: z.record(z.string(), z.unknown()).optional(),
});
export type DetectedFace = z.infer<typeof DetectedFace>;

export const ImageSize = z.object({ width: z.number().int().positive(), height: z.number().int().positive() });
export type ImageSize = z.infer<typeof ImageSize>;

export const FaceResult = z.object({
  schema: z.literal(SCHEMA_ID),
  backend: z.string(),
  image: ImageSize,
  faces: z.array(DetectedFace),
  /** Every coercion, post-filter or drop, in words: never silent. */
  notes: z.array(z.string()).default([]),
});
export type FaceResult = z.infer<typeof FaceResult>;

/** What a caller can ask for beyond a box and a score. */
export const WANTS = ['keypoints', 'mesh', 'pose', 'blendshapes', 'quality', 'embedding', 'trackIds'] as const;
export const Want = z.enum(WANTS);
export type Want = z.infer<typeof Want>;

/** What a backend really fills, declared as data (capability honesty). */
export const BackendInfo = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: z.enum(['on-device', 'browser-native', 'cloud']),
  modes: z.array(z.enum(['image', 'video', 'live'])),
  emits: z.object({
    keypoints: z.array(KeypointName),
    mesh: z.string().nullable(),
    pose: z.boolean(),
    blendshapes: z.boolean(),
    quality: z.array(z.enum(['blur', 'occluded', 'exposure'])),
    embedding: z.string().nullable(),
    trackIds: z.boolean(),
    score: z.boolean(),
  }),
  privacy: z.object({ imageLeavesDevice: z.boolean(), thirdPartyHosts: z.array(z.string()) }),
  license: z.object({ code: z.string(), weights: z.string() }),
});
export type BackendInfo = z.infer<typeof BackendInfo>;

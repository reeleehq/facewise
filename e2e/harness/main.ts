// Browser harness for the conformance e2e: exposes facewise on window.
import * as facewise from '../../src/index';
import * as mediapipe from '../../src/mediapipe/index';

async function bitmapFromBase64(b64: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
}

/** The region around a box (normalised), enlarged, as a canvas. */
function crop(img: ImageBitmap, box: facewise.Box, grow = 2.2): HTMLCanvasElement {
  const cx = (box.x + box.w / 2) * img.width;
  const cy = (box.y + box.h / 2) * img.height;
  const side = Math.max(box.w * img.width, box.h * img.height) * grow;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(side);
  c.getContext('2d')!.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, side, side);
  return c;
}

/** `src` rotated `deg` clockwise (as displayed) on a canvas large enough to hold it. */
function rotate(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const a = (deg * Math.PI) / 180;
  const side = Math.ceil(Math.hypot(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = c.height = side;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, side, side);
  ctx.translate(side / 2, side / 2);
  ctx.rotate(a); // canvas rotation is clockwise on screen for positive angles
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

Object.assign(window, { facewise, mediapipe, bitmapFromBase64, crop, rotate });

/**
 * タスクトレイのアイコン。承認待ちがあるときは、右下に印（点）を付ける。
 */
import { nativeImage, type NativeImage } from 'electron';
import { assetPath } from './assets';

/** トレイのアイコンの大きさ（論理ピクセル） */
const SIZE = 16;
/** 高解像度の画面向けに、倍の大きさも用意する */
const SCALES = [1, 2];
/** 印の色（テーマの warning と同じ #E8A317） */
const BADGE_COLOR = { r: 0xe8, g: 0xa3, b: 0x17 };

export interface TrayIcons {
  normal: NativeImage;
  withBadge: NativeImage;
}

export function createTrayIcons(): TrayIcons {
  const source = nativeImage.createFromPath(assetPath('icon.png'));
  const normal = nativeImage.createEmpty();
  const withBadge = nativeImage.createEmpty();
  for (const scaleFactor of SCALES) {
    const size = SIZE * scaleFactor;
    const resized = source.resize({
      width: size,
      height: size,
      quality: 'best',
    });
    normal.addRepresentation({
      scaleFactor,
      width: size,
      height: size,
      buffer: resized.toPNG(),
    });
    const bitmap = drawBadge(resized.toBitmap(), size);
    withBadge.addRepresentation({
      scaleFactor,
      width: size,
      height: size,
      buffer: nativeImage
        .createFromBitmap(bitmap, { width: size, height: size })
        .toPNG(),
    });
  }
  return { normal, withBadge };
}

/**
 * 画像の右下に丸い印を描く。
 * toBitmap の画素は BGRA の並び（Chromium の既定）として扱う。
 */
function drawBadge(bitmap: Buffer, size: number): Buffer {
  const out = Buffer.from(bitmap);
  const radius = size * 0.28;
  const cx = size - radius - 0.5;
  const cy = size - radius - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) {
        continue;
      }
      const i = (y * size + x) * 4;
      out[i] = BADGE_COLOR.b;
      out[i + 1] = BADGE_COLOR.g;
      out[i + 2] = BADGE_COLOR.r;
      out[i + 3] = 0xff;
    }
  }
  return out;
}

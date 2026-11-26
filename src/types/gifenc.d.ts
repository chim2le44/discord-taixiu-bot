declare module 'gifenc' {
  export interface GifEncoderOptions {
    initialCapacity?: number;
    auto?: boolean;
  }

  export interface WriteFrameOptions {
    palette?: number[][];
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    colorDepth?: number;
    first?: boolean;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opt?: GifEncoderOptions): GifEncoderInstance;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
}

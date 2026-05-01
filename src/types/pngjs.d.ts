// Minimal manual type shim for pngjs@7.0.0.
// Covers only the surface used by core/sprites-runtime and its tests:
// the synchronous read/write API exposed under PNG.sync.
//
// Upstream `pngjs` ships JS-only. We pin the runtime dep exact (7.0.0) for
// determinism; rather than add a separate @types/pngjs devDep we declare
// just enough here to keep the diff minimal.

declare module "pngjs" {
  export interface PNGImage {
    width: number;
    height: number;
    data: Buffer;
  }

  export interface PNGWriteOptions {
    width: number;
    height: number;
    data: Buffer;
    colorType?: number;
    inputColorType?: number;
    bitDepth?: number;
  }

  export const PNG: {
    sync: {
      read(buffer: Buffer, options?: Record<string, unknown>): PNGImage;
      write(png: PNGWriteOptions, options?: Record<string, unknown>): Buffer;
    };
  };
}

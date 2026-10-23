declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(src: {
    data: Uint8Array;
    disableWorker: boolean;
    isEvalSupported: boolean;
    useSystemFonts: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      canvasFactory: {
        create: (width: number, height: number) => {
          canvas: { toBuffer: (mime: "image/png") => Uint8Array };
          context: CanvasRenderingContext2D;
        };
        destroy: (canvas: unknown) => void;
      };
      getPage: (page: number) => Promise<{
        getViewport: (opts: { scale: number }) => { width: number; height: number };
        render: (opts: {
          canvas: { toBuffer: (mime: "image/png") => Uint8Array };
          canvasContext: CanvasRenderingContext2D;
          viewport: unknown;
        }) => { promise: Promise<void> };
        cleanup: () => void;
      }>;
      destroy: () => Promise<void>;
    }>;
  };
}

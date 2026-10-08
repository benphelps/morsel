import { useEffect, useRef } from "react";
import type { Frame } from "../../shared/render";
import { HEIGHT, WIDTH } from "../../shared/types";
import { paintFrame, type LedMode } from "../led";

/** A static LED view of one frame. For animation, use a rAF loop with paintFrame. */
export function LedCanvas({ frame, zoom, mode = "led", className }: { frame: Frame | null; zoom: number; mode?: LedMode; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx && frame) paintFrame(ctx, frame, zoom, mode);
  }, [frame, zoom, mode]);
  return <canvas ref={ref} className={className} width={WIDTH * zoom} height={HEIGHT * zoom} />;
}

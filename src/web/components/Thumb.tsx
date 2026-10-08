import { useMemo } from "react";
import { renderSlide, settleSlide } from "../../shared/render";
import type { Slide } from "../../shared/types";
import { scopeAt } from "../store";
import { useStore } from "../store";
import { LedCanvas } from "./LedCanvas";

/** Still preview of a slide, a moment after its entry animations settle. */
export function Thumb({ slide, zoom = 3 }: { slide: Slide; zoom?: number }) {
  const status = useStore((s) => s.sourceStatus);
  const frame = useMemo(() => {
    const scope = scopeAt(Date.now(), slide);
    const played = settleSlide(slide, scope);
    return renderSlide(played, Math.min(played.durationSec * 1000 - 1, 2000), scope);
  }, [slide, status]);
  return <LedCanvas frame={frame} zoom={zoom} mode="pixel" className="thumb" />;
}

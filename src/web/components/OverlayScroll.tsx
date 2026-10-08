import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A scrolling area whose scrollbar floats over the content instead of taking
 * a strip of its own: content keeps its full width whether or not it scrolls
 * (so dividers run edge to edge, and opening a section never shifts things
 * sideways). The bar shows while hovering or scrolling, and can be dragged.
 */
export function OverlayScroll({ className = "", children }: { className?: string; children: ReactNode }) {
  const view = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ y: number; scrollTop: number } | null>(null);

  const measure = useCallback(() => {
    const v = view.current;
    if (!v) return;
    const { scrollTop, scrollHeight, clientHeight } = v;
    if (scrollHeight <= clientHeight + 1) return setThumb(null);
    const height = Math.max(24, (clientHeight * clientHeight) / scrollHeight);
    setThumb({ height, top: (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height) });
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const onScroll = () => {
      measure();
      setScrolling(true);
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => setScrolling(false), 800);
    };
    // The view's size and its content's (sections opening and closing) both change what scrolls.
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    const observeContent = () => Array.from(v.children).forEach((c) => ro.observe(c));
    observeContent();
    const mo = new MutationObserver(() => {
      observeContent();
      measure();
    });
    mo.observe(v, { childList: true });
    v.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      ro.disconnect();
      mo.disconnect();
      v.removeEventListener("scroll", onScroll);
      if (idle.current) clearTimeout(idle.current);
    };
  }, [measure]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, scrollTop: view.current?.scrollTop ?? 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const v = view.current;
    if (!drag.current || !v || !thumb) return;
    // Moving the bar by its track's free length scrolls the whole way.
    const ratio = (v.scrollHeight - v.clientHeight) / Math.max(1, v.clientHeight - thumb.height);
    v.scrollTop = drag.current.scrollTop + (e.clientY - drag.current.y) * ratio;
  };

  return (
    <div className={`oscroll ${className}`}>
      <div className="oscroll-view" ref={view}>
        {children}
      </div>
      {thumb && (
        <div
          className={`oscroll-thumb ${scrolling || drag.current ? "active" : ""}`}
          style={{ top: thumb.top, height: thumb.height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onLostPointerCapture={() => (drag.current = null)}
        />
      )}
    </div>
  );
}

import { useRef, type ReactNode } from "react";
import { HEIGHT, WIDTH } from "../../shared/types";
import { Note, Section } from "../../web/components/Fields";
import { BindingField } from "../../web/components/BindingField";
import { setEverywhere } from "../../web/model";
import type { AddButtonProps, PanelProps } from "../types";
import { imageElement, type ImageElement } from "./element";
import { Icon, PathIcon } from "../../web/components/Icon";

export function ImagePanel({ el, edit }: PanelProps<ImageElement>) {
  return (
    <Section
      id="image"
      title="Image"
      actions={
        <>
          <ImageButton label={<Icon name="upload" size={14} />} className="fold-action" title="Replace: load another image file" onLoad={(img) => edit((x) => Object.assign(x, img))} />
          <button className="fold-action" title="Native size: one LED per pixel of the image" aria-label="Native size" onClick={() => edit((x) => setEverywhere(x, { w: x.srcW, h: x.srcH }))}>
            <Icon name="actualSize" size={14} />
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field-label">From data</span>
        <BindingField kind="image" value={el.src ?? ""} none="None: the uploaded image" onChange={(v) => edit((x) => (x.src = v))} />
        <Note>{el.src?.trim() ? "Uses the bound image; the uploaded one is ignored." : `Uploaded image, ${el.srcW}×${el.srcH}px.`}</Note>
      </div>
      <label className="check">
        <input type="checkbox" checked={el.tint} onChange={(e) => edit((x) => (x.tint = e.target.checked))} /> Tint with colour
      </label>
    </Section>
  );
}

/** The toolbar button: pick a file, then add it centred at its native size. */
export function AddImageButton({ add, disabled }: AddButtonProps<ImageElement>) {
  return (
    <ImageButton
      label={
        <>
          <PathIcon d={imageElement.icon} className="tool-glyph" />
          {imageElement.label}
        </>
      }
      className="tool"
      disabled={disabled}
      onLoad={(img) =>
        add({
          ...img,
          state: { x: Math.floor((WIDTH - img.srcW) / 2), y: Math.floor((HEIGHT - img.srcH) / 2), w: img.srcW, h: img.srcH, color: "#ffffff", opacity: 1 },
        })
      }
    />
  );
}

/* ---------------- loading files ---------------- */

export interface LoadedImage {
  srcW: number;
  srcH: number;
  data: string;
}

function toBase64(bytes: Uint8ClampedArray) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Loads an image file, shrinking it to fit the 64×32 panel if needed. */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = k < 1;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return { srcW: w, srcH: h, data: toBase64(ctx.getImageData(0, 0, w, h).data) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageButton({ label, onLoad, className = "btn small", disabled, title }: { label: ReactNode; onLoad: (img: LoadedImage) => void; className?: string; disabled?: boolean; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={className} disabled={disabled} title={title} aria-label={title} onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onLoad(await loadImageFile(f));
          e.target.value = "";
        }}
      />
    </>
  );
}

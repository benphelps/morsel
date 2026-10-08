import { elementDef, type ElementType } from "../../elements";
import { PathIcon } from "./Icon";

export function ElementGlyph({ type }: { type: ElementType }) {
  const icon = elementDef(type)?.icon;
  return <span className={`glyph glyph-${type}`}>{icon ? <PathIcon d={icon} size={12} /> : "?"}</span>;
}

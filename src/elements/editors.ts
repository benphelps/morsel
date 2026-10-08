// The editor half of each element type (inspector panels, special toolbar
// buttons). Editor only: the server never imports this file.
import { EffectPanel } from "./effect/Panel";
import { EllipsePanel } from "./ellipse/Panel";
import { GroupPanel } from "./group/Panel";
import { IconPanel } from "./icon/Panel";
import { AddImageButton, ImagePanel } from "./image/Panel";
import type { ElementOfType, ElementType } from "./index";
import { LinePanel } from "./line/Panel";
import { RectPanel } from "./rect/Panel";
import { RotatorPanel } from "./rotator/Panel";
import { rotatorTracks } from "./rotator/timeline";
import { SparklinePanel } from "./sparkline/Panel";
import { TextPanel } from "./text/Panel";
import { textTracks } from "./text/timeline";
import type { ElementEditor } from "./types";

export const ELEMENT_EDITORS: { [T in ElementType]: ElementEditor<ElementOfType<T>> } = {
  text: { Panel: TextPanel, tracks: textTracks },
  rotator: { Panel: RotatorPanel, tracks: rotatorTracks },
  rect: { Panel: RectPanel },
  ellipse: { Panel: EllipsePanel },
  line: { Panel: LinePanel },
  icon: { Panel: IconPanel },
  sparkline: { Panel: SparklinePanel },
  image: { Panel: ImagePanel, AddButton: AddImageButton },
  effect: { Panel: EffectPanel },
  group: { Panel: GroupPanel },
};

/** The editor half for any element, typed loosely for generic callers. */
export function elementEditor(type: ElementType): ElementEditor<any> {
  return ELEMENT_EDITORS[type] ?? {};
}

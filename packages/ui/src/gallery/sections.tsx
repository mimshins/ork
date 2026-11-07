/** @file The gallery's sections, in the order they come down the page. */

import { Controls } from "./controls.tsx";
import { Copy } from "./copy.tsx";
import { GraphSample } from "./graph-sample.tsx";
import { Overlays } from "./overlays.tsx";

export const Sections = () => (
  <>
    <Controls />
    <Copy />
    <Overlays />
    <GraphSample />
  </>
);

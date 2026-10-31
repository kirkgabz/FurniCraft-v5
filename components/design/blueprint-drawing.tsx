"use client";

import { useMemo } from "react";
import { generateBlueprintSvg } from "./blueprint-svg";
import type { CadStateItem } from "./design-state-utils";

type Props = {
  item: CadStateItem;
  title?: string;
};

export default function BlueprintDrawing({ item, title }: Props) {
  const svg = useMemo(() => generateBlueprintSvg(item, { title }), [item, title]);

  return (
    <div
      className="w-full overflow-x-auto rounded-2xl border border-[var(--fc-border)] bg-white p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

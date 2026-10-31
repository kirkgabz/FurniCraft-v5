import type { Metadata } from "next";
import FurnitureTypePicker from "@/components/design/studio/furniture-type-picker";

export const metadata: Metadata = {
  title: "Customize Furniture | FurniCraft",
  description: "Pick a piece of furniture, then change every part's finish and size in the 3D studio.",
};

export default function Page() {
  return <FurnitureTypePicker />;
}

import { newFeature } from "./new-feature";

export function legacyFeature(value: number) {
  return newFeature(value) + 1;
}
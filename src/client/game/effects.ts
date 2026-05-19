export const MAX_IMPACT_RINGS = 14;
export const MAX_SCREEN_FLASHES = 4;

export function trimEffectChildren(layer: HTMLElement, selector: string, max: number) {
  const nodes = layer.querySelectorAll(selector);
  if (nodes.length >= max) nodes[0]?.remove();
}

export function clearEffectLayerChildren(layer: HTMLElement) {
  layer.replaceChildren();
}

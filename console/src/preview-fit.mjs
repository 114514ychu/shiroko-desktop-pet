// Presentation only: the native character camera, size and playback stay intact.
// The 310:280 frame fills the card's nearly square image box: ordinary figures
// gain about 16% in displayed height, while wide scenes still fit in full.
export const PREVIEW_FRAME = Object.freeze({ width: 310, height: 280, padding: 16, baseline: 264 });

// Match the rendered-footprint threshold used by role/footer validation. Source
// animations can rasterize a collapsed unused prop as a faint remote pixel.
// This selects the framing bounds; the complete source image is still drawn.
export function visibleBounds(pixels, width, height, alphaThreshold = 32) {
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

export function projectBounds(bounds, fit) {
  return {
    left: bounds.left * fit.scale + fit.x, top: bounds.top * fit.scale + fit.y,
    right: bounds.right * fit.scale + fit.x, bottom: bounds.bottom * fit.scale + fit.y
  };
}

export function fitPreview(bounds, previous, key, frame = PREVIEW_FRAME) {
  if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null;
  let envelope = { ...bounds };
  if (previous?.key === key) {
    const centered = { ...previous, x: frame.width / 2 - (bounds.left + bounds.right) / 2 * previous.scale };
    const projected = projectBounds(bounds, centered);
    // Keep scale and vertical breathing motion; center the current silhouette
    // horizontally so an asymmetric hair/cloth pose cannot leave the card skewed.
    // Expand only when new content needs room; never crop a late appearing prop.
    if (projected.left >= frame.padding - 1 && projected.right <= frame.width - frame.padding + 1 &&
        projected.top >= frame.padding - 1 && projected.bottom <= frame.baseline + 1) return centered;
    envelope = {
      left: Math.min(previous.envelope.left, bounds.left), top: Math.min(previous.envelope.top, bounds.top),
      right: Math.max(previous.envelope.right, bounds.right), bottom: Math.max(previous.envelope.bottom, bounds.bottom)
    };
  }
  const scale = Math.min((frame.width - frame.padding * 2) / (envelope.right - envelope.left),
    (frame.baseline - frame.padding) / (envelope.bottom - envelope.top));
  return { key, envelope, scale,
    x: frame.width / 2 - (envelope.left + envelope.right) / 2 * scale,
    y: (frame.padding + frame.baseline - (envelope.top + envelope.bottom) * scale) / 2 };
}

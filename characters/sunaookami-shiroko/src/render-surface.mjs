// Keep pose probes away from the canvas Windows is compositing on the desktop.
export function createRenderSurface(renderer, THREE) {
  let target = null, pixels = null;
  let readbackCanvas = null, cssCanvas = null, imageData = null;
  const logicalSize = new THREE.Vector2();
  const metrics = { offscreenSamples: 0, resizeChanges: 0, redundantResizeSkips: 0 };
  return {
    metrics,
    measureAlphaBottom(width, height, draw, threshold = 32) {
      width = Math.floor(width); height = Math.floor(height);
      if (width < 1 || height < 1) return 0;
      // Match the displayed drawing-buffer resolution before the same CSS
      // downsampling. A CSS-resolution render can expose isolated weak pixels
      // which disappear in the actual high-DPI canvas (notably small Hifumi).
      const ratio = renderer.getPixelRatio();
      const pixelWidth = Math.max(1, Math.floor(width * ratio));
      const pixelHeight = Math.max(1, Math.floor(height * ratio));
      if (!target) {
        target = new THREE.WebGLRenderTarget(pixelWidth, pixelHeight);
        target.samples = Math.min(4, renderer.capabilities.maxSamples || 0);
      } else if (target.width !== pixelWidth || target.height !== pixelHeight) target.setSize(pixelWidth, pixelHeight);
      if (!pixels || pixels.length !== pixelWidth * pixelHeight * 4) pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
      const previous = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace();
      const mip = renderer.getActiveMipmapLevel();
      try {
        renderer.setRenderTarget(target);
        draw();
        renderer.readRenderTargetPixels(target, 0, 0, pixelWidth, pixelHeight, pixels);
        metrics.offscreenSamples++;
        if (pixelWidth !== width || pixelHeight !== height) {
          readbackCanvas ||= document.createElement('canvas');
          cssCanvas ||= document.createElement('canvas');
          if (readbackCanvas.width !== pixelWidth || readbackCanvas.height !== pixelHeight) {
            readbackCanvas.width = pixelWidth; readbackCanvas.height = pixelHeight; imageData = null;
          }
          if (cssCanvas.width !== width || cssCanvas.height !== height) { cssCanvas.width = width; cssCanvas.height = height; }
          const source = readbackCanvas.getContext('2d', { willReadFrequently: true });
          imageData ||= source.createImageData(pixelWidth, pixelHeight);
          for (let row = 0; row < pixelHeight; row++) {
            imageData.data.set(pixels.subarray(row * pixelWidth * 4, (row + 1) * pixelWidth * 4), (pixelHeight - row - 1) * pixelWidth * 4);
          }
          source.putImageData(imageData, 0, 0);
          const context = cssCanvas.getContext('2d', { willReadFrequently: true });
          context.clearRect(0, 0, width, height); context.drawImage(readbackCanvas, 0, 0, width, height);
          const cssPixels = context.getImageData(0, 0, width, height).data;
          for (let row = height - 1; row >= 0; row--) for (let column = 0; column < width; column++) {
            if (cssPixels[(row * width + column) * 4 + 3] > threshold) return row + 1;
          }
          return 0;
        }
        // WebGL readback starts at the lower left; CSS rows start at the top.
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
          if (pixels[(row * width + column) * 4 + 3] > threshold) return height - row;
        }
        return 0;
      } finally {
        renderer.setRenderTarget(previous, face, mip);
      }
    },
    resize(width, height, updateAndDraw) {
      if (width < 1 || height < 1) return false;
      renderer.getSize(logicalSize);
      const ratio = renderer.getPixelRatio(), canvas = renderer.domElement;
      if (logicalSize.x === width && logicalSize.y === height && canvas.width === Math.floor(width * ratio) && canvas.height === Math.floor(height * ratio)) {
        metrics.redundantResizeSkips++;
        return false;
      }
      renderer.setSize(width, height, false);
      metrics.resizeChanges++;
      // setSize clears the drawing buffer. Refill it before this callback yields.
      updateAndDraw();
      return true;
    },
    dispose() { target?.dispose(); target = null; pixels = null; readbackCanvas = null; cssCanvas = null; imageData = null; }
  };
}

/**
 * Keeps a canvas's backing-store resolution in sync with its displayed (CSS) size, accounting
 * for devicePixelRatio, so drawing stays crisp across window/layout resizes. Returns a disposer.
 */
export function observeCanvasSize(canvas: HTMLCanvasElement, onResize?: (width: number, height: number) => void): () => void {
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      onResize?.(width, height);
    }
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  return () => observer.disconnect();
}

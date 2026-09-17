export type SplitterOrientation = "column" | "row";

/**
 * Lets the user drag `divider` to resize the two adjacent CSS grid panels inside `container` - the
 * first panel's track becomes a fixed pixel size (clamped to `min`/available space) and the second
 * panel stays `1fr`, filling whatever space remains. Also supports arrow-key nudging for accessibility.
 */
export function createPanelSplitter(
  container: HTMLElement,
  divider: HTMLElement,
  options: { min?: number; orientation?: SplitterOrientation } = {},
): void {
  const orientation = options.orientation ?? "column";
  const min = options.min ?? 200;
  let dragging = false;
  const firstRect = container.children[0].getBoundingClientRect();
  let sizePx = orientation === "column" ? firstRect.width : firstRect.height;

  function setSize(px: number): void {
    const rect = container.getBoundingClientRect();
    const dividerRect = divider.getBoundingClientRect();
    const containerSize = orientation === "column" ? rect.width : rect.height;
    const dividerSize = (orientation === "column" ? dividerRect.width : dividerRect.height) || 6;
    const max = Math.max(min, containerSize - min - dividerSize);
    sizePx = Math.min(Math.max(px, min), max);
    const tracks = `${sizePx}px ${dividerSize}px 1fr`;
    if (orientation === "column") {
      container.style.gridTemplateColumns = tracks;
    } else {
      container.style.gridTemplateRows = tracks;
    }
    divider.setAttribute("aria-valuenow", String(Math.round((sizePx / containerSize) * 100)));
  }

  divider.addEventListener("pointerdown", (event) => {
    dragging = true;
    divider.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  divider.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const pos = orientation === "column" ? event.clientX - rect.left : event.clientY - rect.top;
    setSize(pos);
  });

  const stopDragging = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    divider.releasePointerCapture(event.pointerId);
  };
  divider.addEventListener("pointerup", stopDragging);
  divider.addEventListener("pointercancel", stopDragging);

  const decreaseKey = orientation === "column" ? "ArrowLeft" : "ArrowUp";
  const increaseKey = orientation === "column" ? "ArrowRight" : "ArrowDown";
  divider.addEventListener("keydown", (event) => {
    const step = 24;
    if (event.key === decreaseKey) {
      setSize(sizePx - step);
      event.preventDefault();
    } else if (event.key === increaseKey) {
      setSize(sizePx + step);
      event.preventDefault();
    }
  });
}


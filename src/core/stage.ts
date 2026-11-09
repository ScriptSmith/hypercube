/**
 * The stage is the element apps draw into. Normally it fills the viewport. With
 * `fit=WxH` it is letterboxed to that aspect, so a phone or laptop can stand in
 * for a venue display.
 */
export interface Stage {
  readonly el: HTMLElement;
  size(): { width: number; height: number };
  onResize(cb: (size: { width: number; height: number }) => void): () => void;
  dispose(): void;
}

export const createStage = (
  host: HTMLElement,
  fit: { width: number; height: number } | null,
): Stage => {
  const el = document.createElement("div");
  el.className = "hc-stage";
  el.style.cssText = "position:absolute;overflow:hidden;touch-action:none;";
  host.append(el);

  let current = { width: 0, height: 0 };
  const listeners = new Set<(size: { width: number; height: number }) => void>();

  const layout = () => {
    const vw = host.clientWidth;
    const vh = host.clientHeight;
    let width = vw;
    let height = vh;
    if (fit) {
      const scale = Math.min(vw / fit.width, vh / fit.height);
      width = Math.floor(fit.width * scale);
      height = Math.floor(fit.height * scale);
    }
    el.style.left = `${Math.floor((vw - width) / 2)}px`;
    el.style.top = `${Math.floor((vh - height) / 2)}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    if (width !== current.width || height !== current.height) {
      current = { width, height };
      for (const cb of listeners) cb(current);
    }
  };

  const observer = new ResizeObserver(layout);
  observer.observe(host);
  layout();

  return {
    el,
    size: () => current,
    onResize(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      observer.disconnect();
      listeners.clear();
      el.remove();
    },
  };
};

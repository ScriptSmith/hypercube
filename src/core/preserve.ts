/**
 * WebGL clears a canvas's drawing buffer once the browser has shown it, so another canvas
 * can't copy it later in the frame. The globe preview copies every canvas of the app it shows,
 * so in that mode every WebGL context keeps its buffer. Only previews pay the cost.
 */
type GetContext = (
  this: HTMLCanvasElement,
  type: string,
  attrs?: object,
) => RenderingContext | null;

let installed = false;

export const preserveDrawingBuffers = (): void => {
  if (installed) return;
  installed = true;
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: GetContext };
  const original = proto.getContext;
  proto.getContext = function (type, attrs) {
    const gl = type === "webgl" || type === "webgl2" || type === "experimental-webgl";
    return original.call(this, type, gl ? { ...attrs, preserveDrawingBuffer: true } : attrs);
  };
};

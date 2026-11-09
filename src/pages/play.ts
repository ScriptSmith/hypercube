import { boot } from "../core/runtime";

// Long presses on touch screens open the context menu, and pinches zoom, unless blocked here.
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("gesturestart", (e) => e.preventDefault());

void boot(document.body);

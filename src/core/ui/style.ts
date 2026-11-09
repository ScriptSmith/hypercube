const STYLE_ID = "hc-ui-style";

/** Fonts that exist on the venue machines (Windows) and on test devices. */
export const FONT = `system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

const CSS = `
.hc-anim-pulse { animation: hc-pulse 2.4s ease-in-out infinite; }
.hc-anim-bob-up { animation: hc-bob-up 1.6s ease-in-out infinite; }
.hc-anim-bob-down { animation: hc-bob-down 1.6s ease-in-out infinite; }
.hc-anim-ripple { animation: hc-ripple 2.4s ease-out infinite; }
.hc-anim-fade-in { animation: hc-fade-in 0.4s ease-out both; }
.hc-anim-reveal { animation: hc-reveal 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
.hc-anim-pop { animation: hc-pop 1s ease-out both; }
.hc-anim-glow { animation: hc-glow 2.4s ease-in-out infinite; }
.hc-button { transition: transform 0.12s ease-out, opacity 0.2s, filter 0.12s; }
.hc-button.hc-pressed { transform: scale(0.93); filter: brightness(1.15); }
@keyframes hc-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
@keyframes hc-bob-up { 0%, 100% { transform: translateY(8%); } 50% { transform: translateY(-14%); } }
@keyframes hc-bob-down { 0%, 100% { transform: translateY(-8%); } 50% { transform: translateY(14%); } }
@keyframes hc-ripple {
  0% { transform: scale(0.55); opacity: 0.85; }
  100% { transform: scale(1.7); opacity: 0; }
}
@keyframes hc-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes hc-reveal {
  from { opacity: 0; transform: scaleY(0.2); }
  to { opacity: 1; transform: scaleY(1); }
}
@keyframes hc-pop {
  0% { opacity: 0; transform: scale(0.35); }
  18% { opacity: 1; transform: scale(1.06); }
  30% { transform: scale(1); }
  78% { opacity: 1; }
  100% { opacity: 0; transform: scale(0.85); }
}
@keyframes hc-glow { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.8; } }
@media (prefers-reduced-motion: reduce) {
  .hc-anim-pulse, .hc-anim-bob-up, .hc-anim-bob-down, .hc-anim-ripple, .hc-anim-glow {
    animation: none;
  }
}
`;

/** Adds the shared keyframes once per document. */
export const ensureStyles = (doc: Document = document): void => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
};

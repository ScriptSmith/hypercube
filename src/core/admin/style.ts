import { FONT, PALETTE, withAlpha } from "../ui";

const STYLE_ID = "hc-admin-style";

const P = PALETTE;
const SURFACE = "#121725";
const SURFACE_2 = "#19202f";
const SURFACE_3 = "#242e44";
const LINE = "#262e40";
const LINE_STRONG = "#39435a";
const OK = "#38d39f";
const BAD = "#ff8a80";
const HUB = P.players[0] ?? "#6fa4fc";

/**
 * Admin UI styles. Every size is in em of `--hca-font`, or derives from `--hca-target` (the
 * smallest touch target) and `--hca-key` (a PIN key), which the frame overlay sets in venue px
 * times unit and the /admin/ page sets in CSS px.
 */
const CSS = `
.hca{font-family:${FONT};font-size:var(--hca-font,16px);line-height:1.25;color:${P.foreground};
-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}
.hca *,.hca *::before,.hca *::after{box-sizing:border-box;}
.hca :where(button,input){font:inherit;color:inherit;margin:0;letter-spacing:0;}
.hca [hidden]{display:none !important;}
.hca-btn{display:inline-flex;align-items:center;justify-content:center;gap:0.4em;
min-height:var(--hca-target,44px);min-width:var(--hca-target,44px);padding:0 0.9em;
border:0.07em solid ${LINE_STRONG};border-radius:0.45em;background:${SURFACE_2};color:${P.foreground};
font-weight:700;cursor:pointer;touch-action:manipulation;white-space:nowrap;line-height:1.1;}
.hca-btn:disabled{opacity:0.38;cursor:default;}
.hca-btn:active:not(:disabled){background:${SURFACE_3};}
.hca-btn.is-primary{background:${P.accent};border-color:${P.accent};color:#1c1604;}
.hca-btn.is-danger{border-color:${withAlpha(P.danger, 0.65)};color:${BAD};}
.hca-btn.is-on{background:${withAlpha(P.accent, 0.16)};border-color:${P.accent};color:${P.accent};}
.hca-icon-btn{padding:0;}
.hca-btn .hca-ico{display:inline-flex;width:1.1em;height:1.1em;}
.hca-back .hca-ico{transform:rotate(-90deg);}

.hca-panel{display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;
background:${withAlpha("#0a0d16", 0.97)};border:0.08em solid ${LINE_STRONG};border-radius:0.7em;
box-shadow:0 0.6em 2.4em rgba(0,0,0,0.65);container:hca-panel / inline-size;}
.hca-head{flex:none;display:flex;align-items:center;gap:0.6em;padding:0.45em 0.5em 0.45em 0.9em;
border-bottom:0.06em solid ${LINE};}
.hca-title{font-weight:800;font-size:1.15em;}
.hca-summary{flex:1;min-width:0;color:${P.muted};font-size:0.82em;overflow:hidden;
text-overflow:ellipsis;white-space:nowrap;}
.hca-summary [data-tone=good]{color:${OK};}
.hca-summary [data-tone=bad]{color:${BAD};}
.hca-status{flex:none;padding:0.35em 0.9em;font-size:0.8em;color:${P.muted};
border-bottom:0.06em solid ${LINE};background:${withAlpha(P.accent, 0.06)};}
.hca-status[data-tone=good]{color:${OK};}
.hca-status[data-tone=bad]{color:${BAD};}
.hca-chips{flex:none;display:flex;gap:0.4em;padding:0.5em 0.6em;overflow-x:auto;overflow-y:hidden;
touch-action:pan-x;overscroll-behavior:contain;scrollbar-width:thin;border-bottom:0.06em solid ${LINE};}
.hca-chip{flex:none;min-height:calc(var(--hca-target,44px) * 0.85);padding:0 0.85em;border-radius:999px;
font-size:0.9em;}
.hca-list{flex:1;min-height:0;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;
padding:0 0.6em 0.7em;scrollbar-width:thin;}
.hca-zone{margin:0.75em 0.2em 0.1em;color:${P.accent};font-weight:800;font-size:0.82em;}
.hca-side{margin:0.45em 0.2em 0;color:${P.muted};font-weight:700;font-size:0.78em;}
.hca-empty{margin:1.2em 0.4em;color:${P.muted};font-size:0.9em;}
.hca-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 0.65em;align-items:center;
width:100%;min-height:var(--hca-target,44px);margin-top:0.35em;padding:0.4em 0.65em;
border:0.07em solid ${LINE};border-radius:0.5em;background:${SURFACE};text-align:left;cursor:pointer;
touch-action:pan-y;}
.hca-row.is-selected{border-color:${P.accent};background:#1c2233;}
.hca-check{display:flex;align-items:center;justify-content:center;width:1.35em;height:1.35em;
border:0.1em solid ${LINE_STRONG};border-radius:0.3em;color:#1c1604;}
.hca-check .hca-ico{width:0.95em;height:0.95em;}
.hca-row.is-selected .hca-check{background:${P.accent};border-color:${P.accent};}
.hca-row-main{min-width:0;}
.hca-row-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:0.15em 0.55em;}
.hca-label{font-weight:800;}
.hca-app{font-weight:600;font-size:0.9em;}
.hca-sub{color:${P.muted};font-size:0.8em;margin-top:0.1em;}
.hca-facts{display:flex;flex-wrap:wrap;gap:0.1em 0.75em;color:${P.muted};font-size:0.8em;margin-top:0.1em;}
.hca-facts [data-tone=bad],.hca-err{color:${BAD};}
.hca-facts [data-tone=good]{color:${OK};}
.hca-err{font-size:0.78em;margin-top:0.1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hca-tag{display:inline-block;padding:0.05em 0.4em;border-radius:0.3em;font-size:0.72em;font-weight:800;
line-height:1.2;vertical-align:0.1em;}
.hca-tag.is-hub{background:${HUB};color:${P.background};}
.hca-tag.is-warn{background:${P.danger};color:${P.background};}
.hca-tag.is-override{border:0.09em solid ${P.accent};color:${P.accent};}
.hca-tag.is-self{border:0.09em solid ${P.muted};color:${P.foreground};}
.hca-consoles{margin-top:0.9em;padding:0.5em 0.65em;border:0.07em dashed ${LINE_STRONG};border-radius:0.5em;
color:${P.muted};font-size:0.82em;}
.hca-consoles b{color:${P.foreground};}
.hca-foot{flex:none;display:flex;flex-direction:column;gap:0.45em;padding:0.5em 0.6em 0.6em;
border-top:0.06em solid ${LINE};background:${withAlpha(P.background, 0.6)};}
.hca-count{color:${P.muted};font-size:0.82em;}
.hca-count b{color:${P.foreground};}
.hca-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0.45em;}
.hca-body{display:flex;flex-direction:column;flex:1;min-height:0;}
/* Wide and short, as on a wall's reach band: actions move beside the list so it keeps the height. */
@container hca-panel (min-width: 52em){
.hca-body.is-list{display:grid;grid-template-columns:minmax(0,1fr) 19em;grid-template-rows:auto minmax(0,1fr);}
.hca-body.is-list .hca-chips{grid-column:1 / -1;}
.hca-body.is-list .hca-foot{border-top:0;border-left:0.06em solid ${LINE};overflow-y:auto;}
.hca-body.is-list .hca-actions{grid-template-columns:repeat(2,minmax(0,1fr));}
}
.hca-actions .hca-btn{padding:0.2em 0.5em;white-space:normal;text-align:center;}
.hca-confirm{display:flex;flex-wrap:wrap;align-items:center;gap:0.5em;}
.hca-confirm span{flex:1 1 8em;font-weight:700;}
.hca-sheet-head{flex:none;display:flex;align-items:center;gap:0.6em;padding:0.45em 0.6em;
border-bottom:0.06em solid ${LINE};}
.hca-sheet-title{font-weight:800;}
.hca-sheet-body{flex:1;min-height:0;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;
padding:0.4em 0.9em 0.8em;}
.hca-field{margin-top:0.7em;}
.hca-field-label{margin-bottom:0.3em;color:${P.muted};font-size:0.82em;font-weight:700;}
.hca-field-note{margin-top:0.25em;color:${P.muted};font-size:0.75em;}
.hca-choices{display:flex;flex-wrap:wrap;gap:0.4em;}
.hca-choices .hca-btn{padding:0 0.75em;font-weight:650;}
.hca-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(10em,1fr));gap:0.5em;
align-items:start;}
.hca-checkgroup{display:flex;flex-direction:column;gap:0.3em;}
.hca-checkitem.is-preset{margin-left:1.1em;min-height:calc(var(--hca-target,44px) * 0.85);font-size:0.9em;}
.hca-checkitem{justify-content:flex-start;gap:0.6em;padding:0 0.7em;font-weight:650;white-space:normal;text-align:left;}
.hca-checkitem.is-on .hca-check{background:${P.accent};border-color:${P.accent};}
.hca-stepper{display:inline-flex;align-items:center;gap:0.4em;}
.hca-stepper-value{min-width:3.2em;text-align:center;font-weight:800;font-variant-numeric:tabular-nums;}
.hca-input{width:100%;min-height:var(--hca-target,44px);padding:0.4em 0.6em;border:0.07em solid ${LINE_STRONG};
border-radius:0.45em;background:${P.background};color:${P.foreground};font:inherit;
-webkit-user-select:text;user-select:text;}
.hca-number{max-width:9em;}
.hca-input:focus{outline:none;border-color:${P.accent};}
.hca-input:disabled{opacity:0.7;}

.hca-logview{display:flex;flex-direction:column;flex:1;min-height:0;}
.hca-logbar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:0.4em 0.8em;
padding:0.45em 0.6em;border-bottom:0.06em solid ${LINE};}
.hca-logbar .hca-choices{flex:none;max-width:100%;flex-wrap:nowrap;overflow-x:auto;touch-action:pan-x;
scrollbar-width:thin;}
.hca-logbar .hca-logframes{flex:1 1 100%;}
.hca-logbar .hca-chip{min-height:calc(var(--hca-target,44px) * 0.8);}
.hca-level.is-on[data-level=log]{color:${P.foreground};border-color:${P.muted};background:${SURFACE_3};}
.hca-level.is-on[data-level=warn]{color:${P.accent};border-color:${P.accent};background:${withAlpha(P.accent, 0.14)};}
.hca-level.is-on[data-level=info]{color:${HUB};border-color:${HUB};background:${withAlpha(HUB, 0.14)};}
.hca-level.is-on[data-level=error]{color:${BAD};border-color:${BAD};background:${withAlpha(P.danger, 0.14)};}
.hca-level.is-on[data-level=uncaught]{color:${P.background};border-color:${P.danger};background:${P.danger};}
.hca-logs{flex:1;min-height:0;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;
padding:0.3em 0.6em 0.6em;font-size:0.8em;line-height:1.35;scrollbar-width:thin;
-webkit-user-select:text;user-select:text;}
.hca-log{padding:0.3em 0.1em;border-bottom:0.05em solid ${LINE};}
.hca-log-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 0.6em;font-size:0.85em;color:${P.muted};}
.hca-log-frame{color:${P.foreground};font-weight:700;}
.hca-log-lvl{font-weight:800;}
.hca-log-msg{white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;}
.hca-log[data-level=info] .hca-log-lvl{color:${HUB};}
.hca-log[data-level=warn] .hca-log-lvl,.hca-log[data-level=warn] .hca-log-msg{color:${P.accent};}
.hca-log[data-level=error] .hca-log-lvl,.hca-log[data-level=error] .hca-log-msg{color:${BAD};}
.hca-log[data-level=uncaught]{background:${withAlpha(P.danger, 0.12)};}
.hca-log[data-level=uncaught] .hca-log-lvl{padding:0 0.3em;border-radius:0.2em;background:${P.danger};color:${P.background};}
.hca-log[data-level=uncaught] .hca-log-msg{color:${BAD};}

.hca-pad{display:flex;flex-direction:column;gap:calc(var(--hca-key) * 0.1);width:max-content;
padding:calc(var(--hca-key) * 0.14);background:${withAlpha("#0a0d16", 0.97)};
border:calc(var(--hca-key) * 0.012) solid ${LINE_STRONG};border-radius:calc(var(--hca-key) * 0.18);
box-shadow:0 0.6em 2.4em rgba(0,0,0,0.65);}
.hca-pad-head{display:flex;align-items:center;justify-content:space-between;gap:0.6em;
font-size:calc(var(--hca-key) * 0.24);font-weight:800;}
.hca-pad-head .hca-btn{min-height:calc(var(--hca-key) * 0.62);min-width:calc(var(--hca-key) * 0.62);
font-size:calc(var(--hca-key) * 0.3);border-radius:calc(var(--hca-key) * 0.14);}
.hca-pad-dots{display:flex;justify-content:center;align-items:center;gap:calc(var(--hca-key) * 0.12);
height:calc(var(--hca-key) * 0.34);}
.hca-dot{width:calc(var(--hca-key) * 0.16);height:calc(var(--hca-key) * 0.16);border-radius:50%;
border:calc(var(--hca-key) * 0.025) solid ${P.muted};}
.hca-dot.is-on{background:${P.accent};border-color:${P.accent};}
.hca-pad-msg{min-height:1.3em;text-align:center;font-size:calc(var(--hca-key) * 0.17);color:${P.muted};}
.hca-pad-msg[data-tone=bad]{color:${BAD};}
.hca-pad-keys{display:grid;grid-template-columns:repeat(3,var(--hca-key));gap:calc(var(--hca-key) * 0.1);}
.hca-key{display:flex;align-items:center;justify-content:center;width:var(--hca-key);height:var(--hca-key);
border:calc(var(--hca-key) * 0.012) solid ${LINE_STRONG};border-radius:calc(var(--hca-key) * 0.2);
background:${SURFACE_2};color:${P.foreground};font:800 calc(var(--hca-key) * 0.4)/1 ${FONT};
cursor:pointer;touch-action:manipulation;font-variant-numeric:tabular-nums;}
.hca-key:active:not(:disabled){background:${SURFACE_3};}
.hca-key:disabled{opacity:0.35;cursor:default;}
.hca-key.is-go{background:${P.accent};border-color:${P.accent};color:#1c1604;}
.hca-key.is-quiet{background:transparent;}
.hca-key-icon{display:block;width:44%;height:44%;}
.hca-pad.is-wrong{animation:hca-shake 0.4s ease-out;}
@keyframes hca-shake{0%,100%{transform:translateX(0);}20%{transform:translateX(-3%);}
40%{transform:translateX(3%);}60%{transform:translateX(-2%);}80%{transform:translateX(1%);}}
@media (prefers-reduced-motion: reduce){.hca-pad.is-wrong{animation:none;}}
`;

export const ensureAdminStyles = (doc: Document = document): void => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
};

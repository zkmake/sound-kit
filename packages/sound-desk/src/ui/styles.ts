/** The desk's stylesheet, injected once. Palettes by `data-theme` on `.sdk`. */
const SOUND_DESK_STYLES = /* css */ `
/* Inside a dev-panel card the tokens come from three-meter's (\`--perf-*\`), so the zkmake panels
   match; on its own (in a host's tab) the same palette is the fallback. */
.sdk {
  --sdk-bg: var(--perf-bg, rgba(22, 24, 29, 0.92));
  --sdk-fg: var(--perf-fg, #e6e8eb);
  --sdk-dim: var(--perf-muted, #8b909a);
  --sdk-line: var(--perf-border, rgba(255, 255, 255, 0.12));
  --sdk-field: var(--perf-row, rgba(255, 255, 255, 0.04));
  --sdk-accent: var(--perf-accent, #60a5fa);
  --sdk-warn: var(--perf-warn, #f59e0b);
  --sdk-meter: #34d399;
  --sdk-hot: #f87171;
  box-sizing: border-box;
  color: var(--sdk-fg);
  font: 11px/1.35 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.sdk[data-theme="light"] {
  --sdk-bg: rgba(250, 250, 252, 0.94);
  --sdk-fg: #1a1c21;
  --sdk-dim: #6b7079;
  --sdk-line: rgba(0, 0, 0, 0.12);
  --sdk-field: rgba(0, 0, 0, 0.05);
  --sdk-accent: #2563eb;
  --sdk-warn: #b45309;
  --sdk-meter: #059669;
  --sdk-hot: #dc2626;
}
.sdk *, .sdk *::before, .sdk *::after { box-sizing: inherit; }
.sdk button, .sdk input { font: inherit; color: inherit; }

.sdk-panel { display: flex; flex-direction: column; gap: 6px; min-height: 0; padding: 8px; }
.perf-hud.sdk-frame { max-width: min(24rem, calc(100vw - 48px)); }
.perf-hud__card > .sdk-panel { width: 23rem; max-width: 100%; flex: 1; }
.perf-hud.sdk-compact .sdk-panel { display: none; }
.perf-hud.sdk-compact .perf-hud__brand { padding-bottom: 6px; }

.sdk-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--sdk-line); }
.sdk-tab {
  border: 0;
  background: transparent;
  padding: 4px 7px;
  color: var(--sdk-dim);
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.sdk-tab[aria-selected="true"] { color: var(--sdk-fg); border-bottom-color: var(--sdk-accent); }
.sdk-tab:focus-visible, .sdk-button:focus-visible { outline: 1px solid var(--sdk-accent); }
.sdk-tab .sdk-badge { margin-left: 4px; }
.sdk-body { display: flex; flex-direction: column; gap: 6px; min-height: 0; overflow: auto; max-height: 60vh; }

.sdk-strip {
  display: grid;
  grid-template-columns: 5.5em minmax(0, 1fr) 3.4em;
  grid-template-areas: "name meter db" "info level buttons";
  gap: 3px 6px;
  align-items: center;
  padding: 5px 6px;
  border-radius: 5px;
  background: var(--sdk-field);
}
.sdk-strip-name { grid-area: name; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.sdk-strip-info { grid-area: info; color: var(--sdk-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sdk-meter { grid-area: meter; position: relative; height: 7px; border-radius: 3px; background: var(--sdk-line); overflow: hidden; }
.sdk-meter-rms, .sdk-meter-peak { position: absolute; inset: 0 auto 0 0; width: 0; }
.sdk-meter-rms { background: var(--sdk-meter); }
.sdk-meter-peak { background: var(--sdk-meter); opacity: 0.35; }
.sdk-meter.sdk-hot .sdk-meter-peak, .sdk-meter.sdk-hot .sdk-meter-rms { background: var(--sdk-hot); }
.sdk-db { grid-area: db; text-align: right; font-variant-numeric: tabular-nums; color: var(--sdk-dim); }
.sdk-strip input[type="range"] { grid-area: level; width: 100%; min-width: 0; accent-color: var(--sdk-accent); margin: 0; }
.sdk-strip-buttons { grid-area: buttons; display: flex; gap: 2px; justify-content: flex-end; }

.sdk-button {
  border: 1px solid var(--sdk-line);
  background: transparent;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  white-space: nowrap;
}
.sdk-button:hover { background: var(--sdk-field); }
.sdk-button[aria-pressed="true"] { background: var(--sdk-accent); border-color: var(--sdk-accent); color: #fff; }
.sdk-strip-buttons .sdk-button { padding: 1px 5px; }

.sdk-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.sdk-dim { color: var(--sdk-dim); }
.sdk-warn { color: var(--sdk-warn); }
.sdk-badge {
  display: inline-block;
  min-width: 1.5em;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--sdk-field);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.sdk-badge.sdk-warn { background: var(--sdk-warn); color: #111; }

.sdk-spark { width: 100%; height: 44px; display: block; }
.sdk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.sdk-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  padding: 3px 2px;
  border-bottom: 1px solid var(--sdk-line);
}
.sdk-list li > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sdk-log li { grid-template-columns: 3.6em minmax(0, 1fr); }
.sdk-log .sdk-time { color: var(--sdk-dim); font-variant-numeric: tabular-nums; }
.sdk-log li[data-kind="play"] > :last-child, .sdk-log li[data-kind="end"] > :last-child { color: var(--sdk-dim); }
.sdk-log li[data-kind="warn"] > :last-child { color: var(--sdk-warn); }
.sdk-log li > :last-child { white-space: normal; }
.sdk-empty { color: var(--sdk-dim); padding: 6px 2px; }

.sdk-scape { display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 5px; background: var(--sdk-field); }
.sdk-scape-head { display: flex; justify-content: space-between; gap: 6px; }
.sdk-scape input[type="range"] { flex: 1; min-width: 0; accent-color: var(--sdk-accent); margin: 0; }
`;

const STYLE_ID = "zkmake-sound-desk-styles";

const injectStyles = (document: Document) => {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");

    style.id = STYLE_ID;
    style.textContent = SOUND_DESK_STYLES;
    document.head.append(style);
  }
};

export { injectStyles, SOUND_DESK_STYLES };

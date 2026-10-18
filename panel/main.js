"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/@openchamber/sdk/dist/ui/theme.js
  var TOKEN_VARS = [
    ["--oc-bg", "background"],
    ["--oc-elevated", "elevated"],
    ["--oc-fg", "foreground"],
    ["--oc-muted", "muted"],
    ["--oc-subtle", "subtle"],
    ["--oc-border", "border"],
    ["--oc-hover", "hover"],
    ["--oc-selection", "selection"],
    ["--oc-focus", "focus"],
    ["--oc-primary", "primary"],
    ["--oc-muted-surface", "mutedSurface"],
    ["--oc-elevated-fg", "elevatedForeground"],
    ["--oc-active", "active"],
    ["--oc-selection-fg", "selectionForeground"],
    ["--oc-primary-fg", "primaryForeground"],
    ["--oc-primary-text", "primaryText"],
    ["--oc-success-text", "successText"],
    ["--oc-warning-text", "warningText"],
    ["--oc-error-text", "errorText"],
    ["--oc-info-text", "infoText"],
    ["--oc-success", "success"],
    ["--oc-warning", "warning"],
    ["--oc-error", "error"],
    ["--oc-info", "info"],
    ["--oc-font", "font"],
    ["--oc-mono", "mono"],
    ["--oc-radius", "radius"],
    ["--surface-background", "background"],
    ["--surface-elevated", "elevated"],
    ["--surface-foreground", "foreground"],
    ["--surface-muted-foreground", "muted"],
    ["--surface-subtle", "subtle"],
    ["--interactive-border", "border"],
    ["--interactive-hover", "hover"],
    ["--interactive-selection", "selection"],
    ["--interactive-focus-ring", "focus"],
    ["--primary", "primary"],
    ["--surface-muted", "mutedSurface"],
    ["--surface-elevated-foreground", "elevatedForeground"],
    ["--interactive-active", "active"],
    ["--interactive-selection-foreground", "selectionForeground"],
    ["--primary-foreground", "primaryForeground"],
    ["--primary-text", "primaryText"],
    ["--success-text", "successText"],
    ["--warning-text", "warningText"],
    ["--error-text", "errorText"],
    ["--info-text", "infoText"],
    ["--status-success", "success"],
    ["--status-warning", "warning"],
    ["--status-error", "error"],
    ["--status-info", "info"],
    ["--font-sans", "font"],
    ["--font-mono", "mono"],
    ["--radius", "radius"]
  ];
  var SYNTAX_TOKEN_VARS = [
    ["--oc-syntax-keyword", "--syntax-keyword", "syntaxKeyword"],
    ["--oc-syntax-string", "--syntax-string", "syntaxString"],
    ["--oc-syntax-number", "--syntax-number", "syntaxNumber"],
    ["--oc-syntax-function", "--syntax-function", "syntaxFunction"],
    ["--oc-syntax-type", "--syntax-type", "syntaxType"],
    ["--oc-syntax-comment", "--syntax-comment", "syntaxComment"],
    ["--oc-syntax-variable", "--syntax-variable", "syntaxVariable"],
    ["--oc-syntax-operator", "--syntax-operator", "syntaxOperator"]
  ];
  var applyHostTheme = (theme, root) => {
    root.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root.style.setProperty(name, theme.tokens[key]);
    }
    for (const [alias, hostName, key] of SYNTAX_TOKEN_VARS) {
      const value = theme.tokens[key] ?? "";
      root.style.setProperty(alias, value);
      root.style.setProperty(hostName, value);
    }
    root.style.setProperty("font-family", theme.tokens.font);
    root.style.setProperty("font-size", "0.875rem");
    root.style.setProperty("line-height", "1.45");
    root.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx, root) => {
    applyHostTheme(ctx.theme, root);
    if (root.dataset) {
      root.dataset.ocSurface = ctx.surface;
      root.dataset.ocTheme = ctx.theme.mode;
    }
  };

  // node_modules/@openchamber/sdk/dist/scrollbar-style.js
  var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
  var GUEST_SCROLLBAR_CSS = `
:root {
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 40%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 65%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
  function installGuestScrollbarActivity(doc) {
    const root = doc.documentElement;
    if (root.hasAttribute("data-oc-scrollbar-activity"))
      return;
    root.setAttribute("data-oc-scrollbar-activity", "");
    const timers = /* @__PURE__ */ new WeakMap();
    doc.addEventListener("scroll", (event) => {
      const target = event.target === doc ? root : event.target;
      if (!(target instanceof Element))
        return;
      if (!target.hasAttribute("data-oc-scrolling"))
        target.setAttribute("data-oc-scrolling", "");
      const pending = timers.get(target);
      if (pending !== void 0)
        clearTimeout(pending);
      timers.set(target, setTimeout(() => {
        timers.delete(target);
        target.removeAttribute("data-oc-scrolling");
      }, 1e3));
    }, { capture: true, passive: true });
  }
  var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

  // node_modules/@openchamber/sdk/dist/ui/style.js
  var OC_ALIAS = {
    "surface-background": "bg",
    "surface-elevated": "elevated",
    "surface-elevated-foreground": "elevated-fg",
    "surface-foreground": "fg",
    "surface-muted-foreground": "muted",
    "surface-muted": "muted-surface",
    "surface-subtle": "subtle",
    "interactive-border": "border",
    "interactive-hover": "hover",
    "interactive-active": "active",
    "interactive-selection": "selection",
    "interactive-selection-foreground": "selection-fg",
    "interactive-focus-ring": "focus",
    "primary": "primary",
    "primary-foreground": "primary-fg",
    "primary-text": "primary-text",
    "success-text": "success-text",
    "warning-text": "warning-text",
    "error-text": "error-text",
    "info-text": "info-text",
    "status-success": "success",
    "status-warning": "warning",
    "status-error": "error",
    "status-info": "info",
    "font-sans": "font",
    "font-mono": "mono",
    "radius": "radius"
  };
  var v = (name, fallback) => `var(--${name}, var(--oc-${OC_ALIAS[name]}, ${fallback}))`;
  var bg = v("surface-background", "transparent");
  var elevated = v("surface-elevated", "transparent");
  var elevatedFg = v("surface-elevated-foreground", "inherit");
  var fg = v("surface-foreground", "inherit");
  var muted = v("surface-muted-foreground", "gray");
  var secondary = v("surface-muted", "transparent");
  var border = v("interactive-border", "currentColor");
  var hover = v("interactive-hover", "transparent");
  var active = v("interactive-active", "transparent");
  var selection = v("interactive-selection", "transparent");
  var selectionFg = v("interactive-selection-foreground", "inherit");
  var focus = v("interactive-focus-ring", "currentColor");
  var primary = v("primary", "currentColor");
  var primaryText = v("primary-text", "inherit");
  var errorText = v("error-text", "inherit");
  var font = v("font-sans", "inherit");
  var mono = v("font-mono", "monospace");
  var radius = v("radius", "9px");
  var mix = (color, pct, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  var focusRing = `box-shadow: 0 0 0 2px ${focus};`;
  var tone = (name) => {
    const color = v(`status-${name}`, "currentColor");
    return `
.oc-sdk[data-tone="${name}"], .oc-sdk [data-tone="${name}"] { --oc-sdk-tone: ${color}; --oc-sdk-tone-text: ${v(`${name}-text`, "inherit")}; }`;
  };
  var UI_CSS = `
${GUEST_SCROLLBAR_CSS}
.oc-sdk { box-sizing: border-box; color: ${fg}; font-family: ${font}; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }
.oc-sdk :focus-visible { outline: none; ${focusRing} }
.oc-sdk-mono { font-family: ${mono}; }
.oc-sdk-muted { color: ${muted}; }
${tone("success")}${tone("warning")}${tone("error")}${tone("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${primary}; --oc-sdk-tone-text: ${primaryText}; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid transparent; border-radius: ${radius}; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="sm"] { height: 32px; padding: 0 10px; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { height: 24px; padding: 0 8px; font-size: 0.75rem; border-radius: 6px; }
.oc-sdk-btn[data-variant="default"] { color: ${primaryText}; background: ${mix(primary, 10, bg)}; border-color: ${mix(primary, 12)}; }
.oc-sdk-btn[data-variant="default"]:hover { background: ${mix(primary, 16, bg)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${mix(primary, 22, bg)}; }
.oc-sdk-btn[data-variant="secondary"] { background: ${secondary}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="outline"] { background: ${elevated}; color: ${elevatedFg}; border-color: ${border}; }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${hover}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${active}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${v("status-error", "red")}; color: ${errorText}; background: ${mix("var(--oc-sdk-tone)", 7, bg)}; border-color: ${mix("var(--oc-sdk-tone)", 12)}; }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${mix("var(--oc-sdk-tone)", 9, bg)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${mix("var(--oc-sdk-tone)", 11, bg)}; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: 14px; height: 14px; }

.oc-sdk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; color: ${muted}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${errorText}; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: 36px; padding: 0 12px; border: 0; border-radius: ${radius}; background: ${elevated}; color: ${elevatedFg}; font-size: 0.875rem; line-height: 1.45; appearance: none; box-shadow: inset 0 0 0 1px ${mix(border, 60)}; transition: background 150ms ease-out, box-shadow 150ms ease-out; }
textarea.oc-sdk-input { height: auto; padding: 8px 12px; resize: vertical; }
.oc-sdk-input::placeholder { color: ${muted}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { box-shadow: inset 0 0 0 2px ${focus}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input { box-shadow: inset 0 0 0 1px ${v("status-error", "red")}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { box-shadow: inset 0 0 0 2px ${v("status-error", "red")}; }
.oc-sdk-input[data-mono="true"] { font-family: ${mono}; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: 34px; padding-right: 34px; }
.oc-sdk-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: ${muted}; pointer-events: none; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${primary}; }
.oc-sdk-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; color: ${muted}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }
.oc-sdk-search-clear:hover { background: ${hover}; color: ${fg}; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: 6px; width: 100%; min-width: 0; height: 32px; padding: 0 8px 0 10px; border: 1px solid ${border}; border-radius: 6px; background: ${elevated}; color: ${elevatedFg}; font-size: 0.8125rem; text-align: left; transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-value[data-empty="true"] { color: ${muted}; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; color: ${muted}; }
.oc-sdk-popup { --surface-foreground: ${elevatedFg}; position: fixed; z-index: 50; display: flex; flex-direction: column; gap: 2px; min-width: 160px; max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); overflow: auto; padding: 4px; border: 1px solid ${mix(border, 60)}; border-radius: 12px; background: ${elevated}; color: ${elevatedFg}; box-shadow: 0 8px 24px ${mix(fg, 12)}; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: 2px 2px 4px; }
.oc-sdk-popup-search .oc-sdk-input { height: 32px; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 8px; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option[data-active="true"] { background: ${hover}; }
.oc-sdk-option[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-option[data-destructive="true"] { color: ${errorText}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${mix(v("status-error", "red"), 10)}; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; color: ${muted}; }
.oc-sdk-option-check { flex: 0 0 auto; width: 12px; }
.oc-sdk-popup-empty { padding: 8px; font-size: 0.8125rem; color: ${muted}; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-top: 3px; border: 1px solid ${border}; border-radius: 4px; color: ${primary}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${mix(primary, 65, border)}; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: 36px; height: 20px; border-radius: 9999px; background: ${border}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 9999px; background: ${bg}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${primary}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(16px); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${focusRing} }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; color: ${muted}; }

.oc-sdk-tabs { display: inline-flex; gap: 2px; padding: 2px; border-radius: 10px; max-width: 100%; overflow: auto; }
.oc-sdk-tabs[data-track="true"] { background: ${mix(fg, 4)}; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; font-size: 0.8125rem; font-weight: 500; color: ${muted}; white-space: nowrap; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${fg}; }
.oc-sdk-tab[aria-selected="true"] { color: ${selectionFg}; background: ${selection}; border-color: ${border}; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; color: ${muted}; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 9999px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; background: ${hover}; color: ${muted}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${mix("var(--oc-sdk-tone)", 15)}; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 6px; text-align: left; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${hover}; }
.oc-sdk-row[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-row-lead { flex: 0 0 auto; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ${mono}; font-size: 0.75rem; color: ${muted}; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; color: ${muted}; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; color: ${muted}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { padding: 16px 8px; text-align: center; font-size: 0.8125rem; color: ${muted}; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px 16px; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; color: ${muted}; }
.oc-sdk-empty-action { margin-top: 12px; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: ${muted}; }
.oc-sdk-spinner-ring { width: 16px; height: 16px; border: 2px solid ${border}; border-top-color: ${primary}; border-radius: 9999px; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: 12px; height: 12px; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid ${mix("var(--oc-sdk-tone)", 40)}; border-radius: 8px; background: ${mix("var(--oc-sdk-tone)", 10)}; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { font-size: 0.8125rem; color: ${muted}; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: 8px; width: 100%; margin: 8px 0; font-size: 0.75rem; color: ${muted}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; background: ${mix(border, 40)}; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: 4px 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; color: ${muted}; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: 6px; border-radius: 9999px; background: ${border}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; border-radius: 9999px; background: var(--oc-sdk-tone, ${primary}); transform-origin: left; transition: transform 200ms ease-out; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text a { color: ${primaryText}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { display: block; max-width: 100%; margin: 8px 0; border-radius: 8px; border: 1px solid ${mix(border, 60)}; }
`;

  // node_modules/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;

  // node_modules/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;

  // node_modules/@openchamber/sdk/dist/shells.js
  var GUEST_SHELL_ID_MAX = 128;
  var GUEST_SHELL_OUTPUT_TAIL_MAX = 65536;

  // node_modules/@openchamber/sdk/dist/status-controls.js
  var GUEST_STATUS_CONTROLS_MAX = 4;
  var GUEST_STATUS_CONTROL_ID = /^[a-z][a-z0-9-]{0,39}$/;
  var GUEST_STATUS_CONTROL_LABEL_MAX = 60;
  var GUEST_STATUS_CONTROL_OPTIONS_MAX = 16;
  var GUEST_STATUS_CONTROL_VALUE_MAX = 80;
  var isControlObject = (value) => Object(value) === value && !Array.isArray(value);
  var hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
  var isLabel = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_LABEL_MAX;
  var isValue = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_VALUE_MAX;
  var isGuestStatusControls = (controls) => {
    if (!Array.isArray(controls) || controls.length > GUEST_STATUS_CONTROLS_MAX)
      return false;
    const ids = /* @__PURE__ */ new Set();
    for (const control of controls) {
      if (!isControlObject(control) || !GUEST_STATUS_CONTROL_ID.test(control.id) || !isLabel(control.label))
        return false;
      if (control.disabled !== void 0 && control.disabled !== true && control.disabled !== false)
        return false;
      if (ids.has(control.id))
        return false;
      ids.add(control.id);
      if (control.kind === "button") {
        if (!hasOnlyKeys(control, ["kind", "id", "label", "disabled"]))
          return false;
        continue;
      }
      if (control.kind !== "select" || !hasOnlyKeys(control, ["kind", "id", "label", "value", "options", "disabled"]))
        return false;
      if (!isValue(control.value) || !Array.isArray(control.options) || control.options.length < 1 || control.options.length > GUEST_STATUS_CONTROL_OPTIONS_MAX)
        return false;
      const values = /* @__PURE__ */ new Set();
      for (const option2 of control.options) {
        if (!isControlObject(option2) || !hasOnlyKeys(option2, ["value", "label"]) || !isValue(option2.value) || !isLabel(option2.label) || values.has(option2.value))
          return false;
        values.add(option2.value);
      }
      if (!values.has(control.value))
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/file-editor.js
  var GUEST_FILE_EDITOR_CONTENT_MAX = 2e7;
  var GUEST_FILE_EDITOR_VERSION_MAX = 256;
  var fileEditorPayloadSize = (value) => "bytes" in value ? value.bytes.byteLength : value.content.length;
  var sameFileEditorDocument = (left, right) => {
    if (left.path !== right.path || left.readOnly !== right.readOnly)
      return false;
    if (left.encoding === "text" || right.encoding === "text") {
      return left.encoding === "text" && right.encoding === "text" && left.content === right.content;
    }
    if (left.bytes.byteLength !== right.bytes.byteLength)
      return false;
    for (let index = 0; index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index])
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/popover.js
  var GUEST_POPOVER_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var GUEST_POPOVER_COORDINATE_MAX = 1e5;
  var GUEST_POPOVER_WIDTH_MIN = 160;
  var GUEST_POPOVER_WIDTH_MAX = 640;
  var GUEST_POPOVER_HEIGHT_MIN = 48;
  var GUEST_POPOVER_HEIGHT_MAX = 480;
  var GUEST_POPOVER_DATA_MAX = 16e3;
  var GUEST_POPOVER_DATA_DEPTH_MAX = 32;
  var GUEST_POPOVER_SIDES = ["left", "right", "top", "bottom"];
  var hasBoundedJsonTree = (value, depth = 0, budget = { remaining: GUEST_POPOVER_DATA_MAX }) => {
    if (--budget.remaining < 0 || depth >= GUEST_POPOVER_DATA_DEPTH_MAX)
      return false;
    if (value === null)
      return true;
    const children = Array.isArray(value) ? value : Object(value) === value ? Object.values(value) : [];
    for (const item of children) {
      if (!hasBoundedJsonTree(item, depth + 1, budget))
        return false;
    }
    return true;
  };
  var isFiniteJson = (value) => {
    if (value === null || value === true || value === false)
      return true;
    if (Array.isArray(value))
      return Object.keys(value).every((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) && value.every(isFiniteJson);
    if (Object(value) === value) {
      const prototype = Object.getPrototypeOf(value);
      return (prototype === null || prototype === Object.prototype) && Object.values(value).every(isFiniteJson);
    }
    return String(value) === value || Number.isFinite(value);
  };
  var isGuestPopoverRequest = (request) => {
    try {
      if (String(request.id) !== request.id || !GUEST_POPOVER_ID.test(request.id) || !Number.isFinite(request.anchor.x) || Math.abs(request.anchor.x) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.y) || Math.abs(request.anchor.y) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.width) || !Number.isFinite(request.anchor.height) || request.anchor.width <= 0 || request.anchor.height <= 0 || request.anchor.width > GUEST_POPOVER_COORDINATE_MAX || request.anchor.height > GUEST_POPOVER_COORDINATE_MAX || !Number.isInteger(request.width) || request.width < GUEST_POPOVER_WIDTH_MIN || request.width > GUEST_POPOVER_WIDTH_MAX || !Number.isInteger(request.height) || request.height < GUEST_POPOVER_HEIGHT_MIN || request.height > GUEST_POPOVER_HEIGHT_MAX || request.side !== void 0 && !GUEST_POPOVER_SIDES.includes(request.side) || request.focus !== void 0 && request.focus !== true && request.focus !== false || !hasBoundedJsonTree(request.data) || !isFiniteJson(request.data))
        return false;
      return JSON.stringify(request.data).length <= GUEST_POPOVER_DATA_MAX;
    } catch {
      return false;
    }
  };

  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32e3;
  var GUEST_COMPOSE_TEXT_MAX = 16e3;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2e3;
  var GUEST_ATTACH_TEXT_MAX = 16e3;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16e3;
  var GUEST_REQUEST_PATH_MAX = 2e3;
  var GUEST_REQUEST_TIMEOUT_MS = 2e4;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2e6;
  var GUEST_GENERATE_PROMPT_MAX = 64e3;
  var GUEST_GENERATE_SYSTEM_MAX = 8e3;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4e3;
  var GUEST_GENERATE_TIMEOUT_MS = 9e4;
  var GUEST_BADGE_MAX = 999;
  var GUEST_FRAME_HEIGHT_MAX = 1e4;
  var GUEST_RESOLVE_ERROR_MAX = 500;
  var HOST_REQUEST_ERROR_CODES = [
    "HOST_UNAVAILABLE",
    "HOST_TIMEOUT",
    "HOST_REJECTED",
    "DISCONNECTED",
    "DISABLED",
    "BAD_PATH",
    "NO_INTEGRATION",
    "NO_SERVICE",
    "SERVICE_FAILED",
    "NO_SESSION",
    "SESSION_BUSY",
    "NOT_GRANTED",
    "NO_DIRECTORY",
    "NOT_FOUND",
    "FILE_TOO_LARGE",
    "DENIED",
    "NO_MODEL",
    "MODEL_FAILED",
    "UNSUPPORTED"
  ];
  var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
  var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === void 0)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title || id,
      url,
      kind
    };
    if (text) {
      next.text = text;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head && base) {
        next.branches = { head, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var clampFrameHeight = (height) => {
    if (!Number.isFinite(height))
      return 0;
    return Math.min(GUEST_FRAME_HEIGHT_MAX, Math.max(0, Math.ceil(height)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\0") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = /* @__PURE__ */ new Set([
    "workspace",
    "shells",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action",
    "status-control-event",
    "popover-closed",
    "file-open",
    "file-snapshot",
    "file-saved"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : void 0)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // node_modules/@openchamber/sdk/dist/host.js
  var isKeyEvent = (event) => "key" in event && "metaKey" in event && "ctrlKey" in event;
  var isSaveShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
  var HostRequestError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code");
      this.name = "HostRequestError";
      this.code = code;
    }
  };
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var deviceStorageScope = (options) => {
    if (options === void 0)
      return void 0;
    if (Object(options) !== options || Array.isArray(options) || options.scope !== void 0 && options.scope !== "instance" && options.scope !== "device") {
      throw new HostRequestError("HOST_REJECTED", 'Storage scope must be "instance" or "device".');
    }
    return options.scope === "device" ? "device" : void 0;
  };
  var nextId = (n) => {
    n.value += 1;
    return `oc-${n.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = /* @__PURE__ */ new Set();
    const directoryListeners = /* @__PURE__ */ new Set();
    const sessionListeners = /* @__PURE__ */ new Set();
    const lifecycleListeners = /* @__PURE__ */ new Set();
    const connectionListeners = /* @__PURE__ */ new Set();
    const settingsListeners = /* @__PURE__ */ new Set();
    const itemListeners = /* @__PURE__ */ new Set();
    const statusControlListeners = /* @__PURE__ */ new Set();
    const popoverClosedListeners = /* @__PURE__ */ new Set();
    let resolveHandler = null;
    let actionHandler = null;
    const fileOpenListeners = /* @__PURE__ */ new Set();
    const fileSavedListeners = /* @__PURE__ */ new Set();
    let fileSnapshotHandler = null;
    let lastFile = null;
    let saveShortcutInstalled = false;
    const pending = /* @__PURE__ */ new Map();
    const workspaceListeners = /* @__PURE__ */ new Map();
    const shellsListeners = /* @__PURE__ */ new Map();
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    let popoverPointerActive = false;
    let popoverFocusActive = false;
    let popoverActivityReported = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "shells") {
        const listener = shellsListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "status-control-event") {
        emit(statusControlListeners, message.payload);
        return;
      }
      if (message.type === "popover-closed") {
        emit(popoverClosedListeners, message.payload);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "file-open") {
        const next = message.payload;
        if (lastFile && sameFileEditorDocument(lastFile, next))
          return;
        lastFile = next;
        emit(fileOpenListeners, message.payload);
        return;
      }
      if (message.type === "file-saved") {
        emit(fileSavedListeners, message.payload.version);
        return;
      }
      if (message.type === "file-snapshot") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "file-snapshot-result",
              id: message.id,
              payload
            });
        };
        const fail = (text) => answer({ error: (text.trim() || "Could not read the edited file.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        const handler = fileSnapshotHandler;
        if (!handler) {
          fail("This extension does not edit files.");
          return;
        }
        Promise.resolve().then(() => handler(message.payload.purpose)).then((snapshot) => {
          if (fileEditorPayloadSize(snapshot) > GUEST_FILE_EDITOR_CONTENT_MAX) {
            fail(`The file is over ${GUEST_FILE_EDITOR_CONTENT_MAX} ${"bytes" in snapshot ? "bytes" : "characters"}.`);
            return;
          }
          if (snapshot.version.length > GUEST_FILE_EDITOR_VERSION_MAX) {
            fail(`The snapshot version is over ${GUEST_FILE_EDITOR_VERSION_MAX} characters.`);
            return;
          }
          answer({ snapshot: "bytes" in snapshot ? { bytes: snapshot.bytes, version: snapshot.version } : { content: snapshot.content, version: snapshot.version } });
        }, (error) => fail(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => void 0);
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const notify = (message) => {
      if (!disposed && target.parent !== target)
        post(message);
    };
    const requestFileSave = () => notify({ ...envelope, type: "file-save" });
    const onSaveShortcut = (event) => {
      if (!isKeyEvent(event) || !isSaveShortcut(event))
        return;
      event.preventDefault();
      requestFileSave();
    };
    const onPopoverEscape = (event) => {
      if (!isKeyEvent(event) || event.key !== "Escape" || lastReady?.surface !== "popover" || !lastReady.popover)
        return;
      event.preventDefault();
      void closePopover(lastReady.popover.id, "escape").catch(() => void 0);
    };
    const reportPopoverActivity = () => {
      const popover = lastReady?.surface === "popover" ? lastReady.popover : void 0;
      if (!popover)
        return;
      const active2 = popoverPointerActive || popoverFocusActive;
      if (popoverActivityReported === active2)
        return;
      popoverActivityReported = active2;
      void setPopoverAnchorActive(popover.id, active2).catch(() => void 0);
    };
    const onPopoverPointerOver = () => {
      if (lastReady?.surface !== "popover" || popoverPointerActive)
        return;
      popoverPointerActive = true;
      reportPopoverActivity();
    };
    const onPopoverPointerOut = (event) => {
      if (lastReady?.surface !== "popover" || event.relatedTarget !== null || !popoverPointerActive)
        return;
      popoverPointerActive = false;
      reportPopoverActivity();
    };
    const onPopoverFocus = () => {
      if (lastReady?.surface !== "popover" || popoverFocusActive)
        return;
      popoverFocusActive = true;
      reportPopoverActivity();
    };
    const onPopoverBlur = () => {
      if (lastReady?.surface !== "popover" || !popoverFocusActive)
        return;
      popoverFocusActive = false;
      reportPopoverActivity();
    };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const subscribeShells = async (scope, listener) => {
      if (scope.kind === "session")
        requireIdentity(scope.sessionId);
      if (scope.kind === "project")
        requireIdentity(scope.projectId);
      const subscriptionId = nextId(ids);
      shellsListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "shells-subscribe", id: nextId(ids), payload: { subscriptionId, scope } });
      } catch (error) {
        shellsListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!shellsListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      if (payload.scope === "device" && lastReady?.features?.deviceStorage !== true) {
        throw new HostRequestError("UNSUPPORTED", "This host does not support device storage.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    const closePopover = (id, reason) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-close", id: nextId(ids), payload: reason ? { id, reason } : { id } });
    const setPopoverAnchorActive = (id, active2) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-anchor", id: nextId(ids), payload: { id, active: active2 } });
    target.addEventListener("keydown", onPopoverEscape, true);
    target.addEventListener("pointerover", onPopoverPointerOver);
    target.addEventListener("pointermove", onPopoverPointerOver);
    target.addEventListener("pointerout", onPopoverPointerOut);
    target.addEventListener("focus", onPopoverFocus);
    target.addEventListener("blur", onPopoverBlur);
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId) => {
        const result = await readWorkspace({ kind: "worktrees", projectId });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId) => {
        const result = await readWorkspace({ kind: "sessions", projectId });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId, listener) => subscribeWorkspace({ kind: "worktrees", projectId }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId, listener) => subscribeWorkspace({ kind: "sessions", projectId }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      onRunningShells: (scope, listener) => subscribeShells(scope, listener),
      readShellOutput: async (shellId, options2) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const cursor = options2?.cursor;
        if (cursor !== void 0 && (!Number.isInteger(cursor) || cursor < 0)) {
          throw new HostRequestError("HOST_REJECTED", "Shell output cursor must be a non-negative integer.");
        }
        const tailBytes = options2?.tailBytes;
        if (tailBytes !== void 0 && (!Number.isInteger(tailBytes) || tailBytes < 1 || tailBytes > GUEST_SHELL_OUTPUT_TAIL_MAX)) {
          throw new HostRequestError("HOST_REJECTED", `Shell output tailBytes must be an integer between 1 and ${GUEST_SHELL_OUTPUT_TAIL_MAX}.`);
        }
        const result = await send({ ...envelope, type: "shell-output", id: nextId(ids), payload: { shellId, cursor, tailBytes } });
        const output = result;
        if (!output || typeof output.output !== "string" || !Number.isFinite(output.cursor)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return shell output.");
        }
        return output;
      },
      stopShell: async (shellId) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const result = await send({ ...envelope, type: "shell-stop", id: nextId(ids), payload: { shellId } });
        if (result?.stopped !== true)
          throw new HostRequestError("HOST_REJECTED", "Host did not stop the shell.");
        return { stopped: true };
      },
      openSession: async (sessionId) => {
        requireIdentity(sessionId);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId } });
      },
      storage: {
        get: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "get", key };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          return result.op === "get" && result.found ? result.value : void 0;
        },
        set: async (key, value, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "set", key, value };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        delete: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "delete", key };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        keys: async (options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "keys" };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onStatusControl: (listener) => {
        statusControlListeners.add(listener);
        return () => {
          statusControlListeners.delete(listener);
        };
      },
      onPopoverClosed: (listener) => {
        popoverClosedListeners.add(listener);
        return () => {
          popoverClosedListeners.delete(listener);
        };
      },
      setStatusControls: (controls) => {
        if (lastReady?.features?.statusControls !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support status controls."));
        }
        if (!isGuestStatusControls(controls)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Status controls must have unique bounded ids and valid selected options."));
        }
        return request({ ...envelope, type: "status-controls", id: nextId(ids), payload: { controls } });
      },
      openPopover: (payload) => {
        if (lastReady?.features?.popovers !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers."));
        }
        if (!isGuestPopoverRequest(payload)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Popover requests need bounded geometry and JSON data."));
        }
        return request({ ...envelope, type: "popover-open", id: nextId(ids), payload });
      },
      closePopover,
      setPopoverAnchorActive,
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openCommit: (sha) => isGuestCommitSha(sha) ? request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-commit",
        id: nextId(ids),
        payload: { sha }
      }) : Promise.reject(new HostRequestError("HOST_REJECTED", "Commit id must be 7 to 64 hex characters.")),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== void 0)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== void 0)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== void 0)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 18e4);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== void 0 && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === void 0 ? void 0 : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== void 0 && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== void 0)
          payload.system = system;
        if (maxOutputTokens !== void 0)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      setHeight: (height) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "resize",
        id: nextId(ids),
        payload: { height: clampFrameHeight(height) }
      }),
      onFileOpen: (listener) => {
        fileOpenListeners.add(listener);
        if (!saveShortcutInstalled) {
          saveShortcutInstalled = true;
          target.addEventListener("keydown", onSaveShortcut, true);
        }
        if (lastFile)
          listener(lastFile);
        return () => {
          fileOpenListeners.delete(listener);
        };
      },
      onFileSnapshot: (handler) => {
        fileSnapshotHandler = handler;
        return () => {
          if (fileSnapshotHandler === handler)
            fileSnapshotHandler = null;
        };
      },
      onFileSaved: (listener) => {
        fileSavedListeners.add(listener);
        return () => {
          fileSavedListeners.delete(listener);
        };
      },
      reportFileChange: (change) => notify({ ...envelope, type: "file-change", payload: { dirty: change.dirty, edited: change.edited } }),
      requestFileSave,
      reportFileUnsupported: () => notify({ ...envelope, type: "file-unsupported" }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        for (const subscriptionId of shellsListeners.keys()) {
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        shellsListeners.clear();
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        fileSnapshotHandler = null;
        fileOpenListeners.clear();
        fileSavedListeners.clear();
        if (saveShortcutInstalled)
          target.removeEventListener("keydown", onSaveShortcut, true);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("keydown", onPopoverEscape, true);
        target.removeEventListener("pointerover", onPopoverPointerOver);
        target.removeEventListener("pointermove", onPopoverPointerOver);
        target.removeEventListener("pointerout", onPopoverPointerOut);
        target.removeEventListener("focus", onPopoverFocus);
        target.removeEventListener("blur", onPopoverBlur);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
        statusControlListeners.clear();
        popoverClosedListeners.clear();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/service-providers.js
  var BROWSER_CONTROL_ACTIONS = [
    "browser.open",
    "browser.snapshot",
    "browser.click",
    "browser.type",
    "browser.scroll",
    "browser.back",
    "browser.forward",
    "browser.inspect",
    "browser.capture",
    "browser.resize"
  ];
  var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
  var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);

  // node_modules/@openchamber/sdk/dist/service-surface.js
  var SURFACE_CONTROLLERS = ["none", "agent", "user"];
  var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

  // panel/api.ts
  var host = connectHost();
  var ServiceUnavailable = class extends Error {
    constructor(message) {
      super(message);
      this.name = "ServiceUnavailable";
    }
  };
  function describe(error) {
    if (error instanceof HostRequestError) return `${error.code}: ${error.message}`;
    if (error instanceof Error) return error.message;
    return String(error);
  }
  async function callService(path, query, method = "GET", body) {
    let result;
    try {
      result = await host.serviceRequest({ method, path, query, body });
    } catch (error) {
      throw new ServiceUnavailable(describe(error));
    }
    if (result.status !== 200) {
      let detail = `HTTP ${result.status}`;
      try {
        const parsed = JSON.parse(result.body);
        if (parsed.error) detail = parsed.error;
      } catch {
      }
      throw new ServiceUnavailable(detail);
    }
    return JSON.parse(result.body);
  }
  var PICK_ACK_LABEL_MAX = 80;
  function getPicks(since, waitMs) {
    return callService("/picks", { since: String(since), wait: String(waitMs) });
  }
  function ackPicks(seq, label) {
    return callService(
      "/picks/ack",
      void 0,
      "POST",
      JSON.stringify({ seq, label: label.slice(0, PICK_ACK_LABEL_MAX) })
    );
  }
  function pickAckLabel(entry) {
    const raw = entry.kind === "screen" ? `screen ${entry.screen}` : entry.selector || entry.tag || `screen ${entry.screen}`;
    return raw.slice(0, PICK_ACK_LABEL_MAX);
  }
  function batchAckLabel(delivered, last) {
    if (last.kind !== "element" || !last.batch) return pickAckLabel(last);
    const count = delivered.filter((entry) => entry.kind === "element" && entry.batch === last.batch).length;
    return count > 1 ? `${count} elements` : pickAckLabel(last);
  }
  var WORKSPACE_MISSING_CODE = "WORKSPACE_MISSING";
  var OPENING_STATUS = "Starting dev server\u2026";
  function openWorkspace(input) {
    const payload = { dir: input.dir };
    if (input.screen !== void 0) payload.screen = input.screen;
    if (input.focus !== void 0) payload.focus = input.focus;
    return callService("/open", void 0, "POST", JSON.stringify(payload));
  }
  function closeLive() {
    return callService("/close", void 0, "POST");
  }
  function stopDevServer(dir) {
    return callService("/server/stop", void 0, "POST", JSON.stringify({ dir }));
  }
  function stopWorkspaceServer(dir) {
    return callService("/server/stop", void 0, "POST", JSON.stringify({ dir }));
  }
  function startDevServer(dir, url) {
    return callService("/server/start", void 0, "POST", JSON.stringify({ dir, url }));
  }
  function getServerStatus(dir) {
    return callService("/server/status", { dir });
  }
  function getState() {
    return callService("/state");
  }
  function setMode(mode) {
    return callService("/mode", void 0, "POST", JSON.stringify({ mode }));
  }
  function focusLive() {
    return callService("/focus", void 0, "POST");
  }
  function postAgentStatus(busy, label) {
    const body = { busy };
    if (label !== void 0) body.label = label.slice(0, 60);
    return callService("/agent-status", void 0, "POST", JSON.stringify(body));
  }
  function syncScreens(dir) {
    return callService("/screens/sync", void 0, "POST", JSON.stringify({ dir }));
  }
  function getConfig(dir) {
    return callService("/config", { dir });
  }
  function validateReferencePath(dir, path) {
    return callService("/reference", void 0, "POST", JSON.stringify({ dir, path }));
  }
  function workspaceServerRunning(row) {
    return Boolean(row.server?.recorded && row.server.up);
  }
  function renameWorkspace(dir, name) {
    return callService("/workspaces/rename", void 0, "POST", JSON.stringify({ dir, name }));
  }
  function getSettings() {
    return callService("/settings");
  }
  function putSettings(workspaceRoot) {
    return callService("/settings", void 0, "PUT", JSON.stringify({ workspaceRoot }));
  }
  function isDesignsSettings(value) {
    return Boolean(value && typeof value === "object" && typeof value.workspaceRoot === "string" && value.workspaceRoot !== "");
  }
  function copyPath(dir) {
    return host.writeClipboard(dir);
  }
  function middleTruncatePath(path, max = 36) {
    if (path.length <= max) return path;
    const head = Math.max(1, Math.floor((max - 1) * 0.4));
    const tail = max - 1 - head;
    return `${path.slice(0, head)}\u2026${path.slice(path.length - tail)}`;
  }
  function getWorkspaces() {
    return callService("/workspaces");
  }
  function exportJob(dir, formats) {
    const body = formats && formats.length > 0 ? { dir, formats } : { dir };
    return callService("/export", void 0, "POST", JSON.stringify(body));
  }
  function exportStatus(dir, job) {
    return callService("/export/status", { dir, job });
  }
  function critiqueWorkspace(dir) {
    return callService("/critique", void 0, "POST", JSON.stringify({ dir }));
  }
  function scaffoldProject(dir, spec) {
    return callService("/scaffold", void 0, "POST", JSON.stringify({ dir, ...spec, async: true }));
  }
  function getScaffoldStatus(job, dir) {
    return callService("/scaffold/status", { job, dir });
  }
  function scaffoldProgressText(job) {
    const seconds = Math.max(0, Math.round((job.elapsedMs ?? 0) / 1e3));
    if (job.state === "installing") return `Setting up the canvas\u2026 installing (${seconds} s)`;
    if (job.state === "booting") return `Setting up the canvas\u2026 starting the dev server (${seconds} s)`;
    if (job.state === "done") return `Canvas workspace is ready (${seconds} s) \u2014 opening the canvas.`;
    return `Canvas setup failed${job.error ? `: ${job.error}` : "."}`;
  }
  function normalizeDirPath(dir) {
    const text = String(dir).trim().replace(/\\/g, "/");
    const drive = /^([a-zA-Z]):\/(.)/.exec(text);
    const base = drive ? `${drive[1].toLowerCase()}:${text.slice(2)}` : text;
    let end = base.length;
    while (end > 1 && base[end - 1] === "/") end -= 1;
    return base.slice(0, end).replace(/\/+$/, () => base.slice(0, end) === "/" ? "/" : "");
  }
  function sameDirPath(a, b) {
    return normalizeDirPath(a) === normalizeDirPath(b);
  }
  function pathContains(root, dir) {
    const rb = normalizeDirPath(root);
    const rd = normalizeDirPath(dir);
    return rd === rb || rd.startsWith(`${rb}/`);
  }
  function wsSessionIdFromKey(key) {
    const prefix = "ws/";
    return key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
  }
  function isWorkspaceRecord(value) {
    return Boolean(
      value && typeof value === "object" && typeof value.dir === "string" && value.dir.trim() !== ""
    );
  }
  function allProjectsFromSnapshot(snapshot) {
    if (snapshot.state !== "ready") return [];
    return snapshot.projects.map((project) => ({ id: project.id, name: project.name, directory: project.directory }));
  }
  function resolveCanvasTarget(input) {
    const ws = input.workspace;
    if (ws && ws.dir.trim() !== "") {
      const registered = input.projects.find((candidate) => sameDirPath(candidate.directory, ws.dir) || pathContains(candidate.directory, ws.dir));
      const base = { kind: "workspace", dir: ws.dir, name: ws.name || ws.dir };
      return registered ? { ...base, projectId: registered.id } : base;
    }
    return { kind: "new", brief: input.brief.trim() };
  }
  var WORKSPACE_SLUG_LIMIT = 40;
  function canvasSlug(brief, seed) {
    const words = brief.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 4).join("-");
    const segments = seed.toLowerCase().replace(/[^a-z0-9-]+/g, "-").split("-").filter(Boolean);
    const tail = (segments[segments.length - 1] ?? seed.toLowerCase().replace(/[^a-z0-9]+/g, "")).slice(0, 8);
    const base = words ? `${words}-${tail}` : `canvas-${tail}`;
    const cleaned = base.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    return (cleaned || "canvas").slice(0, WORKSPACE_SLUG_LIMIT);
  }
  function uniqueCanvasSlug(brief, seed, existingDirs) {
    const taken = new Set(existingDirs.map((dir) => normalizeDirPath(dir).split("/").pop() ?? ""));
    const first = canvasSlug(brief, seed);
    if (!taken.has(first)) return first;
    for (let i = 2; ; i += 1) {
      const candidate = `${first.slice(0, Math.max(1, WORKSPACE_SLUG_LIMIT - String(i).length - 1))}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  function joinWorkspaceDir(root, slug) {
    const trimmed = root.replace(/[\\/]+$/, "");
    const sep = trimmed.includes("\\") && !trimmed.startsWith("/") ? "\\" : "/";
    return `${trimmed}${sep}${slug}`;
  }
  function isAbsoluteFilePath(file) {
    return file.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(file) || file.startsWith("\\\\");
  }
  function workspaceFilePath(dir, file) {
    const trimmedFile = file.trim();
    if (isAbsoluteFilePath(trimmedFile)) return trimmedFile;
    const root = dir.replace(/[\\/]+$/, "");
    const sep = root.includes("\\") && !root.startsWith("/") ? "\\" : "/";
    const relative = trimmedFile.replace(/^\.?[\\/]+/, "").split(/[\\/]+/).filter(Boolean).join(sep);
    return `${root}${sep}${relative}`;
  }
  function joinWorkspaceSessions(rows, wsSessionMap2) {
    return rows.map((row) => ({ ...row, sessionId: wsSessionMap2.get(normalizeDirPath(row.dir)) ?? null }));
  }
  function workspaceMeta(row) {
    const url = row.url?.trim();
    return url ? url : row.dir;
  }
  function isModeChipData(data) {
    if (!data || typeof data !== "object") return false;
    const mode = data.mode;
    return Boolean(mode && typeof mode === "object" && mode.on === true);
  }
  function sessionShowsDesignMode(session) {
    return Array.isArray(session.items) && session.items.some((item) => isModeChipData(item.data));
  }
  var PICK_HINT = "Click an element in the canvas, then Reference in chat.";
  function pickHintActive(state2) {
    return state2.windowOpen;
  }
  function formatOpenStatus(result) {
    if (result.ok) return result.started ? "Dev server started \xB7 window open" : "Window open";
    return result.error ?? "Could not open the window";
  }
  function shouldStopDevServer(input) {
    return input.startedByUs && !input.busy && input.otherActiveDesignSessions === 0;
  }
  function countOtherActiveDesignSessions(sessions, currentSessionId, markerSessionIds) {
    let count = 0;
    for (const session of sessions) {
      if (currentSessionId && session.id === currentSessionId) continue;
      const isDesign = markerSessionIds.has(session.id) || sessionShowsDesignMode(session);
      if (isDesign && session.activity !== "idle") count += 1;
    }
    return count;
  }
  var DESIGN_READY_BADGE = "Canvas ready";
  var NO_CONFIG_BADGE = "No dev server yet";
  var NO_DESIGN_WORK_MESSAGE = "No canvas workspaces yet \u2014 /canvas creates one.";
  var NO_WORKSPACE_MESSAGE = "No canvas workspace yet \u2014 Start creates one.";
  function canvasSessionStatus(state2) {
    if (!state2.modeOn) return "Design Mode is off \u2014 turn it on to open the canvas";
    if (!state2.workspaceDir) return "Design session \xB7 workspace being created\u2026";
    return state2.wsReady ? `Design session \xB7 workspace ${state2.workspaceDir}` : `Design session \xB7 ${state2.workspaceDir} (no .design-studio.json url yet)`;
  }
  function shouldToastRegistryError(lastToastKey, registryError) {
    const message = typeof registryError === "string" && registryError.trim() !== "" ? registryError.trim() : null;
    if (message === null) return { toast: false, key: null };
    if (message === lastToastKey) return { toast: false, key: lastToastKey };
    return { toast: true, key: message };
  }
  function registryErrorToastMessage(registryError) {
    return `The canvas screens registry is broken \u2014 ${registryError}`;
  }
  var NO_PROJECT_URL_MESSAGE = "No .design-studio.json url for this workspace \u2014 add one, or turn the dev server on first";
  var ATTACH_NEEDS_URL = "References need an http(s) url from .design-studio.json.";
  function projectReady(config) {
    return Boolean(config?.url?.trim());
  }
  function isLoopbackUrl(raw) {
    try {
      const hostname = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      return hostname === "localhost" || hostname === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
    } catch {
      return false;
    }
  }
  var PICK_STYLE_KEYS = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "color",
    "backgroundColor",
    "borderTopWidth",
    "borderStyle",
    "borderColor",
    "borderRadius",
    "padding",
    "margin",
    "display",
    "gap",
    "width",
    "height"
  ];
  function localTimeOf(day) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(day.getHours())}:${pad(day.getMinutes())}:${pad(day.getSeconds())}`;
  }
  function referenceText(pick, url, pickedAt, screen, location = []) {
    const styles = PICK_STYLE_KEYS.filter((key) => pick.styles[key] && pick.styles[key] !== "normal" && pick.styles[key] !== "none").map((key) => `  ${key}: ${pick.styles[key]};`).join("\n");
    return [
      "Reference from Design Canvas",
      ...pickedAt ? [`Picked at ${localTimeOf(pickedAt)}`] : [],
      ...screen ? [`Screen: ${screen.id}`, `Screen URL: ${screen.url}`] : [],
      `URL: ${url}`,
      ...location,
      `Selector: ${pick.selector}`,
      `Tag: ${pick.tag}${pick.classes ? `  Classes: ${pick.classes}` : ""}`,
      pick.text ? `Text: ${JSON.stringify(pick.text)}` : "Text: (empty)",
      "Current styles:",
      styles || "  (none of note)",
      "Markup:",
      "```html",
      pick.outerHTML,
      "```"
    ].join("\n");
  }
  function screenReferenceText(entry, pickedAt, location = []) {
    return [
      "Reference from Design Canvas",
      ...pickedAt ? [`Picked at ${localTimeOf(pickedAt)}`] : [],
      `Screen: ${entry.screen} (${entry.width}\xD7${entry.height}) \u2014 ${entry.file}`,
      `Screen URL: ${entry.screenUrl}`,
      ...location
    ].join("\n");
  }

  // shared/harness-text.ts
  var CRAFT_RULES = {
    layout: [
      "- Space on an 8pt grid: every gap, padding, size and offset is a multiple of 8 at each breakpoint's endpoints (4 only inside dense controls).",
      "- Lay content on a column grid per breakpoint (4 columns phone, 8 tablet, 12 desktop) with fixed gutters, and align every block to it.",
      "- Build hierarchy by position, then size, then weight, then color; give each view one primary action.",
      "- Group by proximity before borders; do not box every section in a card.",
      "- Cap text measure near 68ch and content width near 1200px; let backgrounds bleed, never lines of text.",
      "- Reuse one component per job: the same button, input, card and list row everywhere, with the same height, radius and padding.",
      "- When phones are a target, design the phone layout first and reflow up."
    ].join("\n"),
    content: [
      "- Use real, plausible content from the brief or the user's project (names, prices, dates, copy); never lorem ipsum.",
      "- Write copy that says what happens: verbs on buttons, plain nouns on headings, no marketing filler.",
      "- Stress the layout with the content: one long name, one missing value, one large number.",
      "- Give every control an accessible name; icon-only buttons carry aria-label.",
      "- Write the words for empty, loading and error states, including the next action."
    ].join("\n"),
    typography: [
      "- Build one modular scale (base \xD71.2, or \xD71.25 for airier layouts) and take every size from it.",
      "- Ship 6\u20138 sizes total; do not invent a new size per section.",
      "- Pair a distinct display face with a readable body face, and keep each role to one family.",
      "- Set body line-height near 1.5 and tighten only display text.",
      "- Keep body measure to roughly 45\u201375 characters per line.",
      "- Let position, size, weight and color carry hierarchy, in that order, before you reach for decoration.",
      "- Use tabular numerals for tables, prices, timers and any aligned data.",
      "- Limit to two or three weights per family; resist faux-bold."
    ].join("\n"),
    color: [
      "- Keep 70\u201390% of the palette neutral; let structure do the work.",
      "- Spend one accent on 5\u201310% of a screen, used at most twice as a fill or emphasis.",
      "- Reserve semantic colors (success/warn/danger/info) for 0\u20135% and only for meaning.",
      "- Guarantee contrast of 4.5:1 for body text and 3:1 for large text and UI edges.",
      "- Never encode meaning in color alone; add an icon, label or weight change.",
      "- Derive surfaces from one neutral ramp rather than stacking unrelated grays.",
      "- Test the palette in both light and dark before committing.",
      "- Choose an accent that fits the direction; do not fall back to framework default."
    ].join("\n"),
    "anti-slop": [
      "- Do not use the default indigo/violet accent that every starter kit ships.",
      "- Do not build hero sections from two-stop gradient backgrounds.",
      "- Do not use emoji as icons; draw or pick a coherent icon set.",
      "- Do not invent metrics, testimonials or logos the brief did not supply.",
      '- Do not pad copy with filler like "lorem ipsum" or "seamless, powerful solution".',
      "- Avoid the generic card with a colored left border and a shadow.",
      "- Avoid stock centered-everything layouts with no alignment logic.",
      "- If a pattern feels like a template default, redesign it deliberately."
    ].join("\n"),
    states: [
      "- Render every data surface in all five states: Loading, Empty, Error, Populated, Edge.",
      "- Give Loading a skeleton or spinner, and a fallback message after ~15s.",
      "- Make Empty states explain what belongs here and how to fill it.",
      "- Make Error states say what failed and offer the next action.",
      "- Cover Edge cases: one item, many items, very long strings, missing fields.",
      "- Give forms explicit Untouched, Dirty and Submitted-pending states.",
      "- Disable or show progress on submit, then confirm success or surface failure.",
      "- Validate on blur, not on every keystroke."
    ].join("\n"),
    motion: [
      "- Animate only to explain change, never as decoration.",
      "- Keep UI transitions under 300ms; longer motion needs a reason.",
      "- Make motion interruptible: a new input cancels the running one.",
      "- Honor prefers-reduced-motion and provide a static equivalent.",
      "- Move along a clear path; avoid bounce and overshoot on functional elements.",
      "- Stagger lists slightly, but never block reading on animation completion."
    ].join("\n"),
    accessibility: [
      "- Give every interactive element a visible :focus-visible treatment.",
      "- Label every input; a placeholder is not a label.",
      "- Provide a complete keyboard path, with no focus traps.",
      "- Use semantic elements first and ARIA only to fill the gaps.",
      "- Keep contrast at AA: 4.5:1 body, 3:1 large text and UI.",
      "- Give images meaningful alt text, and decorative images an empty alt.",
      "- Announce dynamic updates through a live region."
    ].join("\n"),
    "laws-of-ux": [
      "- Hick: cut the number of simultaneous choices; group or defer the rest.",
      "- Miller: keep working sets near 7\xB12, and lean toward ~4 for menus.",
      "- Fitts: make primary targets large and near where the pointer already is.",
      "- von Restorff: style the one thing that must stand out; mute the rest.",
      "- Peak-End: invest in the strongest moment and the final step.",
      "- Tesler: absorb complexity in the product so the user faces less of it."
    ].join("\n"),
    responsive: [
      "- Define named breakpoints (e.g. sm/md/lg/xl) and reuse them everywhere.",
      "- Reflow, do not merely shrink: change column counts and stacking per breakpoint.",
      "- Test the awkward widths, not just the presets: 320, 375, 768, 1024, 1440.",
      "- Keep tap targets at least 44px on touch layouts.",
      "- Clamp fluid type and spacing so extremes stay legible.",
      "- Never let horizontal scroll appear on a normal content page."
    ].join("\n"),
    verification: [
      "- Never call a change done until you have seen it render at every breakpoint: mobile 390, desktop 1280, wide 2048.",
      "- Also check the awkward widths where relevant: 320, 375, 1024, 1440.",
      "- Horizontal scroll on a normal content page is a defect, not a style choice.",
      "- Fix the cheapest deterministic failure first; never restyle to hide an overflow or a contrast error.",
      "- Use only tokens from tokens.css / DESIGN.md; a hardcoded color or spacing value is a defect.",
      "- Keep tap targets at least 24px (44px on touch), headings in order, every control labelled.",
      "- Done means the gates pass at every breakpoint \u2014 not that it looks right at one width."
    ].join("\n")
  };
  var ALL_CRAFT_RULE_IDS = [
    "layout",
    "typography",
    "color",
    "content",
    "anti-slop",
    "states",
    "motion",
    "accessibility",
    "laws-of-ux",
    "responsive",
    "verification"
  ];
  function defaultCraft(ids) {
    const chosen = ids && ids.length > 0 ? ids : ALL_CRAFT_RULE_IDS;
    return chosen.map((id) => `### ${id}
${CRAFT_RULES[id]}`).join("\n\n");
  }
  var VERIFY_PROTOCOL = [
    "Before editing, state the change's acceptance criteria in one line.",
    "After each edit verify in this order (cheap/deterministic first): overflow \u2192 design tokens \u2192 accessibility \u2192 semantics \u2192 layout. Use the browser tool: `browser.capture` / `browser.open` returns a `verification` block covering every viewport (mobile, tablet, desktop, wide) with each gate's status.",
    "Fix every P0 before starting a new gate tier; re-run the same gates after a fix.",
    "Budget: at most 5 fix/verify iterations OR 10 minutes, whichever comes first. Then stop and report.",
    "Never mark the work done while any P0 remains. Report the gate table and state the breakpoints you checked.",
    "Oscillation: if a finding you already fixed reappears, or a gate flips across two iterations, STOP and hand back with both states. Do not keep looping.",
    "The 0\u201310 critique is advisory only; never treat it as pass/fail and never optimise for it."
  ].join("\n");
  var IDENTITY = "You are an expert designer with senior product-design judgement. HTML is your tool, not your medium: the medium is the intent, the system and the craft of the page.";
  var DESIGN_AUTHORITY = [
    "Design-system precedence, highest first: (1) what the user says in this chat; (2) the design-system preset chosen for this canvas;",
    "(3) the user's project design system (its tokens, theme config, AGENTS.md and design docs); (4) the workspace DESIGN.md and tokens.css (when present),",
    'once confirmed; (5) the visual direction. A file marked "Status: placeholder" holds scaffold defaults, not decisions.',
    "Inside the chosen system do not invent colors, spacing or type values; a hardcoded value that a token already covers is a defect."
  ].join(" ");
  var DESIGN_WORKSPACE_NOTE = [
    "The canvas workspace is a Vite multi-page app: every screen is a real HTML page (root-level *.html files) listed in screens.json.",
    'To add a screen: write `<id>.html` at the workspace root, add { "id", "file", "title", "width", "height" } to screens.json (ids [a-z0-9-], unique; width/height 200\u20138192, prefer the size presets), and, when app.js has a DS_SCREENS array, add the same entry there.',
    "Keep index.html as a meta-refresh redirect to home.html so `vite build` keeps a valid default entry.",
    'Link between screens with plain <a href="other.html"> links; never create screens outside the workspace root.',
    "The chat session does NOT run inside the workspace: use the workspace absolute path in every file write, edit and bash call.",
    "The chat's working directory, when it is a project, is the user's app: read it for design context and never write design files there.",
    "Reuse what the workspace already has (BRIEF.md, DESIGN.md, tokens.css, .design-studio.json); do not scaffold over existing work."
  ].join(" ");
  var CANVAS_PROTOCOL = [
    'Screens are artboards on one shared canvas. The workspace-root screens.json registry maps each screen to its own .html file and its natural size: { "version": 1, "screens": [ { "id", "file", "title", "width", "height" } ] }.',
    "Add or change a screen: write its HTML file, then update its screens.json entry (ids ^[a-z0-9][a-z0-9-]{0,30}$, sizes 200\u20138192, file relative *.html inside the workspace). Rewriting one screen never rewrites siblings.",
    "Positions are not design content: never write x/y into screens.json; the canvas stores them in .design-studio/view.json and the user arranges artboards by hand.",
    'Variants = side-by-side artboards. "Two directions", "options", "alternatives" mean 2\u20133 complete sibling screens (ids like home-a, home-b), each its own file + entry, each at the same size unless the brief says otherwise. Never stack variants inside one file, never hide alternates behind toggles.',
    // D8 amendment 2026-10-18: desktop default artboard is 1440x900; 1280x800 remains the laptop preset. Gate widths in CRAFT_RULES.verification are test widths and stay 1280.
    'Responsive = one artboard per real size. Presets: 390\xD7844 phone \xB7 768\xD71024 tablet \xB7 1440\xD7900 desktop (default) \xB7 1280\xD7800 laptop \xB7 1080\xD71080 social post \xB7 794\xD71123 A4 print at 96 dpi. "Make it responsive" means three artboards of the same screen (phone, tablet, desktop), ids like home-phone, home-tablet, home. Artboards are viewports: content taller than the artboard scrolls inside it \u2014 never grow the artboard height to fit the page. Other sizes are allowed within 200\u20138192.'
  ].join("\n");
  var CANVAS_PROTOCOL_CHIP = [
    'Screens are artboards on one shared canvas. The workspace-root screens.json registry maps each screen to its own .html file and its natural size: { "version": 1, "screens": [ { "id", "file", "title", "width", "height" } ] }.',
    "Add or change a screen: write its HTML file, then update its screens.json entry (ids ^[a-z0-9][a-z0-9-]{0,30}$, sizes 200\u20138192, file relative *.html inside the workspace). Rewriting one screen never rewrites siblings.",
    '"Two directions", "options", "alternatives" mean 2\u20133 complete sibling screens, each its own file + entry \u2014 never stacked in one file, never hidden behind toggles.',
    // D8 amendment 2026-10-18: desktop default artboard is 1440x900; 1280x800 remains the laptop preset. Gate widths in CRAFT_RULES.verification are test widths and stay 1280.
    'Size presets: 390\xD7844 phone \xB7 768\xD71024 tablet \xB7 1440\xD7900 desktop (default) \xB7 1280\xD7800 laptop \xB7 1080\xD71080 social post \xB7 794\xD71123 A4 print at 96 dpi. "Make it responsive" means three artboards of the same screen (phone, tablet, desktop). Artboards are viewports; content scrolls inside them. Other sizes are allowed within 200\u20138192.'
  ].join("\n");
  var VERIFY_MANDATE = [
    "Verify at every stage, not only at the end: after each edit, before showing work, and before calling",
    "anything done. Run the cheap deterministic gates first and never claim success without having seen the",
    "page render at the breakpoints the protocol names."
  ].join(" ");
  function firstReplyContract(questions) {
    const lines = [
      "## Your first reply",
      `- What you found in the user's project (2\u20134 lines, files cited), or "no project context".`,
      questions ? '- Your numbered questions with bold defaults. If the brief already settles devices, audience, key screens, content and look, give an "Assumptions" list instead and build.' : '- Your "Assumptions" list, then the build.'
    ];
    if (questions) lines.push("- If you asked questions, stop there: no screen writes in the same reply.");
    return lines.join("\n");
  }
  function workingAgreementChip(opts = {}) {
    const questions = opts.questions !== false;
    const options = opts.options ?? (questions ? "ask" : 1);
    const optionsLine = options === "ask" ? questions ? "When the user wants a choice, offer 2\u20133 distinct directions as sibling artboards and let them pick." : "Options: one direction \u2014 the Assumptions list names it." : options === 1 ? "Options: the user wants one direction." : `Options: the user wants ${options} directions \u2014 build the key screen of each as sibling artboards and let them pick.`;
    return [
      "Working agreement: read the user's project first (AGENTS.md, design docs, theme/tokens, breakpoints) and reuse its palette, type, radii and components.",
      questions ? "For new work, if devices, audience, key screens, content or look are open, ask 3\u20136 numbered questions with a bold recommended default each, then wait." : "The user turned questions off: skip clarifying questions; open with a short Assumptions list (devices, audience, key screens, look), then build.",
      questions ? "If the project is responsive, say so and ask which sizes to design (phone 390\xD7844, tablet 768\xD71024, desktop 1440\xD7900)." : "State the device sizes you chose (phone 390\xD7844, tablet 768\xD71024, desktop 1440\xD7900).",
      optionsLine,
      questions ? "With no project design system, propose a palette + type pairing and confirm it before building." : "With no project design system, put a palette + type pairing in the Assumptions list and build.",
      questions ? "Picks are direct edits: do them; ask only if ambiguous." : "Picks are direct edits: do them.",
      `Never claim a file changed unless your edit call on it succeeded; name the absolute workspace path when you ${questions ? "ask or " : ""}report.`,
      "At most one approval round before the first screen: questions, palette and the direction choice go in the same message.",
      "Record the agreed devices, look source and chosen option in the workspace BRIEF.md (create it if missing); a failed read means the file is absent."
    ].join(" ");
  }
  var WORKING_AGREEMENT_CHIP = workingAgreementChip();
  function workingAgreementCompact(opts = {}) {
    const ambiguity = opts.questions !== false ? "ask one question only if it is ambiguous" : "state your reading in one line and make the change";
    return `Each pick is a direct edit of the screen file it names: make it, verify it, and ${ambiguity}. Never claim an edit you did not make.`;
  }
  var WORKING_AGREEMENT_COMPACT = workingAgreementCompact();

  // panel/craft.ts
  var DIRECTIONS = {
    editorial: {
      id: "editorial",
      name: "Editorial",
      when: "long-form reading, blogs, articles, magazines, brand storytelling with a voice",
      displayFont: 'a high-contrast serif (e.g. "Fraunces", "Playfair Display")',
      bodyFont: 'a companion serif or a quiet grotesque (e.g. "Source Serif 4", "Inter")',
      tokens: {
        "--bg": "#faf7f2",
        "--surface": "#f2ece3",
        "--fg": "#1c1a17",
        "--muted": "#6b6459",
        "--border": "#ded5c8",
        "--accent": "#a3341f"
      },
      posture: [
        "Lead with type, not chrome: generous measure, real hierarchy.",
        "Use an eyebrow label above headlines and a drop cap or standfirst where it helps.",
        "Let off-white paper tones and one warm accent carry the mood.",
        "Favor asymmetry and pull quotes over centered bland blocks.",
        "Keep rules, borders and shadows restrained; let whitespace separate."
      ]
    },
    "modern-minimal": {
      id: "modern-minimal",
      name: "Modern Minimal",
      when: "SaaS products, marketing and landing pages, developer tools with a crisp brand",
      displayFont: 'a tight geometric sans (e.g. "Inter Tight", "Geist")',
      bodyFont: 'the same family at body weight (e.g. "Inter")',
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#f7f8f8",
        "--fg": "#0a0a0a",
        "--muted": "#6b7280",
        "--border": "#e5e7eb",
        "--accent": "#2563eb"
      },
      posture: [
        "Precise spacing on a consistent 4/8px rhythm.",
        "One crisp accent; everything else neutral and calm.",
        "Thin borders and subtle shadows, never heavy elevation.",
        "Strong typographic hierarchy with restrained color.",
        "Confident use of whitespace over decorative filler."
      ]
    },
    human: {
      id: "human",
      name: "Human",
      when: "consumer apps, kids and wellness, community, marketplaces and social products",
      displayFont: 'a friendly rounded face (e.g. "Nunito", "Baloo 2")',
      bodyFont: 'a warm readable sans (e.g. "Nunito Sans", "Inter")',
      tokens: {
        "--bg": "#fffdf9",
        "--surface": "#fff3e6",
        "--fg": "#2b2320",
        "--muted": "#8a7d74",
        "--border": "#f0e2d3",
        "--accent": "#ff6b52"
      },
      posture: [
        "Rounded corners and roomy padding throughout.",
        "Warm, saturated accent used sparingly for delight.",
        "Illustration and friendly microcopy over corporate tone.",
        "Clear, encouraging states for every step.",
        "Comfortable, touch-first tap targets."
      ]
    },
    "tech-utility": {
      id: "tech-utility",
      name: "Tech Utility",
      when: "dashboards, admin consoles, data and API tools, developer and ops products",
      displayFont: 'a neutral UI sans (e.g. "Inter", "IBM Plex Sans")',
      bodyFont: 'the same family, with a mono for code (e.g. "JetBrains Mono")',
      tokens: {
        "--bg": "#0e1116",
        "--surface": "#161b22",
        "--fg": "#e6edf3",
        "--muted": "#8b949e",
        "--border": "#30363d",
        "--accent": "#2f81f7"
      },
      posture: [
        "Density is a feature: compact rows, aligned columns, tabular numerals.",
        "Status color carries meaning and nothing else.",
        "Monospace for identifiers, values and code.",
        "Dark-first surfaces with clear separators, no decorative flourish.",
        "Every control reachable and legible at scale."
      ]
    }
  };

  // shared/design-systems.ts
  var DESIGN_SYSTEMS = [
    {
      id: "apple",
      name: "Apple",
      category: "Media & Consumer",
      description: "Consumer electronics. Premium white space, SF Pro, cinematic imagery.",
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#f5f5f7",
        "--surface-warm": "#fbfbfd",
        "--fg": "#1d1d1f",
        "--fg-2": "#424245",
        "--muted": "#6e6e73",
        "--meta": "#86868b",
        "--border": "#d2d2d7",
        "--border-soft": "#e8e8ed",
        "--accent": "#0071e3",
        "--accent-on": "#ffffff",
        "--accent-hover": "#0077ed",
        "--accent-active": "#0066cc",
        "--success": "#16a34a",
        "--warn": "#eab308",
        "--danger": "#dc2626",
        "--font-display": '"SF Pro Display", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif',
        "--font-body": '"SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif',
        "--font-mono": '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "17px",
        "--text-lg": "21px",
        "--text-xl": "28px",
        "--text-2xl": "40px",
        "--text-3xl": "56px",
        "--text-4xl": "80px",
        "--leading-body": "1.47",
        "--leading-tight": "1.05",
        "--tracking-display": "-0.015em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "100px",
        "--section-y-tablet": "64px",
        "--section-y-phone": "40px",
        "--radius-sm": "8px",
        "--radius-md": "12px",
        "--radius-lg": "18px",
        "--radius-pill": "980px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 12px 32px rgba(0, 0, 0, 0.08)",
        "--focus-ring": "0 0 0 4px color-mix(in oklab, var(--accent), transparent 65%)",
        "--motion-fast": "150ms",
        "--motion-base": "220ms",
        "--ease-standard": "cubic-bezier(0.28, 0, 0.22, 1)",
        "--container-max": "1024px",
        "--container-gutter-desktop": "22px",
        "--container-gutter-tablet": "18px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Apple\n\n> Category: Media & Consumer\n> Consumer electronics. Premium white space, SF Pro, cinematic imagery.\n\n## 1. Visual Theme & Atmosphere\n\nApple's web language is a precision editorial system that alternates between gallery-like calm and retail-density information blocks. The visual tone stays restrained: broad neutral canvases, quiet chrome, and product imagery given almost all of the expressive weight. The interface is engineered to disappear so hardware, materials, and finish options become the narrative foreground.\n\nAcross the five analyzed pages, the rhythm is consistent but not monolithic. Marketing surfaces (homepage and Environment) use cinematic black-and-light chaptering, while commerce surfaces (Store and Shop flows) introduce tighter spacing, more utility controls, and denser card stacks without breaking the core brand grammar. The result is one system with two gears: showcase mode and transaction mode."
    },
    {
      id: "linear-app",
      name: "Linear",
      category: "Productivity & SaaS",
      description: "Project management. Ultra-minimal, precise, purple accent.",
      tokens: {
        "--bg": "#08090a",
        "--surface": "#191a1b",
        "--surface-warm": "var(--surface)",
        "--fg": "#f7f8f8",
        "--fg-2": "#d0d6e0",
        "--muted": "#8a8f98",
        "--meta": "#62666d",
        "--border": "rgba(255, 255, 255, 0.08)",
        "--border-soft": "rgba(255, 255, 255, 0.05)",
        "--accent": "#5e6ad2",
        "--accent-on": "#ffffff",
        "--accent-hover": "#828fff",
        "--accent-active": "#4752c4",
        "--success": "#27a644",
        "--warn": "#eab308",
        "--danger": "#dc2626",
        "--font-display": '"Inter Variable", "Inter", "SF Pro Display", -apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
        "--font-body": '"Inter Variable", "Inter", "SF Pro Display", -apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
        "--font-mono": '"Berkeley Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "24px",
        "--text-2xl": "32px",
        "--text-3xl": "48px",
        "--text-4xl": "72px",
        "--leading-body": "1.5",
        "--leading-tight": "1.00",
        "--tracking-display": "-0.022em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "80px",
        "--section-y-tablet": "48px",
        "--section-y-phone": "32px",
        "--radius-sm": "6px",
        "--radius-md": "8px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "rgba(0, 0, 0, 0.4) 0px 2px 4px, 0 0 0 1px rgba(255, 255, 255, 0.05)",
        "--focus-ring": "0 0 0 2px color-mix(in oklab, var(--accent), transparent 30%), 0 4px 12px rgba(0, 0, 0, 0.1)",
        "--motion-fast": "150ms",
        "--motion-base": "200ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1200px",
        "--container-gutter-desktop": "24px",
        "--container-gutter-tablet": "16px",
        "--container-gutter-phone": "12px"
      },
      designMd: "# Design System Inspired by Linear\n\n> Category: Productivity & SaaS\n> Project management. Ultra-minimal, precise, purple accent.\n\n## 1. Visual Theme & Atmosphere\n\nLinear's website is a masterclass in dark-mode-first product design \u2014 a near-black canvas (`#08090a`) where content emerges from darkness like starlight. The overall impression is one of extreme precision engineering: every element exists in a carefully calibrated hierarchy of luminance, from barely-visible borders (`rgba(255,255,255,0.05)`) to soft, luminous text (`#f7f8f8`). This is not a dark theme applied to a light design \u2014 it is darkness as the native medium, where information density is managed through subtle gradations of white opacity rather than color variation."
    },
    {
      id: "stripe",
      name: "Stripe",
      category: "Fintech & Crypto",
      description: "Payment infrastructure. Signature purple gradients, weight-300 elegance.",
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#ffffff",
        "--surface-warm": "#f6f9fc",
        "--fg": "#061b31",
        "--fg-2": "#273951",
        "--muted": "#64748d",
        "--meta": "var(--muted)",
        "--border": "#e5edf5",
        "--border-soft": "var(--border)",
        "--accent": "#533afd",
        "--accent-on": "#ffffff",
        "--accent-hover": "#4434d4",
        "--accent-active": "#2e2b8c",
        "--success": "#15be53",
        "--warn": "#9b6829",
        "--danger": "#ea2261",
        "--font-display": '"sohne-var", "S\xF6hne", "Sohne", "SF Pro Display", -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", Arial, sans-serif',
        "--font-body": '"sohne-var", "S\xF6hne", "Sohne", "SF Pro Display", -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", Arial, sans-serif',
        "--font-mono": '"SourceCodePro", "Source Code Pro", ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "22px",
        "--text-2xl": "32px",
        "--text-3xl": "48px",
        "--text-4xl": "56px",
        "--leading-body": "1.40",
        "--leading-tight": "1.10",
        "--tracking-display": "-0.02em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "64px",
        "--section-y-phone": "40px",
        "--radius-sm": "4px",
        "--radius-md": "6px",
        "--radius-lg": "8px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "rgba(50, 50, 93, 0.25) 0px 30px 45px -30px, rgba(0, 0, 0, 0.10) 0px 18px 36px -18px",
        "--focus-ring": "0 0 0 2px var(--accent), 0 0 0 5px color-mix(in oklab, var(--accent), transparent 75%)",
        "--motion-fast": "150ms",
        "--motion-base": "200ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1080px",
        "--container-gutter-desktop": "32px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Stripe\n\n> Category: Fintech & Crypto\n> Payment infrastructure. Signature purple gradients, weight-300 elegance.\n\n## 1. Visual Theme & Atmosphere\n\nStripe's website is the gold standard of fintech design -- a system that manages to feel simultaneously technical and luxurious, precise and warm. The page opens on a clean white canvas (`#ffffff`) with deep navy headings (`#061b31`) and a signature purple (`#533afd`) that functions as both brand anchor and interactive accent. This isn't the cold, clinical purple of enterprise software; it's a rich, saturated violet that reads as confident and premium. The overall impression is of a financial institution redesigned by a world-class type foundry."
    },
    {
      id: "vercel",
      name: "Vercel",
      category: "Developer Tools",
      description: "Frontend deployment. Black and white precision, Geist font.",
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#ffffff",
        "--surface-warm": "var(--surface)",
        "--fg": "#171717",
        "--fg-2": "#4d4d4d",
        "--muted": "#666666",
        "--meta": "#808080",
        "--border": "rgba(0, 0, 0, 0.08)",
        "--border-soft": "rgba(0, 0, 0, 0.04)",
        "--accent": "#0070f3",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#16a34a",
        "--warn": "#eab308",
        "--danger": "#dc2626",
        "--font-display": '"Geist", "Geist Sans", -apple-system, "Segoe UI", Arial, sans-serif',
        "--font-body": '"Geist", "Geist Sans", -apple-system, "Segoe UI", Arial, sans-serif',
        "--font-mono": '"Geist Mono", ui-monospace, "SF Mono", "Roboto Mono", Menlo, Monaco, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "20px",
        "--text-xl": "24px",
        "--text-2xl": "32px",
        "--text-3xl": "40px",
        "--text-4xl": "48px",
        "--leading-body": "1.5",
        "--leading-tight": "1.1",
        "--tracking-display": "-0.05em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "64px",
        "--section-y-phone": "48px",
        "--radius-sm": "6px",
        "--radius-md": "8px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 2px rgba(0, 0, 0, 0.04), 0 8px 8px -8px rgba(0, 0, 0, 0.04), 0 0 0 1px #fafafa",
        "--focus-ring": "0 0 0 2px var(--accent)",
        "--motion-fast": "150ms",
        "--motion-base": "200ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1200px",
        "--container-gutter-desktop": "24px",
        "--container-gutter-tablet": "16px",
        "--container-gutter-phone": "12px"
      },
      designMd: "# Design System Inspired by Vercel\n\n> Category: Developer Tools\n> Frontend deployment. Black and white precision, Geist font.\n\n## 1. Visual Theme & Atmosphere\n\nVercel's website is the visual thesis of developer infrastructure made invisible \u2014 a design system so restrained it borders on philosophical. The page is overwhelmingly white (`#ffffff`) with near-black (`#171717`) text, creating a gallery-like emptiness where every element earns its pixel. This isn't minimalism as decoration; it's minimalism as engineering principle. The Geist design system treats the interface like a compiler treats code \u2014 every unnecessary token is stripped away until only structure remains."
    },
    {
      id: "notion",
      name: "Notion",
      category: "Productivity & SaaS",
      description: "All-in-one workspace. Warm minimalism, serif headings, soft surfaces.",
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#f6f5f4",
        "--surface-warm": "var(--surface)",
        "--fg": "rgba(0, 0, 0, 0.95)",
        "--fg-2": "#31302e",
        "--muted": "#615d59",
        "--meta": "#a39e98",
        "--border": "rgba(0, 0, 0, 0.1)",
        "--border-soft": "rgba(0, 0, 0, 0.06)",
        "--accent": "#0075de",
        "--accent-on": "#ffffff",
        "--accent-hover": "#005bab",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#1aae39",
        "--warn": "#dd5b00",
        "--danger": "#dc2626",
        "--font-display": '"NotionInter", "Inter", -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
        "--font-body": '"NotionInter", "Inter", -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
        "--font-mono": 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "20px",
        "--text-xl": "26px",
        "--text-2xl": "40px",
        "--text-3xl": "48px",
        "--text-4xl": "64px",
        "--leading-body": "1.5",
        "--leading-tight": "1.00",
        "--tracking-display": "-0.033em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "80px",
        "--section-y-tablet": "48px",
        "--section-y-phone": "32px",
        "--radius-sm": "4px",
        "--radius-md": "8px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "rgba(0, 0, 0, 0.04) 0px 4px 18px, rgba(0, 0, 0, 0.027) 0px 2px 7.85px, rgba(0, 0, 0, 0.02) 0px 0.8px 2.93px, rgba(0, 0, 0, 0.01) 0px 0.175px 1.04px",
        "--focus-ring": "0 0 0 3px rgba(9, 127, 232, 0.3)",
        "--motion-fast": "150ms",
        "--motion-base": "200ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1200px",
        "--container-gutter-desktop": "24px",
        "--container-gutter-tablet": "16px",
        "--container-gutter-phone": "12px"
      },
      designMd: "# Design System Inspired by Notion\n\n> Category: Productivity & SaaS\n> All-in-one workspace. Warm minimalism, serif headings, soft surfaces.\n\n## 1. Visual Theme & Atmosphere\n\nNotion's website embodies the philosophy of the tool itself: a blank canvas that gets out of your way. The design system is built on warm neutrals rather than cold grays, creating a distinctly approachable minimalism that feels like quality paper rather than sterile glass. The page canvas is pure white (`#ffffff`) but the text isn't pure black -- it's a warm near-black (`rgba(0,0,0,0.95)`) that softens the reading experience imperceptibly. The warm gray scale (`#f6f5f4`, `#31302e`, `#615d59`, `#a39e98`) carries subtle yellow-brown undertones, giving the interface a tactile, almost analog warmth."
    },
    {
      id: "shadcn",
      name: "Shadcn",
      category: "Modern & Minimal",
      description: "Shadcn/ui-inspired design with minimal, clean components, monochrome palette, and utility-first patterns.",
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#ffffff",
        "--surface-warm": "var(--surface)",
        "--fg": "#111827",
        "--fg-2": "var(--fg)",
        "--muted": "#64748b",
        "--meta": "var(--muted)",
        "--border": "#e5e7eb",
        "--border-soft": "var(--border)",
        "--accent": "#000000",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), white 10%)",
        "--accent-active": "color-mix(in oklab, var(--accent), white 18%)",
        "--success": "#16a34a",
        "--warn": "#d97706",
        "--danger": "#dc2626",
        "--font-display": '"Geist", "Geist Sans", -apple-system, system-ui, "Segoe UI", Arial, sans-serif',
        "--font-body": '"Geist", "Geist Sans", -apple-system, system-ui, "Segoe UI", Arial, sans-serif',
        "--font-mono": '"Fira Code", ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "20px",
        "--text-xl": "24px",
        "--text-2xl": "32px",
        "--text-3xl": "40px",
        "--text-4xl": "48px",
        "--leading-body": "1.5",
        "--leading-tight": "1.2",
        "--tracking-display": "-0.02em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "64px",
        "--section-y-phone": "48px",
        "--radius-sm": "6px",
        "--radius-md": "8px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 1px 2px 0 color-mix(in oklab, var(--fg), transparent 92%), 0 1px 3px 0 color-mix(in oklab, var(--fg), transparent 88%)",
        "--focus-ring": "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)",
        "--motion-fast": "150ms",
        "--motion-base": "200ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1280px",
        "--container-gutter-desktop": "24px",
        "--container-gutter-tablet": "16px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Shadcn\n\n> Category: Modern & Minimal\n> Shadcn/ui-inspired design with minimal, clean components, monochrome palette, and utility-first patterns.\n\n## 1. Visual Theme & Atmosphere\n\nShadcn/ui-inspired design with minimal, clean components, monochrome palette, and utility-first patterns.\n\n- **Visual style:** minimal, clean\n- **Color stance:** primary, secondary\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#000000` \u2014 Token from style foundations.\n- **Secondary:** `#111111` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#000000) for CTA emphasis.\n- Use Surface (#FFFFFF) for large backgrounds and cards.\n- Keep body copy on Text (#111827) for legibility.\n\n## 3. Typography"
    },
    {
      id: "material",
      name: "Material",
      category: "Professional & Corporate",
      description: "Google's Material Design with layered surfaces, dynamic theming, built-in motion, and responsive cross-platform patterns.",
      tokens: {
        "--bg": "#f8fafd",
        "--surface": "#ffffff",
        "--surface-warm": "#e8f0fe",
        "--fg": "#202124",
        "--fg-2": "#3c4043",
        "--muted": "#5f6368",
        "--meta": "#1a73e8",
        "--border": "#dadce0",
        "--border-soft": "#edf0f2",
        "--accent": "#1a73e8",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#188038",
        "--warn": "#f9ab00",
        "--danger": "#d93025",
        "--font-display": '"Google Sans", Roboto, Arial, sans-serif',
        "--font-body": "Roboto, Arial, sans-serif",
        "--font-mono": '"Roboto Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "24px",
        "--text-2xl": "32px",
        "--text-3xl": "48px",
        "--text-4xl": "64px",
        "--leading-body": "1.5",
        "--leading-tight": "1.12",
        "--tracking-display": "0",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "68px",
        "--section-y-phone": "48px",
        "--radius-sm": "4px",
        "--radius-md": "12px",
        "--radius-lg": "24px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 3px 8px rgba(60, 64, 67, 0.18)",
        "--focus-ring": "0 0 0 4px rgba(26, 115, 232, 0.24)",
        "--motion-fast": "150ms",
        "--motion-base": "250ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1200px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Material\n\n> Category: Professional & Corporate\n> Google's Material Design with layered surfaces, dynamic theming, built-in motion, and responsive cross-platform patterns.\n\n## 1. Visual Theme & Atmosphere\n\nGoogle's Material Design with layered surfaces, dynamic theming, built-in motion, and responsive cross-platform patterns.\n\n- **Visual style:** modern, minimal, clean\n- **Color stance:** primary, secondary, neutral, success, warning, danger\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#6442D6` \u2014 Token from style foundations.\n- **Secondary:** `#C8B3FD` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#6442D6) for CTA emphasis.\n- Use Surface (#FFFFFF) for large backgrounds and cards."
    },
    {
      id: "github",
      name: "GitHub",
      category: "Developer Tools",
      description: "Code-forward platform. Functional density, blue-on-white precision, Primer foundations.",
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#f6f8fa",
        "--surface-warm": "var(--surface)",
        "--fg": "#1f2328",
        "--fg-2": "#1f2328",
        "--muted": "#656d76",
        "--meta": "#656d76",
        "--border": "#d0d7de",
        "--border-soft": "#d8dee4",
        "--accent": "#0969da",
        "--accent-on": "#ffffff",
        "--accent-hover": "#0550ae",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#1a7f37",
        "--warn": "#9a6700",
        "--danger": "#cf222e",
        "--font-display": '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
        "--font-body": '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
        "--font-mono": 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "14px",
        "--text-lg": "16px",
        "--text-xl": "20px",
        "--text-2xl": "24px",
        "--text-3xl": "28px",
        "--text-4xl": "32px",
        "--leading-body": "1.5",
        "--leading-tight": "1.25",
        "--tracking-display": "-0.01em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "64px",
        "--section-y-tablet": "48px",
        "--section-y-phone": "32px",
        "--radius-sm": "6px",
        "--radius-md": "6px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 1px 3px rgba(31, 35, 40, 0.12), 0 8px 24px rgba(66, 74, 83, 0.12)",
        "--focus-ring": "0 0 0 3px rgba(9, 105, 218, 0.3)",
        "--motion-fast": "80ms",
        "--motion-base": "200ms",
        "--ease-standard": "ease-out",
        "--container-max": "1280px",
        "--container-gutter-desktop": "24px",
        "--container-gutter-tablet": "16px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by GitHub\n\n> Category: Developer Tools\n> Code-forward platform. Functional density, blue-on-white precision, Primer foundations.\n\n## 1. Visual Theme & Atmosphere\n\nGitHub's surface is engineered, not decorated. Every pixel announces a stance: this is a tool for people who care about diffs, builds, and pull requests. The page background is a clean `#ffffff` (light) or `#0d1117` (dark), with content arranged on dense rectangular panes separated by hairline borders rather than negative space. Information density is the brand \u2014 list rows, code lines, repository headers, and notification cards are all packed close together so a power user can scan a hundred items without scrolling.\n\nThe signature accents are the **Primer blue** (`#0969da`) for links and primary actions, and **GitHub green** (`#1a7f37`) for merged states, success, and the merge button itself. Both feel slightly muted compared to consumer-product blues and greens \u2014 saturated enough to read against the dense gray text, restrained enough to disappear into the background when several appear in one viewport."
    },
    {
      id: "bento",
      name: "Bento",
      category: "Layout & Structure",
      description: "Modular grid layout with card-like blocks, clear hierarchy, soft spacing, and subtle visual contrast for organized, scannable interfaces.",
      tokens: {
        "--bg": "#f5f8ff",
        "--surface": "#ffffff",
        "--surface-warm": "#eaf1ff",
        "--fg": "#101828",
        "--fg-2": "#344054",
        "--muted": "#667085",
        "--meta": "#2563eb",
        "--border": "#d7e0ef",
        "--border-soft": "#edf2f8",
        "--accent": "#2563eb",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#16a34a",
        "--warn": "#f59e0b",
        "--danger": "#ef4444",
        "--font-display": "Inter, system-ui, sans-serif",
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "24px",
        "--text-2xl": "36px",
        "--text-3xl": "54px",
        "--text-4xl": "76px",
        "--leading-body": "1.52",
        "--leading-tight": "1.06",
        "--tracking-display": "-0.025em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "68px",
        "--section-y-phone": "48px",
        "--radius-sm": "10px",
        "--radius-md": "16px",
        "--radius-lg": "24px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 20px 52px rgba(16, 24, 40, 0.11)",
        "--focus-ring": "0 0 0 4px rgba(37, 99, 235, 0.22)",
        "--motion-fast": "150ms",
        "--motion-base": "240ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1180px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Bento\n\n> Category: Layout & Structure\n> Modular grid layout with card-like blocks, clear hierarchy, soft spacing, and subtle visual contrast for organized, scannable interfaces.\n\n## 1. Visual Theme & Atmosphere\n\nModular grid layout with card-like blocks, clear hierarchy, soft spacing, and subtle visual contrast for organized, scannable interfaces.\n\n- **Visual style:** modern, clean\n- **Color stance:** primary, neutral, success, warning, danger\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#FAD4C0` \u2014 Token from style foundations.\n- **Secondary:** `#80A1C1` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFF5E6` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFF5E6` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#FAD4C0) for CTA emphasis.\n- Use Surface (#FFF5E6) for large backgrounds and cards."
    },
    {
      id: "editorial",
      name: "Editorial",
      category: "Creative & Artistic",
      description: "Magazine-inspired editorial layout with refined serif typography, structured grids, and elegant reading experiences.",
      tokens: {
        "--bg": "#fbf7f0",
        "--surface": "#fffdf8",
        "--surface-warm": "#f1e6d6",
        "--fg": "#1f1a16",
        "--fg-2": "#4b4038",
        "--muted": "#7d7168",
        "--meta": "#9a5a2f",
        "--border": "#ded3c5",
        "--border-soft": "#eee5da",
        "--accent": "#9a5a2f",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#4f8a4f",
        "--warn": "#c9822f",
        "--danger": "#b33a3a",
        "--font-display": 'Georgia, "Times New Roman", serif',
        "--font-body": '"Source Serif Pro", Georgia, serif',
        "--font-mono": '"IBM Plex Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "18px",
        "--text-lg": "21px",
        "--text-xl": "30px",
        "--text-2xl": "44px",
        "--text-3xl": "66px",
        "--text-4xl": "92px",
        "--leading-body": "1.65",
        "--leading-tight": "1",
        "--tracking-display": "-0.02em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "112px",
        "--section-y-tablet": "80px",
        "--section-y-phone": "56px",
        "--radius-sm": "4px",
        "--radius-md": "8px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 20px 50px rgba(31, 26, 22, 0.12)",
        "--focus-ring": "0 0 0 4px rgba(154, 90, 47, 0.24)",
        "--motion-fast": "180ms",
        "--motion-base": "280ms",
        "--ease-standard": "cubic-bezier(0.22, 1, 0.36, 1)",
        "--container-max": "1120px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Editorial\n\n> Category: Creative & Artistic\n> Magazine-inspired editorial layout with refined serif typography, structured grids, and elegant reading experiences.\n\n## 1. Visual Theme & Atmosphere\n\nMagazine-inspired editorial layout with refined serif typography, structured grids, and elegant reading experiences.\n\n- **Visual style:** modern, editorial\n- **Color stance:** primary, secondary, neutral, success\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#111111` \u2014 Token from style foundations.\n- **Secondary:** `#F1F1F1` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#111111) for CTA emphasis.\n- Use Surface (#FFFFFF) for large backgrounds and cards."
    },
    {
      id: "warm-editorial",
      name: "Warm Editorial",
      category: "Starter",
      description: "A serif-led magazine aesthetic. Terracotta accent on warm off-white paper \u2014",
      tokens: {
        "--bg": "#fbf6ee",
        "--surface": "#fffdf8",
        "--surface-warm": "#f1e3cf",
        "--fg": "#201914",
        "--fg-2": "#4c4037",
        "--muted": "#7a6d63",
        "--meta": "#9b5b32",
        "--border": "#ded2c3",
        "--border-soft": "#eee4d7",
        "--accent": "#9b5b32",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#4f8a4f",
        "--warn": "#c9822f",
        "--danger": "#b33a3a",
        "--font-display": 'Georgia, "Times New Roman", serif',
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "17px",
        "--text-lg": "20px",
        "--text-xl": "28px",
        "--text-2xl": "42px",
        "--text-3xl": "64px",
        "--text-4xl": "88px",
        "--leading-body": "1.62",
        "--leading-tight": "1",
        "--tracking-display": "-0.025em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "112px",
        "--section-y-tablet": "80px",
        "--section-y-phone": "56px",
        "--radius-sm": "10px",
        "--radius-md": "16px",
        "--radius-lg": "24px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 20px 52px rgba(32, 25, 20, 0.12)",
        "--focus-ring": "0 0 0 4px rgba(155, 91, 50, 0.24)",
        "--motion-fast": "150ms",
        "--motion-base": "240ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1180px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Warm Editorial\n\n> Category: Starter\n> A serif-led magazine aesthetic. Terracotta accent on warm off-white paper \u2014\n> good for long-form, editorial, and brand-led marketing pages.\n\n## Visual Theme & Atmosphere\nWarm, unhurried, magazine-like. Think \"a New Yorker interview column online.\" Generous whitespace, long-form readability, restrained chrome. Playful but never novelty.\n\n## Color Palette & Roles\n- **Background:** `#FAF7F2` (warm off-white paper)\n- **Foreground:** `#1C1A17` (near-black, slightly warm)\n- **Accent (primary):** `#C0512F` (terracotta) \u2014 used for links, primary CTAs, 1 hero element max per page\n- **Accent (secondary):** `#2F5B4F` (forest) \u2014 section dividers, tags\n- **Muted:** `#8A817A` (mid-warm-grey) \u2014 timestamps, metadata\n- **Surface:** `#FFFFFF` \u2014 elevated cards only\nNever use pure black or pure white anywhere user-facing.\n\n## Typography Rules\n- **Display / headings:** \"GT Sectra\" or fallback serif (`'GT Sectra', 'Times New Roman', serif`)\n- **Body:** \"S\xF6hne\" or fallback sans (`'S\xF6hne', -apple-system, system-ui, sans-serif`)\n- **Mono:** `'JetBrains Mono', ui-monospace, monospace` for code only\n- Scale (px): 12 \xB7 14 \xB7 16 \xB7 20 \xB7 28 \xB7 40 \xB7 56 \xB7 80"
    },
    {
      id: "paper",
      name: "Paper",
      category: "Retro & Nostalgic",
      description: "Paper-textured, print-inspired design with minimal colors, clean serif/sans typography, and tactile surface qualities.",
      tokens: {
        "--bg": "#faf3df",
        "--surface": "#fffaf0",
        "--surface-warm": "#efe0bd",
        "--fg": "#211b12",
        "--fg-2": "#504737",
        "--muted": "#7c7160",
        "--meta": "#8f5d24",
        "--border": "#ddd0b4",
        "--border-soft": "#eee3cd",
        "--accent": "#8f5d24",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#5b8d42",
        "--warn": "#c27b22",
        "--danger": "#a64036",
        "--font-display": 'Georgia, "Times New Roman", serif',
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "17px",
        "--text-lg": "20px",
        "--text-xl": "28px",
        "--text-2xl": "42px",
        "--text-3xl": "64px",
        "--text-4xl": "88px",
        "--leading-body": "1.62",
        "--leading-tight": "1",
        "--tracking-display": "-0.025em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "112px",
        "--section-y-tablet": "80px",
        "--section-y-phone": "56px",
        "--radius-sm": "10px",
        "--radius-md": "16px",
        "--radius-lg": "24px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 18px 42px rgba(33, 27, 18, 0.12)",
        "--focus-ring": "0 0 0 4px rgba(143, 93, 36, 0.24)",
        "--motion-fast": "150ms",
        "--motion-base": "240ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1180px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Paper\n\n> Category: Retro & Nostalgic\n> Paper-textured, print-inspired design with minimal colors, clean serif/sans typography, and tactile surface qualities.\n\n## 1. Visual Theme & Atmosphere\n\nPaper-textured, print-inspired design with minimal colors, clean serif/sans typography, and tactile surface qualities.\n\n- **Visual style:** minimal, clean\n- **Color stance:** primary, neutral, success, warning, danger\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#111111` \u2014 Token from style foundations.\n- **Secondary:** `#8B5CF6` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#111111) for CTA emphasis.\n- Use Surface (#FFFFFF) for large backgrounds and cards."
    },
    {
      id: "brutalism",
      name: "Brutalism",
      category: "Bold & Expressive",
      description: "Raw, anti-design aesthetic inspired by concrete architecture with unadorned elements, jarring layouts, and functional minimalism.",
      tokens: {
        "--bg": "#f5f1e8",
        "--surface": "#ffffff",
        "--surface-warm": "#ffef5a",
        "--fg": "#000000",
        "--fg-2": "#222222",
        "--muted": "#555555",
        "--meta": "#000000",
        "--border": "#000000",
        "--border-soft": "#000000",
        "--accent": "#ffef5a",
        "--accent-on": "#000000",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#00b050",
        "--warn": "#ff8c00",
        "--danger": "#ff2b2b",
        "--font-display": "Arial Black, Impact, sans-serif",
        "--font-body": "Arial, Helvetica, sans-serif",
        "--font-mono": '"Courier New", ui-monospace, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "17px",
        "--text-lg": "20px",
        "--text-xl": "28px",
        "--text-2xl": "42px",
        "--text-3xl": "64px",
        "--text-4xl": "88px",
        "--leading-body": "1.35",
        "--leading-tight": "0.98",
        "--tracking-display": "0",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "88px",
        "--section-y-tablet": "64px",
        "--section-y-phone": "44px",
        "--radius-sm": "0px",
        "--radius-md": "0px",
        "--radius-lg": "0px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "8px 8px 0 #000000",
        "--focus-ring": "0 0 0 4px #000000, 0 0 0 8px #ffef5a",
        "--motion-fast": "90ms",
        "--motion-base": "140ms",
        "--ease-standard": "steps(2, end)",
        "--container-max": "1160px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Brutalism\n\n> Category: Bold & Expressive\n> Raw, anti-design aesthetic inspired by concrete architecture with unadorned elements, jarring layouts, and functional minimalism.\n\n## 1. Visual Theme & Atmosphere\n\nRaw, anti-design aesthetic inspired by concrete architecture with unadorned elements, jarring layouts, and functional minimalism.\n\n- **Visual style:** bold\n- **Color stance:** primary, secondary, neutral, success, warning, danger\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#DD614C` \u2014 Token from style foundations.\n- **Secondary:** `#DAA144` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#DD614C) for CTA emphasis.\n- Use Surface (#FFFFFF) for large backgrounds and cards."
    },
    {
      id: "neobrutalism",
      name: "Neobrutalism",
      category: "Bold & Expressive",
      description: "Modern take on brutalism with bold borders, vivid accent colors, and raw, high-contrast layouts on warm surfaces.",
      tokens: {
        "--bg": "#fff4cf",
        "--surface": "#fffaf0",
        "--surface-warm": "#ffdca8",
        "--fg": "#2a1810",
        "--fg-2": "#593625",
        "--muted": "#8a6652",
        "--meta": "#d24b1f",
        "--border": "#d9aa7a",
        "--border-soft": "#efd0ab",
        "--accent": "#d24b1f",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#3d8f4f",
        "--warn": "#f2a93b",
        "--danger": "#b83a2f",
        "--font-display": "Arial Black, Impact, sans-serif",
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "24px",
        "--text-2xl": "36px",
        "--text-3xl": "54px",
        "--text-4xl": "76px",
        "--leading-body": "1.52",
        "--leading-tight": "1.06",
        "--tracking-display": "0",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "68px",
        "--section-y-phone": "48px",
        "--radius-sm": "4px",
        "--radius-md": "8px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "6px 6px 0 rgba(42, 24, 16, 0.26)",
        "--focus-ring": "0 0 0 4px rgba(210, 75, 31, 0.28)",
        "--motion-fast": "150ms",
        "--motion-base": "240ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1180px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Neobrutalism\n\n> Category: Bold & Expressive\n> Modern take on brutalism with bold borders, vivid accent colors, and raw, high-contrast layouts on warm surfaces.\n\n## 1. Visual Theme & Atmosphere\n\nModern take on brutalism with bold borders, vivid accent colors, and raw, high-contrast layouts on warm surfaces.\n\n- **Visual style:** modern, clean, high-contrast\n- **Color stance:** primary, neutral, success, warning, danger\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#FDC800` \u2014 Token from style foundations.\n- **Secondary:** `#432DD7` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FBFBF9` \u2014 Token from style foundations.\n- **Text:** `#1C293C` \u2014 Token from style foundations.\n- **Neutral:** `#FBFBF9` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#FDC800) for CTA emphasis.\n- Use Surface (#FBFBF9) for large backgrounds and cards."
    },
    {
      id: "mono",
      name: "Mono",
      category: "Modern & Minimal",
      description: "Monospace-driven, matrix-inspired design with high-contrast elements, compact density, and a hacker-chic aesthetic.",
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#f7f7f7",
        "--surface-warm": "#eeeeee",
        "--fg": "#111111",
        "--fg-2": "#3a3a3a",
        "--muted": "#707070",
        "--meta": "#111111",
        "--border": "#d9d9d9",
        "--border-soft": "#eeeeee",
        "--accent": "#111111",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#168a46",
        "--warn": "#b7791f",
        "--danger": "#c53030",
        "--font-display": '"IBM Plex Mono", ui-monospace, monospace',
        "--font-body": '"IBM Plex Mono", ui-monospace, monospace',
        "--font-mono": '"IBM Plex Mono", ui-monospace, monospace',
        "--text-xs": "11px",
        "--text-sm": "12px",
        "--text-base": "14px",
        "--text-lg": "16px",
        "--text-xl": "20px",
        "--text-2xl": "28px",
        "--text-3xl": "40px",
        "--text-4xl": "56px",
        "--leading-body": "1.45",
        "--leading-tight": "1.06",
        "--tracking-display": "-0.025em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "80px",
        "--section-y-tablet": "60px",
        "--section-y-phone": "42px",
        "--radius-sm": "4px",
        "--radius-md": "8px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 16px 40px rgba(0, 0, 0, 0.10)",
        "--focus-ring": "0 0 0 3px rgba(17, 17, 17, 0.18)",
        "--motion-fast": "100ms",
        "--motion-base": "180ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1280px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Mono\n\n> Category: Modern & Minimal\n> Monospace-driven, matrix-inspired design with high-contrast elements, compact density, and a hacker-chic aesthetic.\n\n## 1. Visual Theme & Atmosphere\n\nMonospace-driven, matrix-inspired design with high-contrast elements, compact density, and a hacker-chic aesthetic.\n\n- **Visual style:** minimal, clean, high-contrast, playful, matrix\n- **Color stance:** primary, secondary, success, warning, danger, info\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#37F712` \u2014 Token from style foundations.\n- **Secondary:** `#00A6F4` \u2014 Token from style foundations.\n- **Success:** `#00A63D` \u2014 Token from style foundations.\n- **Warning:** `#FE9900` \u2014 Token from style foundations.\n- **Danger:** `#FF2157` \u2014 Token from style foundations.\n- **Surface:** `#E7E5E4` \u2014 Token from style foundations.\n- **Text:** `#78716B` \u2014 Token from style foundations.\n- **Neutral:** `#E7E5E4` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#37F712) for CTA emphasis.\n- Use Surface (#E7E5E4) for large backgrounds and cards."
    },
    {
      id: "minimal",
      name: "Minimal",
      category: "Modern & Minimal",
      description: "Stripped-back design emphasizing whitespace, clean typography, and restrained color for maximum clarity and focus.",
      tokens: {
        "--bg": "#ffffff",
        "--surface": "#fafafa",
        "--surface-warm": "#f5f5f5",
        "--fg": "#111111",
        "--fg-2": "#3a3a3a",
        "--muted": "#777777",
        "--meta": "#111111",
        "--border": "#e2e2e2",
        "--border-soft": "#eeeeee",
        "--accent": "#111111",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#168a46",
        "--warn": "#b7791f",
        "--danger": "#c53030",
        "--font-display": "Inter, system-ui, sans-serif",
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "22px",
        "--text-2xl": "32px",
        "--text-3xl": "48px",
        "--text-4xl": "64px",
        "--leading-body": "1.55",
        "--leading-tight": "1.08",
        "--tracking-display": "-0.02em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "112px",
        "--section-y-tablet": "80px",
        "--section-y-phone": "56px",
        "--radius-sm": "2px",
        "--radius-md": "4px",
        "--radius-lg": "8px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 12px 30px rgba(0, 0, 0, 0.08)",
        "--focus-ring": "0 0 0 3px rgba(17, 17, 17, 0.18)",
        "--motion-fast": "140ms",
        "--motion-base": "220ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1120px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Minimal\n\n> Category: Modern & Minimal\n> Stripped-back design emphasizing whitespace, clean typography, and restrained color for maximum clarity and focus.\n\n## 1. Visual Theme & Atmosphere\n\nStripped-back design emphasizing whitespace, clean typography, and restrained color for maximum clarity and focus.\n\n- **Visual style:** minimal, clean, bold\n- **Color stance:** primary, neutral, success, warning, danger\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#0C0C09` \u2014 Token from style foundations.\n- **Secondary:** `#312C85` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#F4F4F1` \u2014 Token from style foundations.\n- **Text:** `#0C0C09` \u2014 Token from style foundations.\n- **Neutral:** `#F4F4F1` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#0C0C09) for CTA emphasis.\n- Use Surface (#F4F4F1) for large backgrounds and cards."
    },
    {
      id: "glassmorphism",
      name: "Glassmorphism",
      category: "Morphism & Effects",
      description: "Frosted glass effect with translucent layers, subtle blur, and luminous borders for depth and modern elegance.",
      tokens: {
        "--bg": "#eef6ff",
        "--surface": "rgba(255, 255, 255, 0.74)",
        "--surface-warm": "rgba(238, 246, 255, 0.72)",
        "--fg": "#102033",
        "--fg-2": "#34465f",
        "--muted": "#60708a",
        "--meta": "#4f8cff",
        "--border": "rgba(255, 255, 255, 0.64)",
        "--border-soft": "rgba(255, 255, 255, 0.38)",
        "--accent": "#4f8cff",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#22c55e",
        "--warn": "#f59e0b",
        "--danger": "#ef4444",
        "--font-display": "Inter, system-ui, sans-serif",
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "24px",
        "--text-2xl": "36px",
        "--text-3xl": "54px",
        "--text-4xl": "76px",
        "--leading-body": "1.55",
        "--leading-tight": "1.04",
        "--tracking-display": "-0.025em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "104px",
        "--section-y-tablet": "72px",
        "--section-y-phone": "52px",
        "--radius-sm": "16px",
        "--radius-md": "24px",
        "--radius-lg": "36px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 24px 80px rgba(79, 140, 255, 0.18)",
        "--focus-ring": "0 0 0 4px rgba(79, 140, 255, 0.28)",
        "--motion-fast": "180ms",
        "--motion-base": "280ms",
        "--ease-standard": "cubic-bezier(0.22, 1, 0.36, 1)",
        "--container-max": "1180px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Glassmorphism\n\n> Category: Morphism & Effects\n> Frosted glass effect with translucent layers, subtle blur, and luminous borders for depth and modern elegance.\n\n## 1. Visual Theme & Atmosphere\n\nFrosted glass effect with translucent layers, subtle blur, and luminous borders for depth and modern elegance.\n\n- **Visual style:** clean, high-contrast, bold, enterprise, liquidglass effect, glassmorphism\n- **Color stance:** primary, neutral, success, warning, danger, info, surface/subtle layers\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#1856FF` \u2014 Token from style foundations.\n- **Secondary:** `#3A344E` \u2014 Token from style foundations.\n- **Success:** `#07CA6B` \u2014 Token from style foundations.\n- **Warning:** `#E89558` \u2014 Token from style foundations.\n- **Danger:** `#EA2143` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#141414` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#1856FF) for CTA emphasis."
    },
    {
      id: "luxury",
      name: "Luxury",
      category: "Professional & Corporate",
      description: "High-end dark aesthetic with bold headings, monochromatic palette, and premium feel for luxury brand experiences.",
      tokens: {
        "--bg": "#080706",
        "--surface": "#151310",
        "--surface-warm": "#241e14",
        "--fg": "#fff8ea",
        "--fg-2": "#d8cdb7",
        "--muted": "#9f927c",
        "--meta": "#c6a15b",
        "--border": "#3a3020",
        "--border-soft": "#282217",
        "--accent": "#c6a15b",
        "--accent-on": "#080706",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#5fa36a",
        "--warn": "#d8a94f",
        "--danger": "#d85a52",
        "--font-display": '"Didot", "Bodoni 72", Georgia, serif',
        "--font-body": '"Avenir Next", Inter, sans-serif',
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "19px",
        "--text-xl": "28px",
        "--text-2xl": "44px",
        "--text-3xl": "68px",
        "--text-4xl": "96px",
        "--leading-body": "1.6",
        "--leading-tight": "0.98",
        "--tracking-display": "-0.015em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "120px",
        "--section-y-tablet": "84px",
        "--section-y-phone": "60px",
        "--radius-sm": "8px",
        "--radius-md": "14px",
        "--radius-lg": "24px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 30px 90px rgba(0, 0, 0, 0.52)",
        "--focus-ring": "0 0 0 4px rgba(198, 161, 91, 0.30)",
        "--motion-fast": "180ms",
        "--motion-base": "300ms",
        "--ease-standard": "cubic-bezier(0.16, 1, 0.3, 1)",
        "--container-max": "1160px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Luxury\n\n> Category: Professional & Corporate\n> High-end dark aesthetic with bold headings, monochromatic palette, and premium feel for luxury brand experiences.\n\n## 1. Visual Theme & Atmosphere\n\nHigh-end dark aesthetic with bold headings, monochromatic palette, and premium feel for luxury brand experiences.\n\n- **Visual style:** modern, bold, big headings\n- **Color stance:** primary\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#FAFAFA` \u2014 Token from style foundations.\n- **Secondary:** `#FAFAFA` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#000000` \u2014 Token from style foundations.\n- **Text:** `#FFFFFF` \u2014 Token from style foundations.\n- **Neutral:** `#000000` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#FAFAFA) for CTA emphasis.\n- Use Surface (#000000) for large backgrounds and cards.\n- Keep body copy on Text (#FFFFFF) for legibility.\n\n## 3. Typography"
    },
    {
      id: "doodle",
      name: "Doodle",
      category: "Creative & Artistic",
      description: "Hand-drawn, sketch-like style with doodles, handwritten fonts, and imperfect lines for a playful, informal feel.",
      tokens: {
        "--bg": "#fff8d7",
        "--surface": "#ffffff",
        "--surface-warm": "#ffef9f",
        "--fg": "#1d1836",
        "--fg-2": "#4c426c",
        "--muted": "#796f91",
        "--meta": "#ff6b00",
        "--border": "#eadfba",
        "--border-soft": "#f5eccd",
        "--accent": "#ff6b00",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#2e9d57",
        "--warn": "#ffb020",
        "--danger": "#e5484d",
        "--font-display": '"Comic Sans MS", "Trebuchet MS", sans-serif',
        "--font-body": '"Comic Sans MS", "Trebuchet MS", sans-serif',
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "24px",
        "--text-2xl": "36px",
        "--text-3xl": "54px",
        "--text-4xl": "76px",
        "--leading-body": "1.52",
        "--leading-tight": "1.06",
        "--tracking-display": "-0.025em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "68px",
        "--section-y-phone": "48px",
        "--radius-sm": "10px",
        "--radius-md": "16px",
        "--radius-lg": "24px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 18px 44px rgba(29, 24, 54, 0.14)",
        "--focus-ring": "0 0 0 4px rgba(255, 107, 0, 0.26)",
        "--motion-fast": "150ms",
        "--motion-base": "240ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1180px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Doodle\n\n> Category: Creative & Artistic\n> Hand-drawn, sketch-like style with doodles, handwritten fonts, and imperfect lines for a playful, informal feel.\n\n## 1. Visual Theme & Atmosphere\n\nHand-drawn, sketch-like style with doodles, handwritten fonts, and imperfect lines for a playful, informal feel.\n\n- **Visual style:** playful\n- **Color stance:** primary, secondary, neutral, success, warning, danger\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#49B6E5` \u2014 Token from style foundations.\n- **Secondary:** `#263D5B` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#49B6E5) for CTA emphasis.\n- Use Surface (#FFFFFF) for large backgrounds and cards."
    },
    {
      id: "trading-terminal",
      name: "Trading Terminal Design System",
      category: "Themed & Unique",
      description: "Bloomberg-style financial trading terminal. Dark-only, data-dense, cyan/coral buy/sell signals. Everything readable at a glance from two meters away.",
      tokens: {
        "--bg": "#070b12",
        "--surface": "#101826",
        "--surface-warm": "#162238",
        "--fg": "#f8fafc",
        "--fg-2": "#cbd5e1",
        "--muted": "#8492a6",
        "--meta": "#38bdf8",
        "--border": "#263246",
        "--border-soft": "#1c2638",
        "--accent": "#38bdf8",
        "--accent-on": "#03111a",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#22c55e",
        "--warn": "#f59e0b",
        "--danger": "#ef4444",
        "--font-display": "Inter, system-ui, sans-serif",
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"Roboto Mono", "SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "11px",
        "--text-sm": "12px",
        "--text-base": "14px",
        "--text-lg": "16px",
        "--text-xl": "20px",
        "--text-2xl": "28px",
        "--text-3xl": "40px",
        "--text-4xl": "56px",
        "--leading-body": "1.45",
        "--leading-tight": "1.08",
        "--tracking-display": "-0.01em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "80px",
        "--section-y-tablet": "60px",
        "--section-y-phone": "42px",
        "--radius-sm": "4px",
        "--radius-md": "8px",
        "--radius-lg": "12px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 24px 80px rgba(0, 0, 0, 0.42)",
        "--focus-ring": "0 0 0 4px rgba(56, 189, 248, 0.28)",
        "--motion-fast": "90ms",
        "--motion-base": "160ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1320px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Trading Terminal Design System\n\n> Category: Themed & Unique\n> Bloomberg-style financial trading terminal. Dark-only, data-dense, cyan/coral buy/sell signals. Everything readable at a glance from two meters away.\n\n## 1. Visual Theme & Atmosphere\n\nA professional-grade financial data terminal. Dense, information-rich layouts designed for traders who need to monitor multiple markets simultaneously. Dark surfaces reduce eye strain during long sessions. Cyan accent (#00D4AA) signals positive/buy, coral (#FF4757) signals negative/sell. Everything readable at a glance from two meters away.\n\n- **Visual style:** dense, data-first, professional\n- **Color stance:** dark surfaces with high-contrast data colors\n- **Design intent:** keep outputs recognizable to this style family while preserving usability and readability\n\n### Prior Art\n\nBloomberg Terminal, Refinitiv Eikon, FactSet, TradingView Pro. All share: dark-only surfaces, monospace data fonts, tabular layouts with no decorative spacing, and color-coded buy/sell signals.\n\n## 2. Color Palette & Roles\n\n### Surface Palette\n\n| Token | Hex | Usage |\n|-------|-----|-------|\n| Background | `#0D0D0D` | Primary canvas |"
    },
    {
      id: "corporate",
      name: "Corporate",
      category: "Professional & Corporate",
      description: "Professional, brand-aligned design with structured grids, minimalist layouts, and consistent enterprise patterns.",
      tokens: {
        "--bg": "#f5f8ff",
        "--surface": "#ffffff",
        "--surface-warm": "#eaf1ff",
        "--fg": "#101828",
        "--fg-2": "#344054",
        "--muted": "#667085",
        "--meta": "#2563eb",
        "--border": "#d7e0ef",
        "--border-soft": "#edf2f8",
        "--accent": "#2563eb",
        "--accent-on": "#ffffff",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#16a34a",
        "--warn": "#f59e0b",
        "--danger": "#ef4444",
        "--font-display": "Inter, system-ui, sans-serif",
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "24px",
        "--text-2xl": "36px",
        "--text-3xl": "54px",
        "--text-4xl": "76px",
        "--leading-body": "1.52",
        "--leading-tight": "1.06",
        "--tracking-display": "-0.025em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "68px",
        "--section-y-phone": "48px",
        "--radius-sm": "10px",
        "--radius-md": "16px",
        "--radius-lg": "24px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 20px 52px rgba(16, 24, 40, 0.11)",
        "--focus-ring": "0 0 0 4px rgba(37, 99, 235, 0.22)",
        "--motion-fast": "150ms",
        "--motion-base": "240ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1180px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Corporate\n\n> Category: Professional & Corporate\n> Professional, brand-aligned design with structured grids, minimalist layouts, and consistent enterprise patterns.\n\n## 1. Visual Theme & Atmosphere\n\nProfessional, brand-aligned design with structured grids, minimalist layouts, and consistent enterprise patterns.\n\n- **Visual style:** enterprise, premium\n- **Color stance:** primary, neutral, success, warning, danger\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#3B82F6` \u2014 Token from style foundations.\n- **Secondary:** `#8B5CF6` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#3B82F6) for CTA emphasis.\n- Use Surface (#FFFFFF) for large backgrounds and cards."
    },
    {
      id: "neon",
      name: "Neon",
      category: "Morphism & Effects",
      description: "Electric neon glow effects with high-contrast color pairings for bold, attention-grabbing interfaces.",
      tokens: {
        "--bg": "#070711",
        "--surface": "#111126",
        "--surface-warm": "#1e1540",
        "--fg": "#f8f7ff",
        "--fg-2": "#d6ccff",
        "--muted": "#9d8ad4",
        "--meta": "#c084fc",
        "--border": "#34265e",
        "--border-soft": "#241c42",
        "--accent": "#c084fc",
        "--accent-on": "#13051f",
        "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
        "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
        "--success": "#39ff88",
        "--warn": "#fff34d",
        "--danger": "#ff4d8d",
        "--font-display": "Inter, system-ui, sans-serif",
        "--font-body": "Inter, system-ui, sans-serif",
        "--font-mono": '"SF Mono", ui-monospace, Menlo, monospace',
        "--text-xs": "12px",
        "--text-sm": "14px",
        "--text-base": "16px",
        "--text-lg": "18px",
        "--text-xl": "24px",
        "--text-2xl": "36px",
        "--text-3xl": "54px",
        "--text-4xl": "76px",
        "--leading-body": "1.52",
        "--leading-tight": "1.06",
        "--tracking-display": "-0.025em",
        "--space-1": "4px",
        "--space-2": "8px",
        "--space-3": "12px",
        "--space-4": "16px",
        "--space-5": "20px",
        "--space-6": "24px",
        "--space-8": "32px",
        "--space-12": "48px",
        "--section-y-desktop": "96px",
        "--section-y-tablet": "68px",
        "--section-y-phone": "48px",
        "--radius-sm": "10px",
        "--radius-md": "16px",
        "--radius-lg": "24px",
        "--radius-pill": "9999px",
        "--elev-flat": "none",
        "--elev-ring": "0 0 0 1px var(--border)",
        "--elev-raised": "0 24px 80px rgba(192, 132, 252, 0.22)",
        "--focus-ring": "0 0 0 4px rgba(192, 132, 252, 0.32)",
        "--motion-fast": "150ms",
        "--motion-base": "240ms",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--container-max": "1180px",
        "--container-gutter-desktop": "36px",
        "--container-gutter-tablet": "24px",
        "--container-gutter-phone": "16px"
      },
      designMd: "# Design System Inspired by Neon\n\n> Category: Morphism & Effects\n> Electric neon glow effects with high-contrast color pairings for bold, attention-grabbing interfaces.\n\n## 1. Visual Theme & Atmosphere\n\nElectric neon glow effects with high-contrast color pairings for bold, attention-grabbing interfaces.\n\n- **Visual style:** high-contrast\n- **Color stance:** primary, secondary\n- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.\n\n## 2. Color\n\n- **Primary:** `#BBF351` \u2014 Token from style foundations.\n- **Secondary:** `#00BCFF` \u2014 Token from style foundations.\n- **Success:** `#16A34A` \u2014 Token from style foundations.\n- **Warning:** `#D97706` \u2014 Token from style foundations.\n- **Danger:** `#DC2626` \u2014 Token from style foundations.\n- **Surface:** `#FFFFFF` \u2014 Token from style foundations.\n- **Text:** `#111827` \u2014 Token from style foundations.\n- **Neutral:** `#FFFFFF` \u2014 Derived from the surface token for official format compatibility.\n\n- Favor Primary (#BBF351) for CTA emphasis.\n- Use Surface (#FFFFFF) for large backgrounds and cards.\n- Keep body copy on Text (#111827) for legibility.\n\n## 3. Typography\n\n- **Scale:** 14/16/18/24/32/40"
    }
  ];

  // panel/mode.ts
  var GUEST_ATTACH_TEXT_MAX2 = 16e3;
  var MODE_CHIP_SCREEN_CAP = 40;
  var DESIGN_TYPES = ["wireframe", "hi-fi", "prototype", "deck", "custom"];
  var TYPE_HINT = {
    wireframe: "structure and navigation only \u2014 no final color, type or copy",
    "hi-fi": "static screens with the full design system (tokens, type, color)",
    prototype: "a real, interactive app with a dev server, all five states and motion",
    deck: "a presentation deck (HTML slides) with its own nav and print layout",
    custom: "ask what is being made, then choose the closest approach"
  };
  var FIDELITIES = ["wireframe", "hi-fi", "interactive"];
  var FIDELITY_HINT = {
    wireframe: "low fidelity: boxes, flows and labels, no polish",
    "hi-fi": "final visual quality: tokens, type, color, spacing",
    interactive: "hi-fi plus working interactions and transitions"
  };
  function findDesignSystem(id) {
    if (!id) return null;
    return DESIGN_SYSTEMS.find((preset) => preset.id === id) ?? null;
  }
  function filterDesignSystems(query, presets = DESIGN_SYSTEMS) {
    const needle = query.trim().toLowerCase();
    if (!needle) return presets.slice();
    return presets.filter(
      (preset) => preset.name.toLowerCase().includes(needle) || preset.category.toLowerCase().includes(needle) || preset.description.toLowerCase().includes(needle)
    );
  }
  function designSystemGroups(presets) {
    const order = [];
    const groups = /* @__PURE__ */ new Map();
    for (const preset of presets) {
      let bucket = groups.get(preset.category);
      if (!bucket) {
        bucket = [];
        groups.set(preset.category, bucket);
        order.push(preset.category);
      }
      bucket.push(preset);
    }
    return order.map((category) => ({ category, presets: groups.get(category) }));
  }
  var SWATCH_TOKEN_ORDER = [
    "--bg",
    "--surface",
    "--surface-warm",
    "--accent",
    "--accent-hover",
    "--accent-active",
    "--fg",
    "--muted",
    "--border",
    "--success",
    "--warn",
    "--danger"
  ];
  function isColorTokenValue(value) {
    const text = value.trim().toLowerCase();
    return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text) || /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/.test(text);
  }
  function designSystemSwatches(preset, max = 8) {
    const preferred = SWATCH_TOKEN_ORDER.filter((name) => isColorTokenValue(preset.tokens[name] ?? ""));
    const extras = Object.keys(preset.tokens).filter(
      (name) => !SWATCH_TOKEN_ORDER.includes(name) && isColorTokenValue(preset.tokens[name])
    );
    return [...preferred, ...extras].slice(0, max).map((name) => ({ name, value: preset.tokens[name] }));
  }
  var DEVICE_PRESETS = {
    phone: { label: "phone", width: 390, height: 844 },
    tablet: { label: "tablet", width: 768, height: 1024 },
    desktop: { label: "desktop", width: 1440, height: 900 }
  };
  function devicesLabel(devices, questions = true) {
    const known = [...new Set(devices ?? [])].filter((id) => Object.hasOwn(DEVICE_PRESETS, id));
    if (known.length === 0) return questions ? "not chosen yet \u2014 agree them first" : "not chosen \u2014 pick them and list them in your Assumptions";
    return known.map((id) => `${DEVICE_PRESETS[id].label} ${DEVICE_PRESETS[id].width}\xD7${DEVICE_PRESETS[id].height}`).join(" \xB7 ");
  }
  function agreementStatusLine(input) {
    const questions = input.questions !== false;
    const options = input.options === "ask" && !questions ? 1 : input.options ?? (questions ? "ask" : 1);
    const optionsText = options === "ask" ? "ask the user" : input.options === "ask" ? "one direction" : options;
    return `Questions first: ${questions ? "on" : "off"} \xB7 Options: ${optionsText} \xB7 Devices: ${devicesLabel(input.devices, questions)}`;
  }
  var DEFAULT_MODE = { on: false, type: "hi-fi", direction: "auto", fidelity: "hi-fi", canvMode: "edit", brief: "" };
  function parseDesignArgs(raw) {
    const text = raw.trim();
    const [first = "", ...rest] = text.split(/\s+/);
    const brief = rest.join(" ");
    if (/^off$/i.test(first)) return { on: false, mode: null, type: null, brief };
    if (/^on$/i.test(first)) return { on: true, mode: null, type: null, brief };
    if (/^play$/i.test(first)) return { on: true, mode: "play", type: null, brief };
    if (/^edit$/i.test(first)) return { on: true, mode: "edit", type: null, brief };
    if (first === "") return { on: true, mode: null, type: null, brief };
    const type = DESIGN_TYPES.find((candidate) => candidate === first.toLowerCase());
    if (type) return { on: true, mode: null, type, brief };
    return { on: true, mode: null, type: null, brief: text };
  }
  function modeStorageKey(sessionId) {
    return sessionId ? `mode/${sessionId}` : null;
  }
  function workspaceStorageKey(sessionId) {
    return sessionId ? `ws/${sessionId}` : null;
  }
  function designMarkerKey(sessionId) {
    return sessionId ? `design/${sessionId}` : null;
  }
  function designMarkerValue(at = /* @__PURE__ */ new Date()) {
    return { on: true, at: at.toISOString() };
  }
  function isDesignMarker(value) {
    return Boolean(value && typeof value === "object" && value.on === true);
  }
  function designSessionIdFromKey(key) {
    const prefix = "design/";
    return key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
  }
  var PLACEHOLDER_URL = "https://design.local/session";
  function isHttpUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
  function attachUrl(value) {
    return isHttpUrl(value) ? value : PLACEHOLDER_URL;
  }
  function fileBaseName(path) {
    const trimmed = path.replace(/[\\/]+$/, "");
    return trimmed.split(/[\\/]/).pop() || path;
  }
  function projectHttpUrl(config) {
    const url = config?.url?.trim();
    return isHttpUrl(url) ? url : null;
  }
  function projectReferenceChip(input) {
    const handle = input.projectId?.trim() || fileBaseName(input.dir);
    return {
      providerId: "design-canvas",
      id: `project-${handle}`.slice(0, 110),
      title: input.name,
      url: input.url,
      text: `Workspace reference: ${input.dir}`
    };
  }
  function fileReferenceChip(input) {
    const base = fileBaseName(input.path);
    return {
      providerId: "design-canvas",
      id: `file-${base}`.slice(0, 128),
      title: base,
      url: input.url,
      text: input.dropped ? `File reference: ${base} (dropped into Design Canvas)` : `File reference: ${input.path}`
    };
  }
  function popoverStep(current, count, delta) {
    if (count <= 0) return -1;
    if (current < 0) return delta > 0 ? 0 : count - 1;
    return (current + delta + count) % count;
  }
  function seedModeValue(type, brief, canvMode = "edit") {
    return { on: true, type, brief: brief.slice(0, 2e3), canvMode };
  }
  function seedSessionData(type, brief, workspace = null, canvMode = "edit") {
    return { mode: seedModeValue(type, brief, canvMode), workspace };
  }
  function directionLabel(value) {
    return value === "auto" ? "Auto (infer from the brief)" : DIRECTIONS[value].name;
  }
  function lookHint(look, questions) {
    if (look === "project") return "take it from the user's project (its tokens, theme and components)";
    if (look === "preset") return "use the chosen design-system preset";
    return questions ? "a new look \u2014 propose it first and confirm it with the questions" : "a new look \u2014 put its palette and type pairing in your Assumptions list";
  }
  var BRIEF_MAX = 3e3;
  function briefLimitError(brief) {
    const length = brief.trim().length;
    if (length <= BRIEF_MAX) return null;
    return `The design brief is too long (${length} characters; the limit is ${BRIEF_MAX}). Shorten it, then send again.`;
  }
  var CRAFT_BY_TYPE = {
    wireframe: ["layout", "content", "anti-slop", "states", "laws-of-ux", "responsive"],
    "hi-fi": ["layout", "typography", "color", "content", "anti-slop", "accessibility", "laws-of-ux", "responsive"],
    prototype: ["layout", "typography", "color", "content", "anti-slop", "states", "motion", "accessibility", "responsive"],
    deck: ["layout", "typography", "color", "content", "anti-slop"],
    custom: ["layout", "typography", "color", "content", "anti-slop", "accessibility", "responsive"]
  };
  var FIDELITY_FOR_TYPE = {
    wireframe: "wireframe",
    "hi-fi": "hi-fi",
    prototype: "interactive",
    deck: "hi-fi",
    custom: "hi-fi"
  };
  function structureBrief(draft, ctx = {}) {
    const text = draft.trim();
    if (/^Goal:/m.test(text)) return draft;
    const [first = "", ...rest] = text.split(/(?<=[.!?])\s+|\n+/);
    const devices = ctx.devices && ctx.devices.length ? ctx.devices.join(", ") : "ask me";
    return [
      `Goal: ${first}`,
      "Who it's for: ",
      "Primary task: ",
      "Feel / tone: ",
      "Key screens: ",
      `Devices: ${devices}`,
      "Content I have (copy, data, brand assets): ",
      "Must keep / avoid: ",
      rest.length ? `Notes: ${rest.join(" ")}` : "Notes: "
    ].join("\n");
  }
  function workspacePathRule(dir) {
    return [
      `The workspace's absolute path is ${JSON.stringify(dir)} \u2014 it is the ONLY place design files are written.`,
      `Use that absolute path in EVERY file write, edit and bash call you make, because the chat session does NOT run inside the workspace directory.`,
      `Never write design files relative to the chat's own directory, and never create another workspace folder.`
    ].join(" ");
  }
  function designSessionPrompt(spec, workspace) {
    const brief = spec.brief.trim();
    const preset = findDesignSystem(spec.designSystemId);
    const questions = spec.questions !== false;
    const agreement = { questions: spec.questions, options: spec.options };
    const projectDir = spec.projectDir?.trim();
    const lines = [
      `Design brief \u2014 ${spec.type}: ${TYPE_HINT[spec.type]}`,
      `Visual direction: ${directionLabel(spec.direction)}. Lock it before building.`,
      `Fidelity: ${spec.fidelity} \u2014 ${FIDELITY_HINT[spec.fidelity]}.`,
      agreementStatusLine({ questions: spec.questions, options: spec.options, devices: spec.devices })
    ];
    if (spec.look) lines.push(`Look: ${lookHint(spec.look, questions)}.`);
    if (projectDir) {
      lines.push(`User project: ${JSON.stringify(projectDir)} \u2014 read it first for design context; never write design files there.`);
    }
    lines.push(
      brief ? `Brief: ${brief}` : questions ? "Brief: none given \u2014 ask 3\u20136 questions with a bold recommended default each, then proceed." : "Brief: none given \u2014 state your assumptions, then build."
    );
    if (preset) {
      lines.push(
        `Design system: ${preset.name} (${preset.category}) \u2014 its tokens and DESIGN.md are authoritative; use them as given and keep every screen inside the system.`
      );
    }
    lines.push("", IDENTITY, "", workingAgreementChip(agreement), "");
    if (workspace) {
      lines.push(
        `Design Canvas workspace: ${workspace.dir}`,
        workspacePathRule(workspace.dir),
        "",
        DESIGN_WORKSPACE_NOTE,
        "",
        CANVAS_PROTOCOL
      );
    } else {
      lines.push(
        "Design Canvas workspace: created by the Design Canvas service before this prompt (ask if the path is missing).",
        "",
        CANVAS_PROTOCOL
      );
    }
    lines.push(
      "",
      DESIGN_AUTHORITY,
      "",
      defaultCraft(CRAFT_BY_TYPE[spec.type]),
      "",
      "Workflow: in the live canvas (edit mode) the user clicks elements; EACH click arrives as its own reference chip with its screen id. Sending a whole artboard from its menu arrives as a `Screen: <id> (<w>\xD7<h>) \u2014 <file>` chip with the screen URL \u2014 edit that file.",
      "",
      VERIFY_PROTOCOL,
      "",
      firstReplyContract(questions)
    );
    return lines.join("\n");
  }
  function workspaceOpenPrompt(workspace) {
    return [
      `Design Canvas workspace: ${workspace.dir}`,
      workspacePathRule(workspace.dir),
      "",
      DESIGN_WORKSPACE_NOTE,
      "",
      "Reopening this canvas: open the Design Canvas browser, then read BRIEF.md and DESIGN.md in the workspace first \u2014 they hold the agreed devices, look and chosen option. Keep to them; ask before changing any of them. The user will point at elements to change.",
      "",
      IDENTITY,
      "",
      WORKING_AGREEMENT_CHIP,
      "",
      DESIGN_AUTHORITY,
      "",
      VERIFY_PROTOCOL
    ].join("\n");
  }
  function buildModeChip(sessionId, mode, workspace, screens = [], workspaceUrl) {
    const id = `design-mode-${(sessionId || "adhoc").slice(0, 110)}`;
    const lines = [
      "Design Mode: ON",
      `Canvas mode: ${mode.canvMode}${mode.canvMode === "edit" ? " \u2014 clicking an element sends a pick chip" : " \u2014 clicks and links drive the screens"}`,
      `Artifact type: ${mode.type} \u2014 ${TYPE_HINT[mode.type]}`,
      `Visual direction: ${directionLabel(mode.direction)} \xB7 Fidelity: ${mode.fidelity}`,
      agreementStatusLine(mode),
      mode.brief ? `Brief: ${mode.brief.slice(0, 2e3)}` : "Brief: the user will say or type it next."
    ];
    if (workspace) {
      lines.push(
        `Workspace: ${workspace.dir}`,
        workspacePathRule(workspace.dir),
        "",
        DESIGN_WORKSPACE_NOTE,
        "",
        CANVAS_PROTOCOL_CHIP
      );
    } else {
      lines.push("Workspace: the Design Canvas service creates it on /canvas \u2014 do not write design files anywhere else.");
    }
    if (screens.length > 0) {
      const shown = screens.slice(0, MODE_CHIP_SCREEN_CAP);
      lines.push(`Screens (${screens.length}):`);
      for (const screen of shown) lines.push(`- ${screen.id} \xB7 ${(screen.title || screen.file).slice(0, 60)} \xB7 ${screen.file}`);
      if (screens.length > MODE_CHIP_SCREEN_CAP) {
        lines.push(`\u2026 ${screens.length - MODE_CHIP_SCREEN_CAP} more \u2014 every screen is reachable through the canvas; the full registry is screens.json at the workspace root.`);
      }
    } else {
      lines.push("Screens: none yet \u2014 add a screen by writing `<file>.html` and adding `{id, file, title, width, height}` to screens.json at the workspace root.");
    }
    lines.push("", IDENTITY, "", workingAgreementChip({ questions: mode.questions, options: mode.options }), "", DESIGN_AUTHORITY, "", VERIFY_PROTOCOL);
    return {
      providerId: "design-canvas",
      id,
      title: `Design Mode \xB7 ${mode.type}`,
      url: attachUrl(workspaceUrl ?? void 0),
      text: lines.join("\n").slice(0, GUEST_ATTACH_TEXT_MAX2),
      data: {
        mode: {
          on: true,
          type: mode.type,
          direction: mode.direction,
          fidelity: mode.fidelity,
          canvMode: mode.canvMode,
          brief: mode.brief.slice(0, 2e3),
          ...mode.questions !== void 0 ? { questions: mode.questions } : {},
          ...mode.options !== void 0 ? { options: mode.options } : {},
          ...mode.devices !== void 0 ? { devices: mode.devices.slice() } : {}
        },
        workspace: workspace ? { dir: workspace.dir, name: workspace.name } : null,
        screens: screens.slice(0, MODE_CHIP_SCREEN_CAP).map((screen) => ({
          id: screen.id,
          file: screen.file,
          title: screen.title
        }))
      }
    };
  }
  function buildCompactModeChip(sessionId, mode, workspace, screens = [], workspaceUrl) {
    const full = buildModeChip(sessionId, mode, workspace, screens, workspaceUrl);
    const lines = [
      "Design Mode: ON \u2014 every pick below is a design request for this workspace.",
      `Canvas mode: ${mode.canvMode} \xB7 Artifact type: ${mode.type}`,
      `Workspace: ${workspace.dir}`,
      workspacePathRule(workspace.dir),
      workingAgreementCompact({ questions: mode.questions })
    ];
    if (screens.length > 0) {
      const shown = screens.slice(0, MODE_CHIP_SCREEN_CAP);
      lines.push(`Screens (${screens.length}):`);
      for (const screen of shown) lines.push(`- ${screen.id} \xB7 ${screen.file}`);
      if (screens.length > MODE_CHIP_SCREEN_CAP) lines.push(`\u2026 ${screens.length - MODE_CHIP_SCREEN_CAP} more in screens.json at the workspace root.`);
    }
    return { ...full, text: lines.join("\n").slice(0, GUEST_ATTACH_TEXT_MAX2) };
  }
  var EXPORT_SUMMARY_FILE_CAP = 4;
  var EXPORT_SUMMARY_FAILURE_CAP = 3;
  function parseCanvasExportArgs(raw) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return {};
    const formats = [];
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (lower !== "png" && lower !== "pdf") {
        return { error: `Unknown export format "${token}" \u2014 use png, pdf, or both.` };
      }
      if (!formats.includes(lower)) formats.push(lower);
    }
    return { formats };
  }
  function exportJobSummary(status) {
    const pngOk = [];
    let pdfCount = 0;
    const failedScreens = [];
    for (const row of status.results ?? []) {
      if (row.png) {
        if (row.png.ok) pngOk.push(row.png.file);
        else if (!failedScreens.includes(row.screen)) failedScreens.push(row.screen);
      }
      if (row.pdf) {
        if (row.pdf.ok) pdfCount += 1;
        else if (!failedScreens.includes(row.screen)) failedScreens.push(row.screen);
      }
    }
    const parts = [];
    const total = (status.results ?? []).length;
    parts.push(`Export done: ${total} screen${total === 1 ? "" : "s"}`);
    const kinds = [];
    if (pngOk.length > 0) kinds.push(`${pngOk.length} PNG`);
    if (pdfCount > 0) kinds.push(`${pdfCount} PDF`);
    parts.push(kinds.length > 0 ? kinds.join(" + ") : "0 files");
    if (failedScreens.length > 0) {
      const shown = failedScreens.slice(0, EXPORT_SUMMARY_FAILURE_CAP).join(", ");
      parts.push(`${failedScreens.length} failed (${shown}${failedScreens.length > EXPORT_SUMMARY_FAILURE_CAP ? ", \u2026" : ""})`);
    }
    const lines = [parts.join(" \xB7 ")];
    if (pngOk.length > 0) {
      const shown = pngOk.slice(0, EXPORT_SUMMARY_FILE_CAP);
      const more = pngOk.length - shown.length;
      lines.push(`PNG: ${shown.join(", ")}${more > 0 ? `, \u2026 +${more} more` : ""}`);
    }
    return lines;
  }
  function exportFailureSummary(status) {
    const failed = (status.results ?? []).filter((row) => row.png?.ok === false || row.pdf?.ok === false);
    if (failed.length === 0) return "Export failed.";
    const shown = failed.slice(0, EXPORT_SUMMARY_FAILURE_CAP).map((row) => {
      const error = row.png?.ok === false ? row.png.error : row.pdf?.ok === false ? row.pdf.error : void 0;
      return error ? `${row.screen} (${error})` : row.screen;
    }).join(", ");
    return `Export failed: ${failed.length} screen${failed.length === 1 ? "" : "s"} \u2014 ${shown}${failed.length > EXPORT_SUMMARY_FAILURE_CAP ? ", \u2026" : ""}`;
  }
  var CRITIQUE_ADVISORY = "The 0\u201310 critique is advisory only; never treat it as pass/fail and never optimise for it.";
  function critiqueReviewText(digest) {
    const lines = ["Canvas critique \u2014 deterministic gate digest (advisory):"];
    for (const screen of digest.screens) {
      lines.push(`- ${screen.screen} \xB7 ${screen.width}\xD7${screen.height} \xB7 ${screen.state === "ready" ? "ready" : screen.state} \xB7 ${screen.url}`);
      if (screen.gates && screen.gates.length > 0) {
        for (const gate of screen.gates) {
          const findings = (gate.findings ?? []).slice(0, 3).join("; ");
          lines.push(`    ${gate.id}: ${gate.status}${findings ? ` \u2014 ${findings}` : ""}`);
        }
      } else {
        lines.push("    no gate findings");
      }
    }
    if (digest.truncated) lines.push("\u2026 more screens exist; the digest covers the first 12 (service-bound).");
    lines.push("", CRITIQUE_ADVISORY);
    return lines.join("\n");
  }
  function critiqueReviewChip(sessionId, workspaceUrl, digest) {
    const id = `canvas-critique-${(sessionId || "adhoc").slice(0, 110)}`;
    return {
      providerId: "design-canvas",
      id,
      title: "Canvas critique \u2014 gate digest",
      url: attachUrl(workspaceUrl ?? void 0),
      text: critiqueReviewText(digest).slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
  }

  // panel/reference-draft.ts
  function addDraftReference(existing, reference) {
    if (existing.some((item) => item.kind === reference.kind && item.path === reference.path)) return [...existing];
    return [...existing, { ...reference }];
  }
  function removeDraftReference(existing, id) {
    return existing.filter((item) => item.id !== id);
  }
  var PAYLOAD_LIMIT = 16e3;
  function buildReferenceSubmission(text, data, references) {
    let submittedText = text;
    let submittedData = data;
    if (references.length > 0) {
      const retained = references.map((reference) => ({ ...reference }));
      submittedText += "\n\nDesign Canvas references (paths only; no file contents uploaded):\n" + retained.map(
        (reference) => `- ${reference.kind}: ${JSON.stringify(reference.path)}; source directory: ${JSON.stringify(reference.sourceDirectory)}; label: ${JSON.stringify(reference.label)}`
      ).join("\n");
      submittedData = data !== null && typeof data === "object" && !Array.isArray(data) ? { ...data, references: retained } : { ...data === void 0 ? {} : { baseData: data }, references: retained };
    }
    if (submittedText.length > PAYLOAD_LIMIT) {
      throw new Error("Design prompt exceeds 16000 characters. Shorten the brief or remove references before sending.");
    }
    let serialized;
    try {
      serialized = JSON.stringify(submittedData);
    } catch {
      throw new Error("Design metadata must be serializable JSON. Remove invalid reference metadata before sending.");
    }
    if (serialized !== void 0 && serialized.length > PAYLOAD_LIMIT) {
      throw new Error("Design metadata exceeds 16000 JSON characters. Shorten the brief or remove references before sending.");
    }
    return { text: submittedText, data: submittedData };
  }

  // panel/attach-dialog.ts
  function fileFromUrl(raw) {
    try {
      const pathname = decodeURIComponent(new URL(raw).pathname).replace(/^\/+/, "");
      return pathname === "" ? "index.html" : pathname;
    } catch {
      return null;
    }
  }
  function pickFilePath(pick, context) {
    if (pick.kind === "screen" && typeof pick.file === "string" && pick.file.trim() !== "") {
      return workspaceFilePath(context.workspaceDir, pick.file);
    }
    const screen = context.screens?.find((candidate) => candidate.id === pick.screen);
    const file = (screen ? fileFromUrl(screen.url) : null) ?? (pick.screenUrl ? fileFromUrl(pick.screenUrl) : null);
    return file ? workspaceFilePath(context.workspaceDir, file) : null;
  }
  function pickLocationLines(pick, context) {
    const dir = context?.workspaceDir?.trim();
    if (!context || !dir) return [];
    const file = pickFilePath(pick, context);
    return [
      `Workspace: ${dir}`,
      ...file ? [`File: ${file}`] : [],
      workspacePathRule(dir)
    ];
  }
  var TRUNCATED_MARKUP = "<!-- markup truncated to fit the chat chip -->";
  function boundedElementText(pick, url, pickedAt, screen, location) {
    const full = referenceText(pick, url, pickedAt, screen, location);
    if (full.length <= GUEST_ATTACH_TEXT_MAX2) return full;
    const overflow = full.length - GUEST_ATTACH_TEXT_MAX2;
    const keep = Math.max(0, pick.outerHTML.length - overflow - TRUNCATED_MARKUP.length - 1);
    const trimmedMarkup = { ...pick, outerHTML: `${pick.outerHTML.slice(0, keep)}
${TRUNCATED_MARKUP}` };
    const shorter = referenceText(trimmedMarkup, url, pickedAt, screen, location);
    if (shorter.length <= GUEST_ATTACH_TEXT_MAX2) return shorter;
    const noStyles = referenceText({ ...trimmedMarkup, outerHTML: TRUNCATED_MARKUP, styles: {} }, url, pickedAt, screen, location);
    return noStyles.slice(0, GUEST_ATTACH_TEXT_MAX2);
  }
  function buildAttachPayload(pick, context) {
    const location = pickLocationLines(pick, context);
    const workspaceDir2 = location.length > 0 ? context.workspaceDir.trim() : null;
    const filePath = workspaceDir2 ? pickFilePath(pick, context) : null;
    if (pick.kind === "screen") {
      const pickedAt2 = Number.isFinite(pick.at) ? new Date(pick.at) : void 0;
      return {
        providerId: "design-canvas",
        id: `screen-${pick.seq}`,
        title: `Screen \xB7 ${pick.screen}`,
        url: pick.screenUrl,
        text: screenReferenceText(pick, pickedAt2, location).slice(0, GUEST_ATTACH_TEXT_MAX2),
        data: {
          screen: pick.screen,
          screenUrl: pick.screenUrl,
          width: pick.width,
          height: pick.height,
          file: pick.file,
          url: pick.screenUrl,
          ...workspaceDir2 ? { workspace: workspaceDir2 } : {},
          ...filePath ? { filePath } : {}
        }
      };
    }
    const url = pick.screenUrl;
    const screen = pick.screen ? { id: pick.screen, url } : void 0;
    const pickedAt = Number.isFinite(pick.at) ? new Date(pick.at) : void 0;
    const data = {
      selector: pick.selector ?? "",
      tag: pick.tag ?? "",
      classes: pick.classes ?? "",
      snippet: pick.outerHTML ?? "",
      styles: pick.styles ?? {},
      url
    };
    if (screen) {
      data.screen = screen.id;
      data.screenUrl = screen.url;
    }
    if (workspaceDir2) data.workspace = workspaceDir2;
    if (filePath) data.filePath = filePath;
    return {
      providerId: "design-canvas",
      id: `element-${pick.seq}`,
      title: pick.selector ?? "",
      url,
      text: boundedElementText(
        {
          selector: pick.selector ?? "",
          tag: pick.tag ?? "",
          classes: pick.classes ?? "",
          text: pick.text ?? "",
          outerHTML: pick.outerHTML ?? "",
          styles: pick.styles ?? {},
          rect: pick.rect ?? { x: 0, y: 0, width: 0, height: 0 }
        },
        url,
        pickedAt,
        screen,
        location
      ),
      data
    };
  }

  // panel/main.ts
  var POLL_MS = 900;
  var PAGE_TYPE_LABELS = {
    wireframe: "Wireframe",
    "hi-fi": "Hi-fi screens",
    prototype: "Prototype",
    deck: "Slide deck",
    custom: "Custom"
  };
  var STARTERS = [
    { type: "hi-fi", title: "Landing page", description: "Hero, proof, one call to action", glyph: "desktop", prompt: "Goal: a landing page that gets visitors to start a trial.\nKey screens: home\nDevices: phone, desktop" },
    { type: "hi-fi", title: "Settings & account", description: "Profile, billing, notifications", glyph: "desktop", prompt: "Goal: account settings for an existing app.\nKey screens: profile, billing, notifications\nDevices: desktop" },
    { type: "hi-fi", title: "Dashboard home", description: "The first screen after sign-in", glyph: "desktop", prompt: "Goal: a dashboard home that shows what needs attention today.\nKey screens: dashboard\nDevices: desktop, tablet" },
    { type: "wireframe", title: "Checkout flow", description: "Cart to confirmation", glyph: "phone", prompt: "Goal: map the checkout from cart to confirmation.\nKey screens: cart, details, payment, confirmation\nDevices: phone" },
    { type: "wireframe", title: "Onboarding", description: "Sign-up to first value", glyph: "phone", prompt: "Goal: onboarding from sign-up to the first useful moment.\nKey screens: welcome, sign-up, setup, first task\nDevices: phone" },
    { type: "wireframe", title: "App navigation", description: "Tabs, menus, top-level screens", glyph: "phone", prompt: "Goal: the top-level navigation and where each screen lives.\nDevices: phone, desktop" },
    { type: "prototype", title: "Booking flow", description: "Pick a slot, confirm, pay", glyph: "phone", prompt: "Goal: a clickable booking flow.\nKey screens: pick a date, pick a slot, confirm, paid\nDevices: phone" },
    { type: "prototype", title: "Data table", description: "Filter, sort, inspect a row", glyph: "desktop", prompt: "Goal: a working table with filters, sorting and a row detail panel.\nDevices: desktop" },
    { type: "prototype", title: "Sign-in", description: "Email, code, errors", glyph: "phone", prompt: "Goal: a sign-in flow with every state: idle, sending, wrong code, locked.\nDevices: phone, desktop" },
    { type: "deck", title: "Product review", description: "Results, learnings, next bets", glyph: "slide", prompt: "Goal: a quarterly product review deck.\nSlides: title, results, learnings, next bets, asks" },
    { type: "deck", title: "Pitch", description: "Problem, solution, proof, ask", glyph: "slide", prompt: "Goal: a short pitch deck.\nSlides: problem, solution, proof, pricing, ask" },
    { type: "deck", title: "Onboarding guide", description: "A new hire's first week", glyph: "slide", prompt: "Goal: a first-week guide for new hires.\nSlides: welcome, team, tools, week plan, contacts" },
    { type: "custom", title: "From my project", description: "Redesign a screen you already have", glyph: "desktop", prompt: "Goal: redesign one existing screen in my project.\nScreen: \nKeep: " },
    { type: "custom", title: "Social post", description: "1080\xD71080 artboards", glyph: "square", prompt: "Goal: three social posts for a launch.\nSize: 1080\xD71080" },
    { type: "custom", title: "Print page", description: "A4 at 96 dpi", glyph: "page", prompt: "Goal: a one-page A4 flyer.\nSize: 794\xD71123" }
  ];
  var WORK_LIST_CAP = 5;
  var BRIEF_COUNTER_FROM = 2e3;
  var PAGE_PREFS_KEY = "prefs/page";
  var PERMISSION_TOAST_KEY = "ws-permission-notified";
  var PERMISSION_HEADS_UP = "The agent edits the Design Canvas workspace, which lives outside the chat folder \u2014 approve its file-edit permission prompts so it can write the design files.";
  var state = {
    surface: "panel",
    /** The chat's own directory. The CANVAS session deliberately runs OUTSIDE the workspace (decision 4). */
    directory: null,
    sessionId: null,
    mode: { ...DEFAULT_MODE },
    resolveAllowed: false,
    /** This session's canvas workspace (`ws/<sessionId>`), or null before the first use. */
    workspace: null,
    /** The workspace's `.design-studio.json`, read by the service for the workspace dir. */
    config: null,
    configPath: null,
    /**
     * The workspace dir `config` was read for. `onDirectory` keeps the last config
     * until the fresh read resolves, so a stale cached config is only ever used
     * when it belongs to the CURRENT workspace (`currentConfig()`).
     */
    configDir: null,
    url: "about:blank",
    title: "",
    windowOpen: false,
    /** True while OUR side is bringing the window up (see openCanvasWindow). */
    pendingOpen: false,
    /**
     * V4-4: the last `/state.registryError` message we toasted while the condition
     * held. Null clears the arm, so a fixed-then-rebroken registry toasts again.
     */
    registryErrorNotified: null,
    /** The live canvas controls from `GET /state` (spec §B). */
    liveMode: "edit",
    liveScreens: [],
    activeScreen: null,
    /** The current session's live `SessionSnapshot.busy`, from `host.onSession`. */
    sessionBusy: false,
    /** Workspace dirs whose dev server THIS panel started (`/open` reported `started`). */
    startedServers: /* @__PURE__ */ new Set(),
    /**
     * A stop waiting for the session to go idle (Design Mode OFF happened while
     * busy). The queued REQUEST — its directory and manual mode — is preserved.
     */
    pendingStop: null,
    /** Current preview-dev-server reachability for the row's Start/Stop control. */
    serverStatus: null,
    /** True while a manual start/stop is in flight. */
    serverPending: false,
    /** Last error from a server start/status action (for screen-reader announcement). */
    serverError: null,
    // ---- full-page creation surface ----
    /** The workspaces list (GET /workspaces joined with the cached ws/ scan). */
    workspaces: null,
    /** The selected creation type; drives the type chip, the fidelity and the session title. */
    pageType: "hi-fi",
    /** The Look chip's direction (its Directions tab), or Auto. */
    pageDirection: "auto",
    /** Where the look comes from; null = the default (Project with a project open, else Directions). */
    pageLookKind: null,
    /** "Ask me questions first". */
    pageQuestions: true,
    /** How many side-by-side directions, or 'ask'. */
    pageOptions: "ask",
    /** The device artboards; empty = "Ask me — detect from the project". */
    pageDevices: [],
    prompt: "",
    references: [],
    /** An actionable error from a failed scaffold (the session still starts). */
    pageError: "",
    pageBusy: false,
    /** The one composer overlay open right now, or null. */
    overlay: null,
    /** The Look popover's visible tab. */
    lookTab: "directions",
    /** "Your design work" shows every row instead of the first WORK_LIST_CAP. */
    workShowAll: false,
    /** The chosen design-system preset id (the Look chip's Presets tab), or null. */
    pageDesignSystemId: null
  };
  var REAL_PANE_MIN_PX = 64;
  function isRealPane() {
    const width = typeof window.innerWidth === "number" ? window.innerWidth : 0;
    const height = typeof window.innerHeight === "number" ? window.innerHeight : 0;
    return width >= REAL_PANE_MIN_PX && height >= REAL_PANE_MIN_PX;
  }
  function isHiddenResolvePane() {
    return state.surface === "panel" && !isRealPane();
  }
  var hintEl;
  var sessionLineEl = null;
  var pageBody = null;
  var statusRoot = null;
  var modeToggleBtn = null;
  var barEl = null;
  var serverBtn = null;
  var playToggleBtn = null;
  var screenSelectEl = null;
  var focusLiveBtn = null;
  var serverAnnounceEl = null;
  var promptEl = null;
  var sendEl = null;
  var counterEl = null;
  var pageLocationEl = null;
  var pageEnter = true;
  var dsQuery = "";
  var dsHighlight = null;
  var attachPathDraft = "";
  var referenceError = "";
  var referencePending = false;
  var referenceSlow = false;
  var referenceRequest = 0;
  var referenceLiveEl = null;
  var referenceFocusId = null;
  var DROP_PATH_MESSAGE = "Paste an accessible file path using + \u2192 File path. Dropped filenames do not include their filesystem path.";
  var wsSessionMap = /* @__PURE__ */ new Map();
  var allProjects = [];
  function announceReference(message) {
    if (!referenceLiveEl) return;
    referenceLiveEl.textContent = "";
    queueMicrotask(() => {
      if (referenceLiveEl) referenceLiveEl.textContent = message;
    });
  }
  function cancelReferenceValidation() {
    referenceRequest += 1;
    referencePending = false;
    referenceSlow = false;
  }
  var configReadInFlight = false;
  function q(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }
  function option(value, label) {
    const node = q("option");
    node.value = value;
    node.textContent = label;
    return node;
  }
  var lastStatus = "";
  function setStatus(message, kind = "info") {
    if (kind === "info") return;
    if (message === lastStatus) return;
    lastStatus = message;
    void host.toast({ kind: kind === "error" ? "error" : "info", message });
  }
  function lastUrlKey(dir) {
    return dir ? `lastUrl/${dir}` : null;
  }
  async function loadLastUrl(dir) {
    const key = lastUrlKey(dir);
    if (!key) return null;
    try {
      const value = await host.storage.get(key);
      return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
    } catch {
      return null;
    }
  }
  async function saveLastUrl(dir, url) {
    const key = lastUrlKey(dir);
    if (!key) return;
    try {
      await host.storage.set(key, url);
    } catch {
    }
  }
  async function readStoredWorkspace(sessionId) {
    const key = workspaceStorageKey(sessionId);
    if (!key) return null;
    try {
      const value = await host.storage.get(key);
      if (isWorkspaceRecord(value)) {
        const name = typeof value.name === "string" && value.name.trim() !== "" ? value.name.trim().slice(0, 80) : value.dir;
        return { dir: value.dir, name };
      }
    } catch {
    }
    return null;
  }
  async function loadWorkspace() {
    const record = await readStoredWorkspace(state.sessionId);
    if (record) {
      state.workspace = record;
      state.configDir = null;
      state.config = null;
      renderRow();
      rerender();
      void loadStudioConfig();
    }
  }
  async function saveWorkspaceRecord(sessionId, record) {
    const key = workspaceStorageKey(sessionId);
    if (!key) return;
    try {
      await host.storage.set(key, record);
    } catch {
    }
  }
  function workspaceDisplayName(brief, slug) {
    const words = brief.trim().replace(/\s+/g, " ").slice(0, 60);
    if (words) return words;
    return slug.replace(/-+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) || "Canvas";
  }
  async function maybeShowPermissionToast(dir) {
    if (state.directory && sameDirPath(dir, state.directory)) return;
    try {
      const seen = await host.storage.get(PERMISSION_TOAST_KEY);
      if (seen === true) return;
      await host.storage.set(PERMISSION_TOAST_KEY, true);
    } catch {
      return;
    }
    await host.toast({ kind: "info", message: PERMISSION_HEADS_UP });
  }
  function modeScaffoldChoice(type) {
    return {
      type: type ?? state.mode.type,
      direction: state.mode.direction,
      fidelity: state.mode.fidelity,
      designSystemId: state.pageDesignSystemId
    };
  }
  async function scaffoldCanvasWorkspace(brief, seed, choice, options = {}) {
    const notify = options.notify ?? true;
    let result;
    try {
      result = await getWorkspaces();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (notify) await host.toast({ kind: "error", message: `Could not list canvas workspaces: ${message}` });
      return { ok: false, error: `Could not list canvas workspaces: ${message}` };
    }
    const slug = uniqueCanvasSlug(brief || "canvas", seed, result.workspaces.map((row) => row.dir));
    const dir = joinWorkspaceDir(result.root, slug);
    const name = workspaceDisplayName(brief, slug);
    let scaffold;
    try {
      scaffold = await scaffoldProject(dir, {
        type: choice.type,
        direction: choice.direction,
        fidelity: choice.fidelity,
        brief: brief || void 0,
        // Omitted for "No design system" so the request stays as before.
        designSystemId: choice.designSystemId ?? void 0,
        // The service forwards both to the scaffold (R4); omitted when not chosen.
        ...choice.devices?.length ? { devices: choice.devices } : {},
        ...choice.projectDir ? { projectDir: choice.projectDir } : {}
      });
    } catch (error) {
      scaffold = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!scaffold.ok) {
      if (notify) await host.toast({ kind: "error", message: scaffold.error });
      return { ok: false, error: scaffold.error };
    }
    await maybeShowPermissionToast(dir);
    return { ok: true, record: { dir: scaffold.dir || dir, name }, jobId: scaffold.jobId, url: scaffold.url };
  }
  var SCAFFOLD_POLL_MS = 2e3;
  var SCAFFOLD_TOAST_STEP_MS = 1e4;
  var SCAFFOLD_MAX_MS = 15 * 6e4;
  async function runScaffoldJob(jobId, dir, timing = {}) {
    const pollMs = timing.pollMs ?? SCAFFOLD_POLL_MS;
    const maxMs = timing.maxMs ?? SCAFFOLD_MAX_MS;
    const start = Date.now();
    let lastKey = "";
    for (; ; ) {
      let job;
      try {
        job = await getScaffoldStatus(jobId, dir);
      } catch (error) {
        const message = `Canvas setup failed: the job status could not be read (${error instanceof Error ? error.message : String(error)}).`;
        await host.toast({ kind: "error", message });
        return { error: message };
      }
      if (job?.state !== "installing" && job?.state !== "booting" && job?.state !== "done" && job?.state !== "failed") {
        const reason = job?.error;
        const message = `Canvas setup status is unavailable${typeof reason === "string" && reason ? ` (${reason})` : ""} \u2014 the workspace files exist; press Start to try opening it.`;
        await host.toast({ kind: "error", message });
        return { error: message };
      }
      if (job.state === "done") {
        await host.toast({ kind: "success", message: scaffoldProgressText(job) });
        return "done";
      }
      if (job.state === "failed") {
        const message = scaffoldProgressText(job);
        await host.toast({ kind: "error", message });
        return { error: message };
      }
      const key = `${job.state}:${Math.floor((job.elapsedMs ?? 0) / SCAFFOLD_TOAST_STEP_MS)}`;
      if (key !== lastKey) {
        lastKey = key;
        await host.toast({ kind: "info", message: scaffoldProgressText(job) });
      }
      if (Date.now() - start >= maxMs) {
        const message = "Canvas setup is taking unusually long \u2014 the workspace files exist; press Start to try opening it.";
        await host.toast({ kind: "error", message });
        return { error: message };
      }
      await sleep(pollMs);
    }
  }
  async function ensureCanvasWorkspace(brief, forSessionId = null, choice) {
    const prepared = await prepareCanvasWorkspace(brief, forSessionId ?? state.sessionId, choice ?? modeScaffoldChoice());
    if ("error" in prepared) return null;
    if (!prepared.jobId) return prepared.record;
    const job = await runScaffoldJob(prepared.jobId, prepared.record.dir);
    if (job !== "done") return null;
    return prepared.record;
  }
  async function prepareCanvasWorkspace(brief, sessionId, choice, options = {}) {
    if (state.workspace && state.workspace.dir.trim() !== "") return { record: state.workspace, jobId: null, url: null };
    const stored = await readStoredWorkspace(sessionId);
    if (stored) {
      if (!state.workspace) {
        state.workspace = stored;
        renderRow();
        rerender();
      }
      return { record: stored, jobId: null, url: null };
    }
    if (!sessionId) {
      return { error: NO_SESSION_MESSAGE, noSession: true };
    }
    const outcome = await scaffoldCanvasWorkspace(brief, sessionId, choice, options);
    if (!outcome.ok) return { error: outcome.error };
    await saveWorkspaceRecord(sessionId, outcome.record);
    state.workspace = outcome.record;
    renderRow();
    rerender();
    return { record: outcome.record, jobId: outcome.jobId, url: outcome.url };
  }
  var NO_SESSION_MESSAGE = "Start this chat by sending any message first, then run /canvas again.";
  var NO_SESSION_HINT = "Send a message to start this chat first";
  function modeStoragePayload() {
    return {
      on: state.mode.on,
      type: state.mode.type,
      direction: state.mode.direction,
      fidelity: state.mode.fidelity,
      canvMode: state.mode.canvMode,
      brief: state.mode.brief.slice(0, 2e3)
    };
  }
  var modeWriteGeneration = 0;
  async function saveMode() {
    const key = modeStorageKey(state.sessionId);
    if (!key) return;
    modeWriteGeneration += 1;
    try {
      await host.storage.set(key, modeStoragePayload());
    } catch {
    }
  }
  function applyStoredMode(stored) {
    if (!stored || typeof stored !== "object") return;
    const value = stored;
    state.mode.on = Boolean(value.on);
    if (DESIGN_TYPES.includes(value.type)) state.mode.type = value.type;
    if (value.direction !== void 0 && (value.direction === "auto" || value.direction in DIRECTIONS)) state.mode.direction = value.direction;
    if (FIDELITIES.includes(value.fidelity)) state.mode.fidelity = value.fidelity;
    if (value.canvMode === "play" || value.canvMode === "edit") state.mode.canvMode = value.canvMode;
    state.mode.brief = typeof value.brief === "string" ? value.brief : "";
  }
  async function syncModeFromStorage() {
    const key = modeStorageKey(state.sessionId);
    if (!key) return state.mode.on;
    const generation = modeWriteGeneration;
    const sessionId = state.sessionId;
    let stored;
    try {
      stored = await host.storage.get(key);
    } catch {
      return state.mode.on;
    }
    if (generation !== modeWriteGeneration || sessionId !== state.sessionId) return state.mode.on;
    if (!stored || typeof stored !== "object") return state.mode.on;
    const value = stored;
    const differs = Boolean(value.on) !== state.mode.on || DESIGN_TYPES.includes(value.type) && value.type !== state.mode.type || typeof value.brief === "string" && value.brief !== state.mode.brief;
    if (differs) {
      applyStoredMode(stored);
      renderModeUi();
    }
    return state.mode.on;
  }
  async function writeDesignMarker() {
    const key = designMarkerKey(state.sessionId);
    if (!key) return;
    try {
      await host.storage.set(key, designMarkerValue());
    } catch {
    }
  }
  async function loadMode() {
    const key = modeStorageKey(state.sessionId);
    if (!key) return;
    try {
      applyStoredMode(await host.storage.get(key));
    } catch {
    }
    renderModeUi();
  }
  var pendingOpenHoldSeq = 0;
  async function toggleMode(next, type, brief) {
    const wasOn = state.mode.on;
    state.mode.on = next;
    if (type) state.mode.type = type;
    if (brief !== void 0 && brief !== "") state.mode.brief = brief;
    const hold = next ? ++pendingOpenHoldSeq : 0;
    if (hold) state.pendingOpen = true;
    try {
      await saveMode();
      if (next && !wasOn) await writeDesignMarker();
      renderModeUi();
      if (next) {
        const ws = await ensureCanvasWorkspace("");
        if (!ws) return;
        if (state.windowOpen) {
          try {
            await focusLive();
          } catch (error) {
            setStatus(`Focus failed: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
        } else {
          await openCanvasWindow(false);
        }
      } else {
        try {
          await closeLive();
        } catch {
        }
        try {
          await requestDevServerStop();
        } catch {
        }
      }
    } finally {
      if (hold && hold === pendingOpenHoldSeq) state.pendingOpen = false;
    }
  }
  function currentScreens() {
    return state.liveScreens.map((screen) => ({
      id: screen.id,
      title: screen.title,
      file: screen.url.replace(/[?#].*$/, "").split("/").pop() || `${screen.id}.html`
    }));
  }
  async function resolveCanvasCommand(args) {
    if (!state.resolveAllowed) return null;
    const [head = "", ...rest] = args.trim().split(/\s+/);
    if (/^export$/i.test(head)) {
      await canvasExportCommand(rest.join(" "));
      return null;
    }
    if (/^critique$/i.test(head)) {
      return await canvasCritiqueCommand();
    }
    const parsed = parseDesignArgs(args);
    if (!parsed.on) {
      await toggleMode(false);
      await host.toast({ kind: "info", message: "Design Mode is off." });
      return null;
    }
    if (!state.sessionId) throw new Error(NO_SESSION_MESSAGE);
    if (parsed.mode) {
      try {
        const result = await setMode(parsed.mode);
        if (result.ok === false && result.error) setStatus(result.error, "error");
        else state.liveMode = parsed.mode;
      } catch (error) {
        setStatus(`Could not switch the canvas mode: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
      state.mode.canvMode = parsed.mode;
      await saveMode();
    }
    const ws = await prepareCanvasWorkspace(parsed.brief, state.sessionId, modeScaffoldChoice(parsed.type), { notify: false });
    if ("error" in ws) throw new Error(ws.error);
    await armDesignModeForRow(ws, parsed.type, parsed.brief || void 0);
    const url = await readWorkspaceUrl(ws.record.dir) ?? ws.url ?? void 0;
    return buildModeChip(state.sessionId, state.mode, state.workspace, currentScreens(), url);
  }
  async function readWorkspaceUrl(dir) {
    const cached = currentConfig()?.url?.trim();
    if (cached) return cached;
    try {
      const read = await getConfig(dir);
      if (state.workspace?.dir === dir) {
        state.config = read.config;
        state.configPath = read.path;
        state.configDir = dir;
      }
      return read.config?.url?.trim() || null;
    } catch {
      return null;
    }
  }
  var OPEN_HANDOFF_MAX_AGE_MS = 5 * 6e4;
  var OPEN_HANDOFF_SETTLE_MS = 5e3;
  function openHandoffKey(sessionId) {
    return sessionId ? `canvas-open/${sessionId}` : null;
  }
  function isOpenHandoff(value) {
    if (!value || typeof value !== "object") return false;
    const record = value;
    return typeof record.dir === "string" && record.dir.trim() !== "" && (record.jobId === null || typeof record.jobId === "string") && typeof record.at === "number" && Number.isFinite(record.at);
  }
  async function writeOpenHandoff(sessionId, dir, jobId) {
    const key = openHandoffKey(sessionId);
    if (!key) return;
    const handoff = { dir, jobId, at: Date.now() };
    try {
      await host.storage.set(key, handoff);
    } catch {
    }
  }
  async function armDesignModeForRow(ws, type, brief) {
    await writeOpenHandoff(state.sessionId, ws.record.dir, ws.jobId);
    state.mode.on = true;
    if (type) state.mode.type = type;
    if (brief !== void 0 && brief !== "") state.mode.brief = brief;
    await saveMode();
    const markerKey = designMarkerKey(state.sessionId);
    let marked = false;
    if (markerKey) {
      try {
        marked = isDesignMarker(await host.storage.get(markerKey));
      } catch {
        marked = false;
      }
    }
    if (!marked) await writeDesignMarker();
    renderModeUi();
  }
  var handoffInFlight = false;
  var handoffTask = null;
  async function beginOpenHandoff(timing = {}) {
    if (isHiddenResolvePane()) return null;
    if (handoffInFlight) return handoffTask ? { task: handoffTask } : null;
    const key = openHandoffKey(state.sessionId);
    if (!key) return null;
    let handoff;
    try {
      handoff = await host.storage.get(key);
    } catch {
      return null;
    }
    if (handoffInFlight) return handoffTask ? { task: handoffTask } : null;
    if (!isOpenHandoff(handoff)) return null;
    const pending = handoff;
    const age = Date.now() - pending.at;
    if (!state.mode.on) await syncModeFromStorage();
    if (!state.mode.on && age >= 0 && age < OPEN_HANDOFF_SETTLE_MS) return null;
    handoffInFlight = true;
    const hold = ++pendingOpenHoldSeq;
    state.pendingOpen = true;
    try {
      await host.storage.delete(key);
    } catch {
    }
    const sessionId = state.sessionId;
    handoffTask = (async () => {
      try {
        if (!state.mode.on || age > OPEN_HANDOFF_MAX_AGE_MS) return "skipped";
        if (!state.workspace || !sameDirPath(state.workspace.dir, pending.dir)) {
          const stored = await readStoredWorkspace(sessionId);
          if (stored && sameDirPath(stored.dir, pending.dir)) bindWorkspace(stored);
        }
        if (!state.workspace || !sameDirPath(state.workspace.dir, pending.dir)) return "failed";
        if (pending.jobId) {
          const job = await runScaffoldJob(pending.jobId, pending.dir, timing);
          if (job !== "done") return "failed";
        }
        if (!state.mode.on || state.sessionId !== sessionId) return "skipped";
        if (state.windowOpen) {
          try {
            await focusLive();
          } catch (error) {
            setStatus(`Focus failed: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
        } else {
          await openCanvasWindow(false);
        }
        return "opened";
      } finally {
        handoffInFlight = false;
        if (hold === pendingOpenHoldSeq) state.pendingOpen = false;
      }
    })();
    return { task: handoffTask };
  }
  async function runOpenHandoff(timing = {}) {
    const claimed = await beginOpenHandoff(timing);
    return claimed ? await claimed.task : "none";
  }
  function bindWorkspace(record) {
    state.workspace = record;
    state.configDir = null;
    state.config = null;
    renderRow();
    rerender();
    void loadStudioConfig();
  }
  async function syncRowFromStorage() {
    const sessionId = state.sessionId;
    if (!sessionId) return;
    const record = await readStoredWorkspace(sessionId);
    if (record && sessionId === state.sessionId && !(state.workspace && sameDirPath(state.workspace.dir, record.dir))) {
      bindWorkspace(record);
    }
    const wasOn = state.mode.on;
    const hold = wasOn ? 0 : ++pendingOpenHoldSeq;
    if (hold) state.pendingOpen = true;
    try {
      await syncModeFromStorage();
      if (state.mode.on && !wasOn) renderRow();
      await beginOpenHandoff();
    } finally {
      if (hold && hold === pendingOpenHoldSeq) state.pendingOpen = false;
    }
  }
  var EXPORT_POLL_MS = 700;
  var EXPORT_POLL_MAX_MS = 6e4;
  var EXPORT_STILL_RUNNING_MESSAGE = "Export is still running \u2014 files land in the workspace exports folder as each screen finishes.";
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function runCanvasExport(dir, formats, timing = { pollMs: EXPORT_POLL_MS, maxMs: EXPORT_POLL_MAX_MS }) {
    let start;
    try {
      start = await exportJob(dir, formats);
    } catch (error) {
      await host.toast({ kind: "error", message: `Export failed: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (!start.ok) {
      await host.toast({ kind: "error", message: start.error || "Export failed." });
      return;
    }
    const job = start.jobId;
    const deadline = Date.now() + timing.maxMs;
    for (; ; ) {
      let status;
      try {
        status = await exportStatus(dir, job);
      } catch (error) {
        await host.toast({ kind: "error", message: `Could not read the export status: ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
      if (status.state === "done") {
        const lines = exportJobSummary(status);
        const text = lines.join("\n");
        await host.toast({ kind: "success", message: text.length > 480 ? `${text.slice(0, 480)}\u2026` : text });
        return;
      }
      if (status.state === "failed") {
        const text = exportFailureSummary(status);
        await host.toast({ kind: "error", message: text.length > 480 ? `${text.slice(0, 480)}\u2026` : text });
        return;
      }
      if (Date.now() >= deadline) {
        await host.toast({ kind: "info", message: EXPORT_STILL_RUNNING_MESSAGE });
        return;
      }
      await sleep(timing.pollMs);
    }
  }
  async function canvasExportCommand(raw) {
    const parsed = parseCanvasExportArgs(raw);
    if ("error" in parsed) {
      await host.toast({ kind: "error", message: parsed.error });
      return;
    }
    const ws = state.workspace;
    if (!ws || ws.dir.trim() === "") {
      await host.toast({ kind: "error", message: "No canvas workspace yet \u2014 /canvas <brief> creates one, then export again." });
      return;
    }
    await runCanvasExport(ws.dir, "formats" in parsed ? parsed.formats : void 0);
  }
  async function canvasCritiqueCommand() {
    const ws = state.workspace;
    if (!ws || ws.dir.trim() === "") {
      await host.toast({ kind: "error", message: "No canvas workspace yet \u2014 /canvas <brief> creates one, then critique again." });
      return null;
    }
    let digest;
    try {
      digest = await critiqueWorkspace(ws.dir);
    } catch (error) {
      await host.toast({ kind: "error", message: `Critique failed: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    }
    if (!digest.ok) {
      await host.toast({ kind: "error", message: digest.error || "Critique failed." });
      return null;
    }
    return critiqueReviewChip(state.sessionId, state.config?.url, digest);
  }
  async function startDesignSession(spec) {
    state.pageBusy = true;
    rerender();
    try {
      const data = seedSessionData(spec.type, spec.brief, spec.workspace ?? null);
      const submission = spec.references !== void 0 ? buildReferenceSubmission(spec.text, data, spec.references) : { text: spec.text, data };
      const result = await host.startSession({
        providerId: "design-canvas",
        id: spec.id,
        title: spec.title,
        url: attachUrl(spec.url),
        text: submission.text,
        navigation: "preserve",
        data: submission.data,
        // Decision 4c only: when a registered project CONTAINS the workspace dir,
        // the session may land in it. Omitted everywhere else (decision 2).
        ...spec.projectId ? { projectId: spec.projectId } : {}
      });
      if (!result.sessionId || result.sent !== "sent") {
        const failure = "failure" in result ? result.failure : void 0;
        const message = result.sent === "no-model" ? "The design brief was not sent. Choose a model in OpenChamber, then try again. Your draft is unchanged." : `The design brief was not sent (${result.sent}${failure ? `: ${failure}` : ""}). Your draft is unchanged; try again.`;
        state.pageError = message;
        await host.toast({ kind: "error", message });
        return false;
      }
      if (spec.references !== void 0) {
        cancelReferenceValidation();
        state.references = [];
        state.prompt = "";
        attachPathDraft = "";
        referenceError = "";
      } else if (state.surface === "panel") {
        state.prompt = "";
      }
      try {
        if (spec.workspace) await writeOpenHandoff(result.sessionId, spec.workspace.dir, null);
        await host.storage.set(modeStorageKey(result.sessionId), seedModeValue(spec.type, spec.brief));
        await host.storage.set(designMarkerKey(result.sessionId), designMarkerValue());
        if (spec.workspace) await saveWorkspaceRecord(result.sessionId, spec.workspace);
      } catch {
      }
      try {
        await host.toast({ kind: "success", message: "Design session started \u2014 its controls are in Work Status." });
      } catch {
      }
      if (canLoadDesignWork()) void loadDesignHome();
      try {
        await host.openSession(result.sessionId);
      } catch (error) {
        state.pageError = `The brief was sent, but the chat could not open. Open it from Your design work. ${error instanceof Error ? error.message : String(error)}`;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.pageError = message;
      await host.toast({ kind: "error", message: `Could not start session: ${message}` });
      return false;
    } finally {
      state.pageBusy = false;
      rerender();
    }
  }
  async function scaffoldCurrentProject(spec) {
    if (state.workspace && state.workspace.dir.trim() !== "") {
      let url = state.config?.url ?? "";
      try {
        const read = await getConfig(state.workspace.dir);
        url = read.config?.url ?? url;
        if (state.workspace.dir === state.configDir) state.config = read.config;
      } catch {
      }
      const target = resolveCanvasTarget({ workspace: state.workspace, brief: "", projects: allProjects });
      const projectId = target.kind === "workspace" ? target.projectId : void 0;
      return { kind: "workspace", workspace: state.workspace, url, projectId };
    }
    const outcome = await scaffoldCanvasWorkspace(spec.brief, `new-design:${Date.now()}`, {
      type: spec.type,
      direction: spec.direction,
      fidelity: spec.fidelity,
      designSystemId: spec.designSystemId ?? null,
      devices: spec.devices,
      projectDir: spec.projectDir
    }, { notify: false });
    if (!outcome.ok) {
      await host.toast({ kind: "error", message: outcome.error });
      return { kind: "failed", error: outcome.error };
    }
    const job = await runScaffoldJob(outcome.jobId, outcome.record.dir);
    if (job !== "done") {
      return { kind: "failed", error: job.error, workspace: outcome.record };
    }
    return { kind: "new", workspace: outcome.record, url: outcome.url };
  }
  function effectiveLookKind() {
    const kind = state.pageLookKind;
    if (kind === "project" && state.directory) return "project";
    if (kind === "preset" && findDesignSystem(state.pageDesignSystemId)) return "preset";
    if (kind === "direction") return "direction";
    return state.directory ? "project" : "direction";
  }
  function pageBriefSpec() {
    const kind = effectiveLookKind();
    const look = kind === "project" ? "project" : kind === "preset" ? "preset" : "new";
    return {
      type: state.pageType,
      direction: kind === "direction" ? state.pageDirection : "auto",
      fidelity: FIDELITY_FOR_TYPE[state.pageType],
      brief: state.prompt.trim(),
      designSystemId: kind === "preset" ? state.pageDesignSystemId : null,
      projectDir: state.directory,
      questions: state.pageQuestions,
      options: state.pageOptions,
      ...state.pageDevices.length ? { devices: [...state.pageDevices] } : {},
      look
    };
  }
  function briefTitle(brief) {
    const line = brief.split("\n").map((text) => text.trim()).find(Boolean) ?? "";
    const clause = line.replace(/^goal:\s*/i, "").split(/[.,;!?—–]|\s-\s/)[0] ?? "";
    const title = clause.trim().slice(0, 40).trim();
    return title.charAt(0).toUpperCase() + title.slice(1);
  }
  async function startNewDesign() {
    if (state.pageBusy || referencePending) return;
    state.pageBusy = true;
    state.pageError = "";
    const spec = pageBriefSpec();
    const references = state.surface === "page" ? [...state.references] : void 0;
    const title = `Design \xB7 ${briefTitle(spec.brief) || PAGE_TYPE_LABELS[spec.type]}`;
    rerender();
    try {
      const tooLong = briefLimitError(spec.brief);
      if (tooLong) {
        state.pageError = tooLong;
        rerender();
        await host.toast({ kind: "error", message: state.pageError });
        return;
      }
      const prep = await scaffoldCurrentProject(spec);
      if (prep.kind === "failed") {
        state.pageError = prep.error;
        rerender();
        const workspace = prep.workspace ?? state.workspace ?? void 0;
        await startDesignSession({
          id: `new-design:${Date.now()}`,
          title,
          url: "",
          type: spec.type,
          brief: spec.brief,
          dir: workspace?.dir ?? "",
          workspace,
          text: designSessionPrompt(spec, workspace ?? null),
          references
        });
        return;
      }
      await startDesignSession({
        id: `new-design:${Date.now()}`,
        title,
        url: prep.url,
        type: spec.type,
        brief: spec.brief,
        projectId: prep.kind === "workspace" ? prep.projectId : void 0,
        dir: prep.workspace.dir,
        workspace: prep.workspace,
        text: designSessionPrompt(spec, prep.workspace),
        references
      });
    } catch (error) {
      state.pageError = `Could not start session: ${error instanceof Error ? error.message : String(error)}`;
      await host.toast({ kind: "error", message: state.pageError });
    } finally {
      state.pageBusy = false;
      rerender();
    }
  }
  async function addToChat(entry) {
    try {
      await host.attach(buildAttachPayload(entry, pickContext(entry)));
      return true;
    } catch (error) {
      setStatus(`Could not attach a canvas pick: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  }
  function pickContext(pick) {
    const bound = state.workspace?.dir?.trim();
    const dir = pick?.dir?.trim() || bound;
    if (!dir) return null;
    return { workspaceDir: dir, screens: bound && sameDirPath(dir, bound) ? state.liveScreens : [] };
  }
  function pickBelongsHere(pick) {
    if (!pick.dir) return true;
    const bound = state.workspace?.dir;
    return Boolean(bound && sameDirPath(pick.dir, bound));
  }
  function currentScreenFiles(dir) {
    return currentScreens().map((screen) => {
      const live = state.liveScreens.find((candidate) => candidate.id === screen.id);
      let file = screen.file;
      try {
        if (live) file = decodeURIComponent(new URL(live.url).pathname).replace(/^\/+/, "") || "index.html";
      } catch {
      }
      return { ...screen, file: workspaceFilePath(dir, file) };
    });
  }
  async function attachCompactModeChip() {
    const ws = state.workspace;
    if (!state.mode.on || !ws || ws.dir.trim() === "") return;
    try {
      await host.attach(buildCompactModeChip(state.sessionId, state.mode, ws, currentScreenFiles(ws.dir), currentConfig()?.url));
    } catch {
    }
  }
  var PICK_LONG_POLL_MS = 12e3;
  var PICK_SHORT_POLL_MS = 250;
  var PICK_SHORT_POLL_BUDGET_MS = 3e4;
  var PICK_HELD_POLL_MS = 900;
  var PICK_IDLE_POLL_MS = 150;
  var pickCursor = 0;
  var pickLoopActive = false;
  function getPickCursor() {
    return pickCursor;
  }
  async function deliverPickBatch(picks) {
    let lastDelivered = null;
    const delivered = [];
    let advanceTo = pickCursor;
    let modeRechecked = false;
    let modeChipSent = false;
    for (const entry of [...picks].sort((a, b) => a.seq - b.seq)) {
      if (entry.seq <= pickCursor) continue;
      if (!pickBelongsHere(entry)) {
        advanceTo = entry.seq;
        continue;
      }
      if (!state.mode.on && !modeRechecked) {
        modeRechecked = true;
        await syncModeFromStorage();
      }
      if (!state.mode.on) break;
      if (!modeChipSent) {
        modeChipSent = true;
        await attachCompactModeChip();
      }
      if (!await addToChat(entry)) break;
      lastDelivered = entry;
      delivered.push(entry);
      advanceTo = entry.seq;
    }
    if (advanceTo === pickCursor) return false;
    pickCursor = advanceTo;
    if (!lastDelivered) return true;
    try {
      await ackPicks(lastDelivered.seq, batchAckLabel(delivered, lastDelivered));
    } catch {
    }
    return true;
  }
  function picksResultValid(result) {
    return Boolean(result && Array.isArray(result.picks));
  }
  async function pollPicksOnce(waitMs) {
    try {
      const result = await getPicks(pickCursor, waitMs);
      if (!picksResultValid(result)) return "error";
      if (typeof result.seq === "number" && result.seq < pickCursor) pickCursor = 0;
      return await deliverPickBatch(result.picks) ? "progress" : "idle";
    } catch {
      return "error";
    }
  }
  async function runPickLoop(stop) {
    while (!stop()) {
      if (!state.mode.on) {
        await sleep(PICK_HELD_POLL_MS);
        if (!state.mode.on) await syncModeFromStorage();
        continue;
      }
      const outcome = await pollPicksOnce(PICK_LONG_POLL_MS);
      if (outcome === "progress") continue;
      if (outcome === "idle") {
        await sleep(PICK_IDLE_POLL_MS);
        continue;
      }
      const backoffStart = Date.now();
      while (!stop() && Date.now() - backoffStart < PICK_SHORT_POLL_BUDGET_MS) {
        if (!state.mode.on) break;
        await sleep(PICK_SHORT_POLL_MS);
        if (await pollPicksOnce(0) !== "error") break;
      }
    }
  }
  function startPickLoop() {
    if (pickLoopActive) return;
    pickLoopActive = true;
    void runPickLoop(() => !pickLoopActive);
  }
  function stopPickLoop() {
    pickLoopActive = false;
  }
  function resetPickLoop() {
    pickLoopActive = false;
    pickCursor = 0;
  }
  function openStatus(message, kind = "info") {
    setStatus(message, kind);
  }
  async function openCanvasWindow(notify) {
    const ws = state.workspace;
    if (!ws) return;
    state.pendingOpen = true;
    try {
      try {
        const read = await getConfig(ws.dir);
        if (state.workspace?.dir === ws.dir) {
          state.config = read.config;
          state.configPath = read.path;
          state.configDir = ws.dir;
        }
      } catch {
      }
      const url = state.config?.url?.trim() ?? await loadLastUrl(ws.dir) ?? void 0;
      if (!url) {
        if (notify) await host.toast({ kind: "error", message: NO_PROJECT_URL_MESSAGE });
        return;
      }
      openStatus(OPENING_STATUS);
      const result = await openWorkspace({ dir: ws.dir, focus: true });
      if (!result.ok && result.code === WORKSPACE_MISSING_CODE) {
        await handleMissingWorkspace(ws.dir, result.error);
        return;
      }
      if (result.ok) await saveLastUrl(ws.dir, result.url || url);
      if (result.ok && result.started) markServerStartedByUs(ws.dir);
      openStatus(formatOpenStatus(result), result.ok ? "info" : "error");
    } catch (error) {
      openStatus(`Could not open the canvas: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      state.pendingOpen = false;
    }
  }
  async function handleMissingWorkspace(dir, message) {
    state.workspace = null;
    state.config = null;
    state.configPath = null;
    state.configDir = null;
    state.startedServers.delete(dir);
    wsSessionMap.delete(normalizeDirPath(dir));
    const key = workspaceStorageKey(state.sessionId);
    if (key) {
      try {
        await host.storage.delete(key);
      } catch {
      }
    }
    renderRow();
    rerender();
    await host.toast({
      kind: "error",
      message: `${message ?? `The canvas folder ${dir} no longer exists.`} Start creates a new canvas.`
    });
  }
  async function previewWorkspace(row) {
    if (!row.url?.trim()) {
      await host.toast({ kind: "error", message: NO_PROJECT_URL_MESSAGE });
      return;
    }
    try {
      const result = await openWorkspace({ dir: row.dir, focus: true });
      if (!result.ok) {
        await host.toast({ kind: "error", message: result.error ?? "Could not open the canvas" });
        return;
      }
      await host.toast({ kind: "success", message: `Opened ${row.name} \u2014 its canvas window is live.` });
    } catch (error) {
      await host.toast({ kind: "error", message: `Could not open the canvas: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  var directoryGeneration = 0;
  var serverActionSeq = 0;
  function actionDir() {
    return state.workspace?.dir ?? state.directory;
  }
  function directoryMovedSince(dir, gen) {
    return actionDir() !== dir || directoryGeneration !== gen;
  }
  function markServerStartedByUs(dir) {
    if (dir) state.startedServers.add(dir);
  }
  async function resolveProjectId(dir) {
    const cached = allProjects.find((row) => sameDirPath(row.directory, dir));
    if (cached) return { kind: "id", id: cached.id };
    let snapshot;
    try {
      snapshot = await host.listProjects();
    } catch {
      return { kind: "unknown" };
    }
    if (snapshot.state !== "ready") return { kind: "unknown" };
    const project = snapshot.projects.find((candidate) => sameDirPath(candidate.directory, dir));
    return project ? { kind: "id", id: project.id } : { kind: "unregistered" };
  }
  async function countActiveDesignSessions(dir) {
    const resolved = await resolveProjectId(dir);
    if (resolved.kind === "unknown") return null;
    if (resolved.kind === "unregistered") return 0;
    let snapshot;
    try {
      snapshot = await host.listSessions(resolved.id);
    } catch {
      return null;
    }
    if (snapshot.state !== "ready") return null;
    const markerIds = await readDesignMarkerSessionIds();
    return countOtherActiveDesignSessions(snapshot.sessions, state.sessionId, markerIds);
  }
  async function tryStopDevServer(dir) {
    const result = await stopDevServer(dir);
    if (result.ok && result.stopped) {
      state.startedServers.delete(dir);
      if (state.pendingStop?.dir === dir) state.pendingStop = null;
      return { stopped: true };
    }
    return { stopped: false, error: result.error };
  }
  async function requestDevServerStop(options = {}) {
    const dir = options.dir ?? actionDir();
    if (!dir) return { stopped: false, held: false, blocked: false };
    const manual = options.manual ?? false;
    const gen = directoryGeneration;
    if (!manual && !state.startedServers.has(dir)) return { stopped: false, held: false, blocked: false };
    const otherActiveDesignSessions = await countActiveDesignSessions(dir);
    if (state.sessionBusy) {
      state.pendingStop = { dir, manual };
      return { stopped: false, held: true, blocked: false };
    }
    if (otherActiveDesignSessions === null) {
      return { stopped: false, held: false, blocked: false, unknown: true };
    }
    if (options.dir === void 0 && directoryMovedSince(dir, gen)) {
      return { stopped: false, held: false, blocked: false };
    }
    if (shouldStopDevServer({ busy: state.sessionBusy, otherActiveDesignSessions, startedByUs: true })) {
      try {
        const outcome = await tryStopDevServer(dir);
        const result = {
          stopped: outcome.stopped,
          held: false,
          blocked: false
        };
        if (outcome.error) result.error = outcome.error;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Could not stop the preview: ${message}`, "error");
        return { stopped: false, held: false, blocked: false, error: message };
      }
    }
    return { stopped: false, held: false, blocked: true };
  }
  async function manualStopRefusalMessage(dir) {
    try {
      const status = await getServerStatus(dir);
      if (status.error) return status.error;
      return status.pid ? "No preview dev server to stop." : "The service did not record this server; it was not started by Design Canvas.";
    } catch {
      return "No preview dev server to stop.";
    }
  }
  function reportHonouredStop(result, dir) {
    if (result.stopped) {
      if (state.workspace?.dir === dir) {
        state.serverStatus = false;
        state.serverError = null;
        renderServerControl();
      }
      announceServer("Preview dev server stopped.");
    } else if (result.blocked) {
      announceServer("Another active design session is using this preview server.");
    } else if (result.unknown) {
      announceServer("Could not verify other design sessions \u2014 the queued stop stays pending.");
    }
  }
  async function reportAgentStatus(busy) {
    try {
      await postAgentStatus(busy, busy ? "Designing\u2026" : void 0);
    } catch {
    }
  }
  async function syncRegistryBackstop() {
    const dir = state.workspace?.dir;
    if (!dir) return;
    try {
      await syncScreens(dir);
    } catch {
    }
  }
  async function applySessionSnapshot(session) {
    const changed = state.sessionId !== (session?.id ?? null);
    const wasBusy = state.sessionBusy;
    state.sessionId = session?.id ?? null;
    state.sessionBusy = session?.busy ?? false;
    if (wasBusy !== state.sessionBusy && !isHiddenResolvePane()) await reportAgentStatus(state.sessionBusy);
    if (state.sessionBusy) {
      if (state.pendingStop) {
        state.pendingStop = null;
        announceServer("Session is busy again \u2014 the queued stop was cancelled.");
      }
    } else if (state.pendingStop) {
      const request = state.pendingStop;
      const result = await requestDevServerStop({ manual: request.manual, dir: request.dir });
      reportHonouredStop(result, request.dir);
    }
    if (changed) {
      if (state.surface === "panel") state.workspace = null;
      await loadWorkspace();
      renderRow();
    }
    await loadMode();
    if (state.surface === "panel") renderRail();
  }
  async function handleSessionLifecycle(event) {
    if (event.phase === "completed") {
      if (!isHiddenResolvePane()) void syncRegistryBackstop();
      if (state.pendingStop && !state.sessionBusy) {
        const request = state.pendingStop;
        const result = await requestDevServerStop({ manual: request.manual, dir: request.dir });
        reportHonouredStop(result, request.dir);
      }
    }
  }
  var serverAnnouncements = [];
  function announceServer(message) {
    serverAnnouncements.push(message);
    if (!serverAnnounceEl) return;
    serverAnnounceEl.textContent = "";
    queueMicrotask(() => {
      if (serverAnnounceEl) serverAnnounceEl.textContent = message;
    });
  }
  function focusInside(el2) {
    const active2 = document.activeElement;
    if (!el2 || !active2 || typeof el2.contains !== "function") return false;
    return active2 === el2 || el2.contains(active2);
  }
  function focusSessionLine() {
    if (!sessionLineEl) return;
    sessionLineEl.tabIndex = -1;
    sessionLineEl.focus();
  }
  var serverStatusRead = 0;
  function serverRenderState() {
    if (state.serverPending) return "loading";
    if (state.serverError) return "error";
    if (state.serverStatus === null) return "checking";
    return state.serverStatus ? "running" : "stopped";
  }
  function announceServerTransition(before) {
    const after = serverRenderState();
    if (after === before) return;
    if (after === "running") announceServer("Preview dev server is running.");
    else if (after === "stopped" && before !== "checking") announceServer("Preview dev server stopped.");
    else if (after === "error") announceServer("Preview dev server status unavailable \u2014 click to retry.");
  }
  function workspaceDir() {
    return state.workspace?.dir ?? null;
  }
  async function refreshServerStatus() {
    const dir = actionDir();
    if (state.serverPending || !dir) return;
    const token = ++serverStatusRead;
    const superseded = () => token !== serverStatusRead || state.serverPending || actionDir() !== dir;
    try {
      const status = await getServerStatus(dir);
      if (superseded()) return;
      const before = serverRenderState();
      if (status.error) {
        state.serverError = status.error;
      } else {
        state.serverStatus = status.up;
        state.serverError = null;
      }
      announceServerTransition(before);
    } catch (error) {
      if (superseded()) return;
      const before = serverRenderState();
      state.serverError = error instanceof Error ? error.message : String(error);
      announceServerTransition(before);
    }
    renderServerControl();
  }
  function renderServerControl() {
    if (!barEl || !serverBtn) return;
    const ws = state.workspace;
    if (!ws) {
      serverBtn.hidden = false;
      serverBtn.disabled = state.serverPending;
      serverBtn.classList.remove("is-stopped", "is-running", "is-loading", "is-error");
      serverBtn.classList.add(state.serverPending ? "is-loading" : "is-stopped");
      serverBtn.title = state.serverPending ? "Working\u2026" : state.sessionId ? "Create canvas \u2014 start a Design Canvas workspace" : `${NO_SESSION_HINT}, then press Start to create a canvas`;
      serverBtn.setAttribute("aria-label", serverBtn.title);
      const icon3 = q("span", "ds-server-icon");
      serverBtn.replaceChildren(icon3);
      return;
    }
    const url = currentConfig()?.url?.trim();
    const ready = projectReady(currentConfig()) && url !== void 0 && isLoopbackUrl(url);
    if (!ready) {
      const hadFocus = focusInside(serverBtn);
      serverBtn.hidden = true;
      if (hadFocus) focusSessionLine();
      return;
    }
    serverBtn.hidden = false;
    serverBtn.disabled = state.serverPending;
    serverBtn.classList.remove("is-stopped", "is-running", "is-loading", "is-error");
    let stateClass;
    if (state.serverPending) {
      stateClass = "is-loading";
    } else if (state.serverError) {
      stateClass = "is-error";
    } else if (state.serverStatus === null) {
      stateClass = "is-loading";
    } else if (state.serverStatus) {
      stateClass = "is-running";
    } else {
      stateClass = "is-stopped";
    }
    serverBtn.classList.add(stateClass);
    serverBtn.title = state.serverPending ? "Working\u2026" : state.serverError ? "Preview dev server error \u2014 click to retry" : state.serverStatus === null ? "Checking the preview dev server\u2026" : state.serverStatus ? "Stop preview dev server" : "Start preview dev server";
    serverBtn.setAttribute("aria-label", serverBtn.title);
    const icon2 = q("span", "ds-server-icon");
    serverBtn.replaceChildren(icon2);
  }
  function currentConfig() {
    return state.configDir === state.workspace?.dir ? state.config : null;
  }
  async function onServerControlClick() {
    if (state.serverPending) return;
    if (!state.workspace) {
      if (!state.sessionId) {
        announceServer(NO_SESSION_MESSAGE);
        await host.toast({ kind: "error", message: NO_SESSION_MESSAGE });
        return;
      }
      state.serverPending = true;
      renderServerControl();
      try {
        const ws = await ensureCanvasWorkspace("");
        if (!ws) {
          announceServer("Could not create the canvas workspace.");
          await host.toast({ kind: "error", message: "Could not create the canvas workspace \u2014 see the message above, then press Start to retry." });
          return;
        }
        await toggleMode(true);
      } finally {
        state.serverPending = false;
        renderServerControl();
      }
      return;
    }
    const url = currentConfig()?.url?.trim();
    if (!url || !isLoopbackUrl(url)) return;
    if (state.serverStatus && !state.serverError) {
      await stopCurrentServer();
    } else {
      await startCurrentServer();
    }
  }
  async function startCurrentServer() {
    const dir = actionDir();
    if (!dir) return;
    const url = currentConfig()?.url?.trim();
    if (!url || !isLoopbackUrl(url)) return;
    const gen = directoryGeneration;
    const action = ++serverActionSeq;
    state.serverPending = true;
    state.serverError = null;
    renderServerControl();
    try {
      const result = await startDevServer(dir, url);
      if (result.ok && result.up && result.started) markServerStartedByUs(dir);
      if (directoryMovedSince(dir, gen)) return;
      state.serverStatus = result.up ?? null;
      state.serverError = result.error ?? null;
      if (result.ok && result.started) {
        announceServer("Preview dev server started.");
      } else if (result.ok && result.up) {
        announceServer("Preview dev server is running.");
      } else {
        announceServer(result.error ?? "Could not start the preview dev server.");
      }
    } catch (error) {
      if (directoryMovedSince(dir, gen)) return;
      state.serverError = error instanceof Error ? error.message : String(error);
      announceServer(`Could not start the preview dev server: ${state.serverError}`);
    } finally {
      if (action === serverActionSeq) state.serverPending = false;
      renderServerControl();
      void refreshServerStatus();
    }
  }
  async function stopCurrentServer() {
    const dir = actionDir();
    if (!dir) return;
    const gen = directoryGeneration;
    const action = ++serverActionSeq;
    state.serverPending = true;
    state.serverError = null;
    renderServerControl();
    try {
      const result = await requestDevServerStop({ manual: true });
      if (directoryMovedSince(dir, gen)) return;
      if (result.stopped) {
        state.serverStatus = false;
        state.serverError = null;
        announceServer("Preview dev server stopped.");
      } else if (result.held) {
        state.serverError = null;
        announceServer("Session is busy \u2014 stop queued for when it becomes idle.");
      } else if (result.unknown) {
        state.serverError = null;
        announceServer("Could not verify other design sessions \u2014 the preview server was left running.");
      } else if (result.blocked) {
        state.serverError = null;
        announceServer("Another active design session is using this preview server.");
      } else {
        announceServer(result.error ?? await manualStopRefusalMessage(dir));
      }
    } catch (error) {
      if (directoryMovedSince(dir, gen)) return;
      state.serverError = error instanceof Error ? error.message : String(error);
      announceServer(`Could not stop the preview dev server: ${state.serverError}`);
    } finally {
      if (action === serverActionSeq) state.serverPending = false;
      renderServerControl();
      void refreshServerStatus();
    }
  }
  async function readStudioConfig(reportErrors) {
    const dir = workspaceDir();
    if (!dir) return;
    if (isHiddenResolvePane()) return;
    if (configReadInFlight) return;
    configReadInFlight = true;
    try {
      const { config, path } = await getConfig(dir);
      if (workspaceDir() !== dir) return;
      state.config = config;
      state.configPath = path;
      state.configDir = dir;
      renderRow();
    } catch (error) {
      if (reportErrors) {
        setStatus(error instanceof ServiceUnavailable ? `Local service not ready: ${error.message}` : `Config error: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    } finally {
      configReadInFlight = false;
    }
  }
  async function loadStudioConfig() {
    await readStudioConfig(true);
  }
  function rerender() {
    if (state.surface === "page") renderPage();
    else if (state.surface === "panel") renderRail();
  }
  function canLoadDesignWork() {
    return state.surface === "page" || state.surface === "panel" && railWorkEl !== null && isRealPane();
  }
  async function loadProjects() {
    let snapshot;
    try {
      snapshot = await host.listProjects();
    } catch {
      allProjects = [];
      return;
    }
    allProjects = allProjectsFromSnapshot(snapshot);
  }
  async function readWorkspaceSessionMap() {
    const map = /* @__PURE__ */ new Map();
    let keys;
    try {
      keys = await host.storage.keys();
    } catch {
      return map;
    }
    const sessionIds = keys.map(wsSessionIdFromKey).filter((id) => id !== null);
    await Promise.all(
      sessionIds.map(async (id) => {
        try {
          const value = await host.storage.get(workspaceStorageKey(id));
          if (isWorkspaceRecord(value)) map.set(normalizeDirPath(value.dir), id);
        } catch {
        }
      })
    );
    return map;
  }
  async function loadCanvasWorkspaces(options = {}) {
    if (!(options.quiet && state.workspaces?.kind === "list")) {
      state.workspaces = { kind: "loading" };
      rerender();
    }
    wsSessionMap = await readWorkspaceSessionMap();
    let result;
    try {
      result = await getWorkspaces();
    } catch (error) {
      state.workspaces = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      rerender();
      return;
    }
    const rows = Array.isArray(result.workspaces) ? result.workspaces : [];
    state.workspaces = rows.length === 0 ? { kind: "empty" } : { kind: "list", rows: joinWorkspaceSessions(rows, wsSessionMap) };
    rerender();
  }
  async function loadDesignHome() {
    await loadProjects();
    await loadCanvasWorkspaces();
  }
  async function readDesignMarkerSessionIds() {
    const marked = /* @__PURE__ */ new Set();
    let keys;
    try {
      keys = await host.storage.keys();
    } catch {
      return marked;
    }
    for (const key of keys) {
      const id = designSessionIdFromKey(key);
      if (id !== null) marked.add(id);
    }
    return marked;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgIcon(paths, size = 18) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [name, value] of Object.entries({
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    })) {
      svg.setAttribute(name, String(value));
    }
    svg.innerHTML = paths;
    return svg;
  }
  var GLYPH_PATHS = {
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    desktop: '<rect x="2.5" y="4" width="19" height="12.5" rx="1.5"/><path d="M9 20.5h6"/><path d="M12 16.5v4"/>',
    slide: '<rect x="2.5" y="5" width="19" height="12" rx="1.5"/><path d="M6 9h7"/><path d="M6 12.5h4"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 15l4.5-4 4 3.5 3-2.5L20 15"/>',
    page: '<path d="M6.5 2.5h8l3.5 3.5v15.5h-11.5z"/><path d="M14.5 2.5v3.5H18"/><path d="M9 11h6"/><path d="M9 14.5h6"/>'
  };
  function starterGlyph(glyph) {
    const span = q("span", `ds-glyph ds-glyph-${glyph}`);
    span.setAttribute("aria-hidden", "true");
    span.append(svgIcon(GLYPH_PATHS[glyph], 22));
    return span;
  }
  function canSend() {
    return !state.pageBusy && !referencePending && state.prompt.trim() !== "";
  }
  function updateComposerState() {
    const ready = canSend();
    if (sendEl) {
      sendEl.disabled = !ready;
      sendEl.classList.toggle("ready", ready);
      sendEl.classList.toggle("busy", state.pageBusy);
      sendEl.setAttribute("aria-busy", String(state.pageBusy));
      sendEl.title = state.pageBusy ? "Starting the design session\u2026" : referencePending ? "Wait for the reference to finish checking" : "Start the design session";
    }
    if (counterEl) {
      const length = state.prompt.length;
      counterEl.hidden = length < BRIEF_COUNTER_FROM;
      counterEl.textContent = `${length} / ${BRIEF_MAX}`;
      counterEl.classList.toggle("warn", length >= BRIEF_MAX * 0.9);
    }
  }
  function nextOverlayState(current, triggerId) {
    return current === triggerId ? null : triggerId;
  }
  function currentOverlay() {
    return state.overlay;
  }
  var refocusOverlayTrigger = null;
  var poppingOverlay = null;
  function toggleMenu(which) {
    if (currentOverlay() === "attach") cancelReferenceValidation();
    const next = nextOverlayState(currentOverlay(), which);
    state.overlay = next;
    poppingOverlay = next;
    if (next === "look") {
      const kind = effectiveLookKind();
      state.lookTab = kind === "project" ? "project" : kind === "preset" ? "presets" : "directions";
      dsQuery = "";
      dsHighlight = state.pageDesignSystemId;
    }
    refocusOverlayTrigger = next === null ? which : null;
    renderPage();
  }
  function closeMenus(refocus = false) {
    const open = currentOverlay();
    if (!open) return;
    if (open === "attach") cancelReferenceValidation();
    state.overlay = null;
    refocusOverlayTrigger = refocus ? open : null;
    renderPage();
  }
  function closeActiveOverlay(id) {
    if (id === "attach") cancelReferenceValidation();
    state.overlay = null;
    refocusOverlayTrigger = id;
    renderPage();
  }
  function onPageWindowClick(event) {
    const target = event.target;
    if (target?.closest(".ds-ds-panel, .ds-menu, .ds-menu-trigger")) return;
    closeMenus();
  }
  function onPageKeydown(event) {
    if (event.key !== "Escape") return;
    if (!currentOverlay()) return;
    event.preventDefault();
    closeMenus(true);
  }
  function renderPage() {
    if (!pageBody || state.surface !== "page") return;
    pageBody.replaceChildren();
    promptEl = null;
    sendEl = null;
    counterEl = null;
    const shell = q("div", "ds-home");
    if (pageEnter) {
      shell.classList.add("ds-enter");
      pageEnter = false;
    }
    shell.append(renderHeader(), renderComposer(), renderContextRow(), renderStarters(), renderCanvasSection(), renderFooter());
    pageBody.append(shell);
    updateComposerState();
    poppingOverlay = null;
    focusPendingTrigger();
    if (referenceFocusId) {
      const target = Array.from(pageBody.querySelectorAll(".ds-reference-remove")).find((button2) => button2.dataset.referenceId === referenceFocusId);
      referenceFocusId = null;
      target?.focus();
    }
  }
  function focusPendingTrigger() {
    const id = refocusOverlayTrigger;
    if (!id) return;
    refocusOverlayTrigger = null;
    pageBody?.querySelector(`[data-overlay-trigger="${id}"]`)?.focus();
  }
  function renderHeader() {
    const header = q("header", "ds-header");
    header.append(q("div", "ds-eyebrow", "Design Canvas"));
    header.append(q("h1", "ds-title", "Design on a live canvas"));
    header.append(q("p", "ds-lede", "Describe it. The agent reads your project, asks what it needs, shows options, then builds real screens you can click to edit."));
    if (state.pageError) {
      const error = q("div", "ds-home-warn", state.pageError);
      error.setAttribute("role", "alert");
      header.append(error);
    }
    return header;
  }
  function anchoredPopover(options) {
    const anchor = q("div", "ds-ds-anchor");
    anchor.append(options.trigger);
    if (!options.open) return anchor;
    options.panel.setAttribute("role", "dialog");
    options.panel.setAttribute("aria-label", options.label);
    if (poppingOverlay && options.trigger.dataset.overlayTrigger === poppingOverlay) options.panel.classList.add("ds-pop");
    const backdrop = q("div", "ds-ds-backdrop");
    if (options.closeOnBackdrop) backdrop.addEventListener("click", () => options.onClose());
    anchor.append(backdrop);
    anchor.append(options.panel);
    options.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        options.onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const active2 = document.activeElement;
      if (active2?.tagName === "SELECT") return;
      const items = Array.from(options.panel.querySelectorAll(options.optionSelector));
      if (items.length === 0) return;
      event.preventDefault();
      const current = active2 ? items.indexOf(active2) : -1;
      const next = items[popoverStep(current, items.length, event.key === "ArrowDown" ? 1 : -1)];
      next?.focus();
    });
    return anchor;
  }
  var CARET_ICON = '<path d="M6 9l6 6 6-6"/>';
  function overlayChip(id, label, ariaLabel) {
    const chip = q("button", "ds-chip ds-menu-trigger");
    chip.type = "button";
    chip.dataset.overlayTrigger = id;
    chip.append(q("span", "ds-chip-label", label));
    chip.append(svgIcon(CARET_ICON, 14));
    chip.title = ariaLabel;
    chip.setAttribute("aria-label", `${ariaLabel}: ${label}`);
    chip.setAttribute("aria-expanded", String(state.overlay === id));
    chip.disabled = state.pageBusy;
    chip.addEventListener("click", () => toggleMenu(id));
    return chip;
  }
  function lookChipLabel() {
    const kind = effectiveLookKind();
    if (kind === "project") return "Look: Match project";
    if (kind === "preset") return `Look: ${findDesignSystem(state.pageDesignSystemId)?.name ?? "Preset"}`;
    return `Look: ${state.pageDirection === "auto" ? "Auto" : DIRECTIONS[state.pageDirection].name}`;
  }
  var DEVICE_ORDER = ["phone", "tablet", "desktop"];
  function deviceName(id) {
    const label = DEVICE_PRESETS[id].label;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  function devicesChipLabel() {
    const chosen = DEVICE_ORDER.filter((id) => state.pageDevices.includes(id));
    return `Devices: ${chosen.length ? chosen.map(deviceName).join(" + ") : "Ask"}`;
  }
  function applyStructureBrief() {
    if (state.pageBusy) return;
    const next = structureBrief(state.prompt, { devices: state.pageDevices });
    if (next === state.prompt) return;
    state.prompt = next;
    if (promptEl) promptEl.value = next;
    updateComposerState();
    promptEl?.focus();
  }
  function renderComposer() {
    const box = q("div", "ds-composer");
    const area = q("textarea", "ds-composer-input");
    area.rows = 3;
    area.placeholder = 'What are we designing? e.g. "Budget app onboarding \u2014 3 screens, phone first"';
    area.value = state.prompt;
    area.setAttribute("aria-label", "Design brief");
    area.disabled = state.pageBusy;
    area.addEventListener("input", () => {
      state.prompt = area.value;
      updateComposerState();
    });
    area.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (canSend()) void startNewDesign();
      }
    });
    promptEl = area;
    const bar = q("div", "ds-composer-bar");
    const plus = q("button", "ds-plus ds-menu-trigger");
    plus.type = "button";
    plus.dataset.overlayTrigger = "attach";
    plus.append(svgIcon('<path d="M12 5v14"/><path d="M5 12h14"/>'));
    plus.title = "Add a reference";
    plus.setAttribute("aria-label", "Add a reference");
    plus.disabled = state.pageBusy || referencePending;
    plus.setAttribute("aria-expanded", String(state.overlay === "attach"));
    plus.addEventListener("click", () => toggleMenu("attach"));
    const attachAnchor = anchoredPopover({
      open: state.overlay === "attach",
      trigger: plus,
      panel: renderAttachPanel(),
      label: "Add a reference",
      optionSelector: ".ds-menu-item",
      onClose: () => closeMenus(true)
    });
    const typeAnchor = anchoredPopover({
      open: state.overlay === "type",
      trigger: overlayChip("type", PAGE_TYPE_LABELS[state.pageType], "Design type"),
      panel: renderTypeMenu(),
      label: "Choose the design type",
      optionSelector: ".ds-menu-item",
      onClose: () => closeMenus(true)
    });
    const lookAnchor = anchoredPopover({
      open: state.overlay === "look",
      trigger: overlayChip("look", lookChipLabel(), "Look"),
      panel: renderLookPanel(),
      label: "Choose the look",
      optionSelector: ".ds-look-option:not(:disabled), .ds-ds-item",
      onClose: () => closeMenus(true)
    });
    const devicesAnchor = anchoredPopover({
      open: state.overlay === "devices",
      trigger: overlayChip("devices", devicesChipLabel(), "Devices"),
      panel: renderDevicesPanel(),
      label: "Choose the devices",
      optionSelector: ".ds-device-option input",
      onClose: () => closeMenus(true)
    });
    const spacer = q("div", "ds-composer-spacer");
    const structure = q("button", "ds-ghost ds-structure", "Structure brief");
    structure.type = "button";
    structure.title = "Turn the draft into Goal, audience, screens, devices and the rest";
    structure.disabled = state.pageBusy;
    structure.addEventListener("click", () => applyStructureBrief());
    const send = q("button", "ds-send");
    send.type = "button";
    send.append(q("span", "ds-send-label", "Start design"));
    send.append(svgIcon('<path d="M9 6l6 6-6 6"/>', 16));
    send.title = "Start the design session";
    send.setAttribute("aria-label", "Start design");
    send.addEventListener("click", () => {
      if (canSend()) void startNewDesign();
    });
    sendEl = send;
    const actions = q("div", "ds-composer-actions");
    actions.append(structure, send);
    bar.append(attachAnchor, typeAnchor, lookAnchor, devicesAnchor, spacer, actions);
    box.append(area, renderReferenceDraft(), bar);
    box.classList.toggle("ds-overlay-open", state.overlay !== null);
    const wrap = q("div", "ds-composer-wrap");
    wrap.append(box, renderToggles());
    return wrap;
  }
  function renderToggles() {
    const row = q("div", "ds-toggles");
    const questions = q("div", "ds-toggle");
    const sw = q("button", "ds-switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(state.pageQuestions));
    sw.setAttribute("aria-labelledby", "ds-questions-label");
    sw.setAttribute("aria-describedby", "ds-questions-hint");
    sw.disabled = state.pageBusy;
    sw.append(q("span", "ds-switch-thumb"));
    sw.addEventListener("click", () => {
      setPagePref({ questions: !state.pageQuestions }, ".ds-switch");
    });
    const questionsText = q("div", "ds-toggle-text");
    const questionsLabel = q("span", "ds-toggle-label", "Ask me questions first");
    questionsLabel.id = "ds-questions-label";
    const questionsHint = q("span", "ds-toggle-hint", "3\u20136 questions, with my recommended answers");
    questionsHint.id = "ds-questions-hint";
    questionsText.append(questionsLabel, questionsHint);
    questions.append(sw, questionsText);
    const options = q("div", "ds-toggle");
    const seg = q("div", "ds-seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-labelledby", "ds-options-label");
    const choices = [["ask", "Ask"], [1, "1"], [2, "2"], [3, "3"]];
    for (const [value, label] of choices) {
      const on = state.pageOptions === value;
      const item = q("button", `ds-seg-item${on ? " on" : ""}`, label);
      item.type = "button";
      item.setAttribute("role", "radio");
      item.setAttribute("aria-checked", String(on));
      if (value !== "ask") item.setAttribute("aria-label", `${label} option${value === 1 ? "" : "s"}`);
      item.disabled = state.pageBusy;
      item.dataset.option = String(value);
      item.addEventListener("click", () => setPagePref({ options: value }, `.ds-seg-item[data-option="${value}"]`));
      seg.append(item);
    }
    const optionsText = q("div", "ds-toggle-text");
    const optionsLabel = q("span", "ds-toggle-label", "Options");
    optionsLabel.id = "ds-options-label";
    optionsText.append(optionsLabel, q("span", "ds-toggle-hint", "Side-by-side directions to pick from"));
    options.append(optionsText, seg);
    const counter = q("span", "ds-counter");
    counter.setAttribute("aria-live", "polite");
    counterEl = counter;
    row.append(questions, options, counter);
    return row;
  }
  function referenceDisplayLabel(reference) {
    const parts = reference.path.split("/").filter(Boolean);
    let count = Math.min(2, parts.length);
    const others = state.references.filter((candidate) => candidate.id !== reference.id);
    while (count < parts.length && others.some((candidate) => candidate.path.split("/").filter(Boolean).slice(-count).join("/") === parts.slice(-count).join("/"))) count += 1;
    return `${fileBaseName(reference.sourceDirectory)} \xB7 ${parts.slice(-count).join("/")}`;
  }
  function renderReferenceDraft() {
    const list = q("ul", "ds-reference-list");
    list.setAttribute("aria-label", "References included with this design brief");
    list.hidden = state.references.length === 0;
    for (const reference of state.references) {
      const item = q("li", "ds-reference-chip");
      item.append(svgIcon(reference.kind === "project" ? '<path d="M3 7h6l2 2h10v11H3z"/>' : '<path d="M14 2H6v20h12V6z"/><path d="M14 2v6h6"/>', 14));
      const details = q("details", "ds-reference-details");
      const summary = q("summary");
      summary.setAttribute("aria-label", `${reference.path}; source: ${reference.sourceDirectory}. Show full path`);
      const label = q("span", "ds-reference-label", referenceDisplayLabel(reference));
      label.title = `${reference.path}
Source: ${reference.sourceDirectory}`;
      summary.append(label);
      details.append(summary, q("span", "ds-reference-path", reference.path), q("span", "ds-reference-source", `Source: ${reference.sourceDirectory}`));
      const remove = q("button", "ds-reference-remove");
      remove.type = "button";
      remove.dataset.referenceId = reference.id;
      remove.setAttribute("aria-label", `Remove ${reference.path}`);
      remove.title = `Remove ${reference.path}`;
      remove.disabled = state.pageBusy;
      remove.append(svgIcon('<path d="m6 6 12 12M18 6 6 18"/>', 14));
      remove.addEventListener("click", () => removePageReference(reference.id));
      item.append(details, remove);
      list.append(item);
    }
    return list;
  }
  function removePageReference(id) {
    if (state.pageBusy) return;
    const index = state.references.findIndex((reference) => reference.id === id);
    if (index < 0) return;
    const removed = state.references[index];
    state.references = removeDraftReference(state.references, id);
    referenceFocusId = state.references[index]?.id ?? state.references[index - 1]?.id ?? null;
    if (!referenceFocusId) refocusOverlayTrigger = "attach";
    announceReference(`Removed ${removed.path}.`);
    renderPage();
  }
  function renderTypeMenu() {
    const panel = q("div", "ds-ds-panel ds-type-panel");
    const list = q("div", "ds-ds-list ds-type-list");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Design types");
    for (const type of DESIGN_TYPES) {
      const on = type === state.pageType;
      const item = q("button", `ds-menu-item${on ? " on" : ""}`);
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", on ? "true" : "false");
      const main2 = q("span", "ds-menu-main");
      main2.append(q("strong", void 0, PAGE_TYPE_LABELS[type]));
      main2.append(q("span", "ds-menu-hint", TYPE_HINT[type]));
      item.append(main2);
      if (on) item.append(svgIcon('<path d="M20 6L9 17l-5-5"/>', 16));
      item.addEventListener("click", () => {
        state.pageType = type;
        closeActiveOverlay("type");
      });
      list.append(item);
    }
    panel.append(list);
    if (state.overlay === "type") queueMicrotask(() => panel.querySelector(".ds-menu-item")?.focus());
    return panel;
  }
  function attachProject() {
    const ws = state.workspace;
    const dir = ws?.dir ?? state.directory ?? "";
    const config = ws ? state.configDir === ws.dir ? state.config : null : state.config;
    const name = ws?.name || (dir ? fileBaseName(dir) : "Canvas");
    const projectId = allProjects.find((project) => dir !== "" && (sameDirPath(project.directory, dir) || pathContains(project.directory, dir)))?.id;
    return { dir, projectId, name, config };
  }
  async function attachProjectReference() {
    const project = attachProject();
    if (state.surface === "page") {
      if (state.pageBusy || referencePending) return;
      if (!project.dir) {
        referenceError = "No canvas workspace yet \u2014 start one with /canvas, then add references.";
        renderPage();
        annotateReferenceFeedback();
        return;
      }
      stagePageReference({ id: `project:${project.dir}`, kind: "project", path: project.dir, sourceDirectory: project.dir, label: project.name });
      closeActiveOverlay("attach");
      return;
    }
    const url = projectHttpUrl(project.config);
    if (!url) {
      await host.toast({ kind: "error", message: ATTACH_NEEDS_URL });
      return;
    }
    try {
      const chip = projectReferenceChip({ projectId: project.projectId, dir: project.dir, name: project.name, url });
      await host.attach(chip);
      await host.toast({ kind: "success", message: "Workspace reference added to the composer." });
    } catch (error) {
      await host.toast({ kind: "error", message: `Could not attach: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  function annotateReferenceFeedback() {
    announceReference(referenceError);
  }
  async function attachProjectPath(path) {
    const project = attachProject();
    if (state.surface === "page") {
      if (state.pageBusy || referencePending) return;
      attachPathDraft = path;
      referenceError = "";
      if (!project.dir) {
        referenceError = "No canvas workspace yet \u2014 start one with /canvas, then paste the file path again.";
        renderPage();
        announceReference(referenceError);
        return;
      }
      if (!path.trim()) {
        referenceError = "Paste a workspace-relative or full file path.";
        renderPage();
        return;
      }
      const request = ++referenceRequest;
      referencePending = true;
      referenceSlow = false;
      renderPage();
      announceReference("Checking that the file is accessible\u2026");
      const slowTimer = setTimeout(() => {
        if (request !== referenceRequest) return;
        referenceSlow = true;
        renderPage();
        announceReference("This is taking longer than expected. Close the reference menu to cancel, then retry.");
      }, 15e3);
      try {
        const resolved = await validateReferencePath(project.dir, path.trim());
        if (request !== referenceRequest || state.surface !== "page") return;
        stagePageReference({ id: `file:${resolved.path}`, kind: "file", path: resolved.path, sourceDirectory: resolved.sourceDirectory, label: fileBaseName(resolved.path) });
        attachPathDraft = "";
        referencePending = false;
        closeActiveOverlay("attach");
      } catch (error) {
        if (request !== referenceRequest) return;
        referenceError = `${error instanceof Error ? error.message : String(error)} Paste an accessible file path and try again.`;
        announceReference(referenceError);
      } finally {
        clearTimeout(slowTimer);
        if (request === referenceRequest) {
          referencePending = false;
          referenceSlow = false;
          renderPage();
        }
      }
      return;
    }
    const url = projectHttpUrl(project.config);
    if (!url) {
      await host.toast({ kind: "error", message: ATTACH_NEEDS_URL });
      return;
    }
    try {
      const chip = fileReferenceChip({ path, url });
      await host.attach(chip);
      await host.toast({ kind: "success", message: "File reference added to the composer." });
    } catch (error) {
      await host.toast({ kind: "error", message: `Could not attach: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  function dragHasFiles(event) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }
  var dragDepth = 0;
  function onPageDragEnter(event) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    pageBody?.classList.add("ds-drop");
  }
  function onPageDragOver(event) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }
  function onPageDragLeave(event) {
    if (!dragHasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) pageBody?.classList.remove("ds-drop");
  }
  function onPageDrop(event) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    pageBody?.classList.remove("ds-drop");
    void attachDroppedFiles(event);
  }
  async function attachDroppedFiles(event) {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    announceReference(DROP_PATH_MESSAGE);
    await host.toast({ kind: "info", message: DROP_PATH_MESSAGE });
  }
  function stagePageReference(reference) {
    const duplicate = state.references.some((existing) => existing.kind === reference.kind && existing.path === reference.path);
    state.references = addDraftReference(state.references, reference);
    referenceError = "";
    announceReference(duplicate ? `Already added: ${reference.path}.` : `Added ${reference.path}.`);
  }
  function attachOption(title, hint, disabled, onClick) {
    const item = q("button", "ds-menu-item");
    item.disabled = disabled;
    const main2 = q("span", "ds-menu-main");
    main2.append(q("strong", void 0, title));
    main2.append(q("span", "ds-menu-hint", hint));
    item.append(main2);
    if (!disabled) item.addEventListener("click", onClick);
    return item;
  }
  function renderAttachPanel() {
    const panel = q("div", "ds-ds-panel ds-attach-panel");
    const project = attachProject();
    const usable = project.dir !== "";
    const list = q("div", "ds-ds-list ds-attach-list");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Add a reference");
    const projectHint = usable ? project.dir || project.name : "No canvas workspace yet \u2014 /canvas creates one.";
    list.append(
      attachOption("Reference the workspace", projectHint, !usable || referencePending || state.pageBusy, () => {
        void attachProjectReference();
      })
    );
    panel.append(list);
    if (usable) {
      const form = q("form", "ds-attach-paste");
      form.dataset.state = referencePending ? "submitted-pending" : attachPathDraft ? "dirty" : "untouched";
      form.setAttribute("aria-busy", String(referencePending));
      const label = q("label", "ds-attach-paste-field");
      label.append(q("span", "ds-attach-paste-label", "File path"));
      const input = q("input", "ds-attach-paste-input");
      input.type = "text";
      input.name = "path";
      input.placeholder = "src/styles.css";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.required = true;
      input.value = attachPathDraft;
      input.readOnly = referencePending;
      input.disabled = state.pageBusy;
      input.setAttribute("aria-describedby", "ds-reference-feedback");
      input.setAttribute("aria-invalid", String(Boolean(referenceError)));
      label.append(input);
      const add = q("button", "ds-attach-paste-add", "Add");
      add.type = "submit";
      add.disabled = referencePending || state.pageBusy || !attachPathDraft.trim();
      add.textContent = referencePending ? "Checking\u2026" : "Add";
      form.append(label, add);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const path = input.value.trim();
        if (!path) return;
        void attachProjectPath(path);
      });
      input.addEventListener("input", () => {
        attachPathDraft = input.value;
        form.dataset.state = input.value ? "dirty" : "untouched";
        add.disabled = referencePending || state.pageBusy || !input.value.trim();
      });
      input.addEventListener("blur", () => {
        if (!input.value.trim() && input.value.length > 0) {
          referenceError = "Paste a workspace-relative or full file path.";
          input.setAttribute("aria-invalid", "true");
          feedback.textContent = referenceError;
          feedback.classList.add("error");
        }
      });
      panel.append(form);
      const feedback = q("div", `ds-attach-note${referenceError ? " error" : ""}`, referencePending ? referenceSlow ? "Still checking. Close this menu to cancel, then retry." : "Checking that the file is accessible\u2026" : referenceError || "Paste a workspace-relative or full path. Files are referenced, never uploaded.");
      feedback.id = "ds-reference-feedback";
      feedback.setAttribute("role", "status");
      if (referencePending) {
        const spinner = svgIcon('<path d="M20 12a8 8 0 1 1-8-8"/>', 14);
        spinner.classList.add("ds-reference-spinner");
        feedback.prepend(spinner);
      }
      panel.append(feedback);
      if (state.overlay === "attach") queueMicrotask(() => input.focus());
    } else {
      panel.append(q("div", "ds-attach-note", projectHint));
    }
    return panel;
  }
  function applyLook(kind, value) {
    state.pageLookKind = kind;
    if (kind === "preset") state.pageDesignSystemId = findDesignSystem(value?.presetId)?.id ?? null;
    else state.pageDesignSystemId = null;
    if (kind === "preset" && !state.pageDesignSystemId) state.pageLookKind = null;
    if (kind === "direction" && value?.direction) state.pageDirection = value.direction;
    void savePagePrefs();
    closeActiveOverlay("look");
  }
  function renderLookPanel() {
    const panel = q("div", "ds-ds-panel ds-look-panel");
    const tabs = q("div", "ds-look-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Where the look comes from");
    const entries = [["project", "Project"], ["presets", "Presets"], ["directions", "Directions"]];
    const tabEls = [];
    for (const [id, label] of entries) {
      const on = state.lookTab === id;
      const tab = q("button", "ds-look-tab", label);
      tab.type = "button";
      tab.id = `ds-look-tab-${id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("aria-controls", "ds-look-tabpanel");
      tab.tabIndex = on ? 0 : -1;
      tab.addEventListener("click", () => {
        if (state.lookTab === id) return;
        state.lookTab = id;
        dsQuery = "";
        renderPage();
        queueMicrotask(() => pageBody?.querySelector(`#ds-look-tab-${id}`)?.focus());
      });
      tabEls.push(tab);
      tabs.append(tab);
    }
    tabs.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = entries.findIndex(([id]) => id === state.lookTab);
      tabEls[popoverStep(index, entries.length, event.key === "ArrowRight" ? 1 : -1)]?.click();
    });
    const body = q("div", "ds-look-body");
    body.id = "ds-look-tabpanel";
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-labelledby", `ds-look-tab-${state.lookTab}`);
    if (state.lookTab === "project") body.append(renderLookProject());
    else if (state.lookTab === "presets") body.append(renderDesignSystemPanel());
    else body.append(renderLookDirections());
    panel.append(tabs, body);
    if (state.overlay === "look" && state.lookTab !== "presets") {
      queueMicrotask(() => panel.querySelector(".ds-look-option:not(:disabled)")?.focus());
    }
    return panel;
  }
  function lookOption(title, hint, on, disabled, onClick, extra) {
    const item = q("button", `ds-menu-item ds-look-option${on ? " on" : ""}`);
    item.type = "button";
    item.setAttribute("aria-pressed", String(on));
    item.disabled = disabled || state.pageBusy;
    const main2 = q("span", "ds-menu-main");
    main2.append(q("strong", void 0, title));
    main2.append(q("span", "ds-menu-hint ds-look-hint", hint));
    if (extra) main2.append(extra);
    item.append(main2);
    if (on) item.append(svgIcon('<path d="M20 6L9 17l-5-5"/>', 16));
    if (!item.disabled) item.addEventListener("click", onClick);
    return item;
  }
  function renderLookProject() {
    const list = q("div", "ds-look-list");
    const dir = state.directory;
    const hint = dir ? `Use its colors, type, radii and components. The agent reads ${fileBaseName(dir)} first.` : "Open a project in OpenChamber to use this";
    list.append(lookOption("Match this project", hint, effectiveLookKind() === "project", !dir, () => applyLook("project")));
    return list;
  }
  function directionSwatches(id) {
    const strip = q("span", "ds-ds-swatches ds-look-swatches");
    strip.setAttribute("aria-hidden", "true");
    for (const value of Object.values(DIRECTIONS[id].tokens).slice(0, 6)) {
      const swatch = q("span", "ds-ds-swatch");
      swatch.style.background = value;
      strip.append(swatch);
    }
    return strip;
  }
  function renderLookDirections() {
    const list = q("div", "ds-look-list");
    const current = effectiveLookKind() === "direction" ? state.pageDirection : null;
    list.append(lookOption("Auto", "Infer from the brief", current === "auto", false, () => applyLook("direction", { direction: "auto" })));
    for (const id of Object.keys(DIRECTIONS)) {
      const direction = DIRECTIONS[id];
      list.append(lookOption(direction.name, `For ${direction.when}`, current === id, false, () => applyLook("direction", { direction: id }), directionSwatches(id)));
    }
    return list;
  }
  function renderDesignSystemDetail(detail, id) {
    detail.replaceChildren();
    const preset = findDesignSystem(id);
    if (!preset) {
      detail.append(q("div", "ds-ds-detail-name", "No preset"));
      detail.append(q("p", "ds-ds-detail-desc", "Point at a preset to see its colors. Its tokens and DESIGN.md become the rules every screen follows."));
      return;
    }
    detail.append(q("div", "ds-ds-detail-name", preset.name));
    detail.append(q("div", "ds-ds-detail-cat", preset.category));
    detail.append(q("p", "ds-ds-detail-desc", preset.description));
    const swatches = designSystemSwatches(preset);
    if (swatches.length > 0) {
      const strip = q("div", "ds-ds-swatches");
      for (const token of swatches) {
        const swatch = q("span", "ds-ds-swatch");
        swatch.style.background = token.value;
        swatch.title = `${token.name} ${token.value}`;
        swatch.setAttribute("aria-label", `${token.name} ${token.value}`);
        strip.append(swatch);
      }
      detail.append(strip);
    }
  }
  function renderDesignSystemPanel() {
    const panel = q("div", "ds-ds-presets");
    const toolbar = q("div", "ds-ds-toolbar");
    const search = q("input", "ds-ds-search");
    search.type = "search";
    search.placeholder = "Search presets";
    search.setAttribute("aria-label", "Search design-system presets");
    search.value = dsQuery;
    toolbar.append(search);
    const body = q("div", "ds-ds-body");
    const list = q("div", "ds-ds-list");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Design-system presets");
    const detail = q("div", "ds-ds-detail");
    body.append(list, detail);
    const actions = q("div", "ds-ds-foot");
    const clear = q("button", "ds-ds-clear", "No preset");
    clear.type = "button";
    clear.addEventListener("click", () => applyLook("preset", { presetId: null }));
    actions.append(clear);
    panel.append(toolbar, body, actions);
    const itemRefs = [];
    const chosen = effectiveLookKind() === "preset" ? state.pageDesignSystemId : null;
    const setHighlight = (id) => {
      if (dsHighlight === id) return;
      dsHighlight = id;
      for (const ref of itemRefs) {
        const on = ref.id === dsHighlight;
        ref.el.classList.toggle("on", on);
        ref.el.setAttribute("aria-selected", on ? "true" : "false");
      }
      renderDesignSystemDetail(detail, dsHighlight);
    };
    const buildList = () => {
      itemRefs.length = 0;
      list.replaceChildren();
      const add = (preset) => {
        const on = dsHighlight === preset.id;
        const item = q("button", `ds-ds-item${on ? " on" : ""}${chosen === preset.id ? " chosen" : ""}`);
        item.type = "button";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", on ? "true" : "false");
        const main2 = q("div", "ds-ds-item-main");
        main2.append(q("span", "ds-ds-item-name", preset.name));
        main2.append(q("span", "ds-ds-item-cat", preset.category));
        item.append(main2);
        const check = q("span", "ds-ds-check");
        check.append(svgIcon('<path d="M20 6L9 17l-5-5"/>', 16));
        item.append(check);
        item.addEventListener("click", () => applyLook("preset", { presetId: preset.id }));
        item.addEventListener("mouseenter", () => setHighlight(preset.id));
        item.addEventListener("focus", () => setHighlight(preset.id));
        itemRefs.push({ id: preset.id, el: item });
        list.append(item);
      };
      const shown = filterDesignSystems(dsQuery);
      for (const group of designSystemGroups(shown)) {
        list.append(q("div", "ds-ds-group", group.category));
        for (const preset of group.presets) add(preset);
      }
      if (shown.length === 0) list.append(q("div", "ds-ds-empty", "No presets match your search."));
    };
    buildList();
    renderDesignSystemDetail(detail, dsHighlight);
    search.addEventListener("input", () => {
      dsQuery = search.value;
      if (dsHighlight !== null && !filterDesignSystems(dsQuery).some((preset) => preset.id === dsHighlight)) {
        dsHighlight = null;
      }
      buildList();
      renderDesignSystemDetail(detail, dsHighlight);
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target !== clear && dsHighlight) {
        event.preventDefault();
        applyLook("preset", { presetId: dsHighlight });
      }
    });
    if (state.overlay === "look") queueMicrotask(() => search.focus());
    return panel;
  }
  function toggleDevice(id) {
    if (id === null) setPagePref({ devices: [] });
    else if (state.pageDevices.includes(id)) setPagePref({ devices: state.pageDevices.filter((device) => device !== id) });
    else setPagePref({ devices: DEVICE_ORDER.filter((device) => device === id || state.pageDevices.includes(device)) });
  }
  function renderDevicesPanel() {
    const panel = q("div", "ds-ds-panel ds-devices-panel");
    const list = q("div", "ds-device-list");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Devices to design for");
    const row = (id, title, hint, checked) => {
      const label = q("label", `ds-device-option${checked ? " on" : ""}`);
      const box = q("input");
      box.type = "checkbox";
      box.checked = checked;
      box.disabled = state.pageBusy;
      box.addEventListener("change", () => {
        toggleDevice(id);
        queueMicrotask(() => pageBody?.querySelector(`[data-device="${id ?? "ask"}"]`)?.focus());
      });
      box.dataset.device = id ?? "ask";
      const text = q("span", "ds-menu-main");
      text.append(q("strong", void 0, title), q("span", "ds-menu-hint", hint));
      label.append(box, text);
      return label;
    };
    list.append(row(null, "Ask me", "Detect from the project", state.pageDevices.length === 0));
    for (const id of DEVICE_ORDER) {
      const preset = DEVICE_PRESETS[id];
      list.append(row(id, deviceName(id), `${preset.width}\xD7${preset.height}`, state.pageDevices.includes(id)));
    }
    panel.append(list);
    if (state.overlay === "devices") queueMicrotask(() => panel.querySelector(".ds-device-option input")?.focus());
    return panel;
  }
  function pagePrefs() {
    return {
      questions: state.pageQuestions,
      options: state.pageOptions,
      devices: [...state.pageDevices],
      look: { kind: state.pageLookKind, presetId: state.pageDesignSystemId, direction: state.pageDirection }
    };
  }
  async function savePagePrefs() {
    try {
      await host.storage.set(PAGE_PREFS_KEY, pagePrefs());
    } catch {
    }
  }
  function setPagePref(change, refocus) {
    if (change.questions !== void 0) state.pageQuestions = change.questions;
    if (change.options !== void 0) state.pageOptions = change.options;
    if (change.devices !== void 0) state.pageDevices = DEVICE_ORDER.filter((id) => change.devices.includes(id));
    void savePagePrefs();
    rerender();
    if (refocus) queueMicrotask(() => pageBody?.querySelector(refocus)?.focus());
  }
  function isOptionsChoice(value) {
    return value === "ask" || value === 1 || value === 2 || value === 3;
  }
  async function loadPagePrefs() {
    if (state.surface !== "page") return;
    let stored;
    try {
      stored = await host.storage.get(PAGE_PREFS_KEY);
    } catch {
      return;
    }
    if (!stored || typeof stored !== "object") return;
    const value = stored;
    if (typeof value.questions === "boolean") state.pageQuestions = value.questions;
    if (isOptionsChoice(value.options)) state.pageOptions = value.options;
    if (Array.isArray(value.devices)) state.pageDevices = DEVICE_ORDER.filter((id) => value.devices.includes(id));
    const look = value.look;
    if (look && typeof look === "object") {
      if (look.kind === null || look.kind === "project" || look.kind === "preset" || look.kind === "direction") state.pageLookKind = look.kind;
      state.pageDesignSystemId = findDesignSystem(typeof look.presetId === "string" ? look.presetId : null)?.id ?? null;
      if (look.direction === "auto" || typeof look.direction === "string" && Object.hasOwn(DIRECTIONS, look.direction)) {
        state.pageDirection = look.direction;
      }
    }
    rerender();
  }
  function renderContextRow() {
    const context = q("div", "ds-context");
    const project = q("div", "ds-context-item");
    const dir = state.directory;
    if (dir) {
      project.append(q("span", "ds-context-label", "Project"));
      const name = q("span", "ds-context-value", fileBaseName(dir));
      name.title = dir;
      project.append(name, q("span", "ds-context-note", " \xB7 read for colors, fonts, components and breakpoints"));
    } else {
      project.append(q("span", "ds-context-note", "No project open \u2014 you'll confirm a palette first"));
    }
    context.append(project);
    if (!pageLocationEl) pageLocationEl = q("div", "ds-context-item ds-context-location");
    renderLocationRow(pageLocationEl);
    context.append(pageLocationEl);
    return context;
  }
  function renderStarters() {
    const wrap = q("section", "ds-starters");
    wrap.append(q("div", "ds-section-label", "Start from"));
    const grid = q("div", "ds-starter-grid");
    for (const starter of STARTERS) {
      const card = q("button", "ds-starter");
      card.type = "button";
      card.disabled = state.pageBusy;
      card.setAttribute("aria-label", `${starter.title}: ${starter.description}. ${PAGE_TYPE_LABELS[starter.type]}.`);
      card.append(starterGlyph(starter.glyph));
      const body = q("span", "ds-starter-body");
      body.append(q("strong", "ds-starter-title", starter.title));
      body.append(q("span", "ds-starter-desc", starter.description));
      card.append(body);
      card.addEventListener("click", () => {
        if (state.pageBusy) return;
        state.prompt = starter.prompt;
        state.pageType = starter.type;
        renderPage();
        updateComposerState();
        promptEl?.focus();
      });
      grid.append(card);
    }
    wrap.append(grid);
    return wrap;
  }
  function renderFooter() {
    const footer = q("footer", "ds-footer");
    const hints = q("p", "ds-hints");
    const kbd = (text) => q("kbd", void 0, text);
    hints.append(kbd("Enter"), document.createTextNode(" to start \xB7 "));
    hints.append(kbd("Shift"), document.createTextNode("+"), kbd("Enter"), document.createTextNode(" new line \xB7 "));
    hints.append(kbd("/canvas"), document.createTextNode(" in any chat opens the canvas there"));
    footer.append(hints);
    return footer;
  }
  var WORKSPACE_ROW_ICON = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>';
  function rowIcon(paths) {
    const span = q("span", "ds-list-icon");
    span.setAttribute("aria-hidden", "true");
    span.append(svgIcon(paths, 15));
    return span;
  }
  function listNote(message, kind = "info") {
    const note = q("div", `ds-list-note${kind === "error" ? " error" : ""}`);
    note.append(q("span", void 0, message));
    if (kind === "error") {
      const retry = q("button", "ds-list-retry", "Retry");
      retry.addEventListener("click", () => void loadDesignHome());
      note.append(retry);
    }
    return note;
  }
  function renderCanvasSection() {
    const section = q("section", "ds-section");
    const head = q("div", "ds-section-head");
    head.append(q("div", "ds-section-label", "Your design work"));
    section.append(head);
    const list = q("div", "ds-list");
    const view = state.workspaces ?? { kind: "loading" };
    if (view.kind === "loading") {
      list.append(listNote("Loading\u2026"));
    } else if (view.kind === "error") {
      list.append(listNote(view.message, "error"));
    } else if (view.kind === "empty") {
      list.append(listNote(NO_DESIGN_WORK_MESSAGE));
    } else {
      const shown = state.workShowAll ? view.rows : view.rows.slice(0, WORK_LIST_CAP);
      for (const row of shown) {
        list.append(renderWorkspaceListRow(row));
      }
      if (view.rows.length > WORK_LIST_CAP) {
        const more = q("button", "ds-link ds-list-more", state.workShowAll ? "Show fewer" : `Show all (${view.rows.length})`);
        more.type = "button";
        more.setAttribute("aria-expanded", String(state.workShowAll));
        more.addEventListener("click", () => {
          state.workShowAll = !state.workShowAll;
          rerender();
        });
        section.append(list, more);
        return section;
      }
    }
    section.append(list);
    return section;
  }
  function renderWorkspaceListRow(row) {
    const item = q("div", "ds-list-row");
    const key = normalizeDirPath(row.dir);
    const paint = () => {
      const ui = rowUiFor(row.dir);
      const ready = Boolean(row.url?.trim());
      const running = workspaceServerRunning(row);
      const name = row.name || fileBaseName(row.dir);
      item.classList.toggle("is-renaming", ui.renaming);
      const parts = [];
      const main2 = q("div", "ds-list-main");
      const titleLine = q("div", "ds-list-title");
      if (ui.renaming) titleLine.append(renderRenameField(row, ui));
      else titleLine.append(q("span", "ds-list-name", name));
      titleLine.append(q("span", `ds-badge${ready ? " ready" : ""}`, ready ? DESIGN_READY_BADGE : NO_CONFIG_BADGE));
      if (running) titleLine.append(q("span", "ds-badge running", "\u25CF Running"));
      main2.append(titleLine);
      main2.append(q("div", "ds-list-meta", workspaceMeta(row)));
      if (ui.renaming) {
        const body = q("div", "ds-list-open ds-list-body");
        body.append(rowIcon(WORKSPACE_ROW_ICON), main2);
        parts.push(body);
      } else {
        const open = q("button", "ds-list-open");
        open.setAttribute("aria-label", row.sessionId ? `Open the canvas chat ${name}` : `Open ${name} (starts its design chat)`);
        open.append(rowIcon(WORKSPACE_ROW_ICON), main2);
        open.append(q("span", "ds-list-go", row.sessionId ? "Open" : "Open chat"));
        open.addEventListener("click", () => void openWorkspaceListRow(row));
        parts.push(open);
      }
      if (ready && !ui.renaming) {
        const preview = q("button", "ds-list-preview", "Preview");
        preview.title = `Open the ${name} preview`;
        preview.setAttribute("aria-label", `Open the ${name} preview`);
        preview.addEventListener("click", () => void previewWorkspace(row));
        parts.push(preview);
      }
      if (running || ui.stopBusy) parts.push(renderRowStopButton(row, ui, name));
      if (!ui.renaming) parts.push(renderRowMenu(row, ui, name));
      if (ui.message) {
        const alert = q("div", "ds-list-warn ds-list-alert", ui.message);
        alert.setAttribute("role", "alert");
        parts.push(alert);
      }
      item.replaceChildren(...parts);
    };
    rowPainters.set(key, paint);
    paint();
    return item;
  }
  async function openWorkspaceListRow(row) {
    if (row.sessionId) {
      try {
        await host.openSession(row.sessionId);
      } catch (error) {
        await host.toast({ kind: "error", message: `Could not open the canvas chat: ${error instanceof Error ? error.message : String(error)}` });
      }
      return;
    }
    const name = row.name || fileBaseName(row.dir);
    const record = { dir: row.dir, name };
    let result;
    try {
      result = await host.startSession({
        providerId: "design-canvas",
        id: `workspace:${fileBaseName(row.dir)}`,
        title: name,
        url: attachUrl(row.url),
        text: workspaceOpenPrompt(record),
        navigation: "preserve",
        data: seedSessionData("hi-fi", "", record)
      });
    } catch (error) {
      await host.toast({ kind: "error", message: `Could not start the canvas chat: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (!result.sessionId || result.sent !== "sent") {
      const failure = "failure" in result ? result.failure : void 0;
      await host.toast({ kind: "error", message: `The canvas chat could not be started (${result.sent}${failure ? `: ${failure}` : ""}).` });
      return;
    }
    try {
      await host.storage.set(workspaceStorageKey(result.sessionId), record);
    } catch {
    }
    try {
      await host.openSession(result.sessionId);
    } catch (error) {
      await host.toast({ kind: "error", message: `The canvas chat could not open. Open it from Your design work. ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  var STOP_CONFIRM_MS = 4e3;
  var rowUi = /* @__PURE__ */ new Map();
  var rowPainters = /* @__PURE__ */ new Map();
  function rowUiFor(dir) {
    const key = normalizeDirPath(dir);
    let ui = rowUi.get(key);
    if (!ui) {
      ui = {
        menuOpen: false,
        renaming: false,
        renameDraft: "",
        renameBusy: false,
        stopChecking: false,
        stopBusy: false,
        stopConfirm: false,
        stopConfirmTimer: null,
        message: "",
        focusRename: false,
        focusMore: false
      };
      rowUi.set(key, ui);
    }
    return ui;
  }
  function repaintRow(dir) {
    rowPainters.get(normalizeDirPath(dir))?.();
  }
  var STOP_ICON = '<rect x="6" y="6" width="12" height="12" rx="1.5"/>';
  var MORE_ICON = '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>';
  function renderRenameField(row, ui) {
    const wrap = q("span", "ds-list-rename");
    const input = q("input", "ds-list-rename-input");
    input.type = "text";
    input.value = ui.renameDraft;
    input.disabled = ui.renameBusy;
    input.setAttribute("aria-label", `New name for ${row.name || fileBaseName(row.dir)}`);
    input.setAttribute("aria-busy", String(ui.renameBusy));
    input.addEventListener("input", () => {
      ui.renameDraft = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveRowRename(row);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation?.();
        cancelRowRename(row);
      }
    });
    input.addEventListener("blur", () => {
      if (!ui.renameBusy && ui.renaming) cancelRowRename(row);
    });
    wrap.append(input);
    if (ui.renameBusy) {
      const spinner = svgIcon('<path d="M21 12a9 9 0 1 1-6.2-8.6"/>', 14);
      spinner.classList.add("ds-reference-spinner");
      wrap.append(spinner);
    }
    if (ui.focusRename) {
      ui.focusRename = false;
      queueMicrotask(() => {
        input.focus();
        input.select?.();
      });
    }
    return wrap;
  }
  function renderRowStopButton(row, ui, name) {
    const stop = q("button", "ds-list-stop");
    stop.disabled = ui.stopBusy || ui.stopChecking;
    stop.setAttribute("aria-busy", String(ui.stopBusy));
    stop.classList.toggle("is-confirm", ui.stopConfirm);
    if (ui.stopBusy) {
      stop.textContent = "Stopping\u2026";
      stop.title = `Stopping the ${name} dev server`;
    } else if (ui.stopConfirm) {
      stop.textContent = "Confirm stop";
      stop.title = `The ${name} canvas is in use \u2014 click again to stop its dev server`;
    } else {
      stop.append(svgIcon(STOP_ICON, 14));
      stop.title = `Stop the ${name} dev server`;
    }
    stop.setAttribute("aria-label", stop.title);
    stop.addEventListener("click", () => void stopRowServer(row));
    return stop;
  }
  function renderRowMenu(row, ui, name) {
    const trigger = q("button", "ds-list-more");
    trigger.append(svgIcon(MORE_ICON, 16));
    trigger.title = `More actions for ${name}`;
    trigger.setAttribute("aria-label", trigger.title);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", String(ui.menuOpen));
    trigger.addEventListener("click", () => toggleRowMenu(row));
    const panel = q("div", "ds-ds-panel ds-row-menu");
    const option2 = (label, onClick) => {
      const item = q("button", "ds-menu-item ds-row-menu-item", label);
      item.addEventListener("click", onClick);
      panel.append(item);
    };
    option2("Rename\u2026", () => startRowRename(row));
    if (workspaceServerRunning(row)) option2("Stop dev server", () => {
      closeRowMenu(row);
      void stopRowServer(row);
    });
    option2("Copy folder path", () => {
      closeRowMenu(row);
      void copyRowPath(row);
    });
    if (ui.menuOpen) queueMicrotask(() => panel.querySelector(".ds-row-menu-item")?.focus());
    if (ui.focusMore) {
      ui.focusMore = false;
      queueMicrotask(() => trigger.focus());
    }
    const anchor = anchoredPopover({
      open: ui.menuOpen,
      trigger,
      panel,
      label: `${name} actions`,
      optionSelector: ".ds-row-menu-item",
      onClose: () => closeRowMenu(row, true),
      closeOnBackdrop: true
    });
    anchor.classList.add("ds-row-more");
    return anchor;
  }
  function toggleRowMenu(row) {
    const ui = rowUiFor(row.dir);
    const next = !ui.menuOpen;
    for (const [key, other] of rowUi) {
      if (other.menuOpen && other !== ui) {
        other.menuOpen = false;
        rowPainters.get(key)?.();
      }
    }
    ui.menuOpen = next;
    repaintRow(row.dir);
  }
  function closeRowMenu(row, refocus = false) {
    const ui = rowUiFor(row.dir);
    if (!ui.menuOpen) return;
    ui.menuOpen = false;
    ui.focusMore = refocus;
    repaintRow(row.dir);
  }
  function startRowRename(row) {
    const ui = rowUiFor(row.dir);
    ui.menuOpen = false;
    ui.renaming = true;
    ui.renameBusy = false;
    ui.renameDraft = row.name || fileBaseName(row.dir);
    ui.message = "";
    ui.focusRename = true;
    repaintRow(row.dir);
  }
  function cancelRowRename(row) {
    const ui = rowUiFor(row.dir);
    if (ui.renameBusy) return;
    ui.renaming = false;
    ui.renameDraft = "";
    ui.message = "";
    repaintRow(row.dir);
  }
  async function saveRowRename(row) {
    const ui = rowUiFor(row.dir);
    if (ui.renameBusy || !ui.renaming) return;
    const next = ui.renameDraft.trim();
    if (next === "") {
      ui.message = "Enter a name for this design.";
      ui.focusRename = true;
      repaintRow(row.dir);
      return;
    }
    if (next === (row.name || fileBaseName(row.dir))) {
      cancelRowRename(row);
      return;
    }
    ui.renameBusy = true;
    ui.message = "";
    repaintRow(row.dir);
    let failure = "";
    let saved = "";
    try {
      const result = await renameWorkspace(row.dir, next);
      if (result.ok) saved = typeof result.name === "string" && result.name.trim() !== "" ? result.name : next;
      else failure = result.error ?? "The design could not be renamed.";
    } catch (error) {
      failure = `The design could not be renamed: ${error instanceof Error ? error.message : String(error)}`;
    }
    ui.renameBusy = false;
    if (failure) {
      ui.message = failure;
      ui.focusRename = true;
      repaintRow(row.dir);
      return;
    }
    ui.renaming = false;
    ui.renameDraft = "";
    row.name = saved;
    repaintRow(row.dir);
    await applyWorkspaceRename(row.dir, saved);
    await loadCanvasWorkspaces({ quiet: true });
  }
  async function applyWorkspaceRename(dir, name) {
    if (state.workspace && sameDirPath(state.workspace.dir, dir)) {
      state.workspace = { ...state.workspace, name };
      renderRow();
      if (state.surface === "panel") renderRailControls();
    }
    const sessionId = wsSessionMap.get(normalizeDirPath(dir));
    const key = sessionId ? workspaceStorageKey(sessionId) : null;
    if (!key) return;
    try {
      const record = await host.storage.get(key);
      if (isWorkspaceRecord(record) && sameDirPath(record.dir, dir)) {
        await host.storage.set(key, { ...record, name });
      }
    } catch {
    }
  }
  async function sessionBusyState(sessionId) {
    if (sessionId === state.sessionId) return state.sessionBusy;
    try {
      const projects = await host.listProjects();
      if (projects.state !== "ready") return null;
      for (const project of projects.projects) {
        const sessions = await host.listSessions(project.id);
        const found = sessions.sessions.find((candidate) => candidate.id === sessionId);
        if (found) return found.activity !== "idle";
      }
    } catch {
      return null;
    }
    return null;
  }
  async function rowStopNeedsConfirm(row) {
    try {
      const live = await getState();
      if (live.windowOpen === true && typeof live.dir === "string" && sameDirPath(live.dir, row.dir)) return true;
    } catch {
      return true;
    }
    if (!row.sessionId) return false;
    return await sessionBusyState(row.sessionId) !== false;
  }
  function disarmRowStop(ui) {
    ui.stopConfirm = false;
    if (ui.stopConfirmTimer) clearTimeout(ui.stopConfirmTimer);
    ui.stopConfirmTimer = null;
  }
  async function stopRowServer(row) {
    const ui = rowUiFor(row.dir);
    if (ui.stopBusy || ui.stopChecking) return;
    if (!ui.stopConfirm) {
      ui.stopChecking = true;
      let confirm;
      try {
        confirm = await rowStopNeedsConfirm(row);
      } finally {
        ui.stopChecking = false;
      }
      if (confirm) {
        ui.stopConfirm = true;
        ui.message = "";
        ui.stopConfirmTimer = setTimeout(() => {
          disarmRowStop(ui);
          repaintRow(row.dir);
        }, STOP_CONFIRM_MS);
        repaintRow(row.dir);
        return;
      }
    }
    disarmRowStop(ui);
    ui.stopBusy = true;
    ui.message = "";
    repaintRow(row.dir);
    try {
      const result = await stopWorkspaceServer(row.dir);
      if (result.stopped) {
        for (const started of [...state.startedServers]) {
          if (sameDirPath(started, row.dir)) state.startedServers.delete(started);
        }
        if (state.workspace && sameDirPath(state.workspace.dir, row.dir)) {
          state.serverStatus = false;
          state.serverError = null;
          renderServerControl();
        }
      } else {
        ui.message = result.error ?? await manualStopRefusalMessage(row.dir);
      }
    } catch (error) {
      ui.message = `Could not stop the dev server: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      ui.stopBusy = false;
      repaintRow(row.dir);
    }
    await loadCanvasWorkspaces({ quiet: true });
  }
  async function copyRowPath(row) {
    try {
      await copyPath(row.dir);
      await host.toast({ kind: "success", message: "Folder path copied." });
    } catch (error) {
      await host.toast({ kind: "error", message: `Could not copy the folder path: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  var designsSettings = null;
  var designsSettingsLoad = "idle";
  var locationEditorOpen = false;
  async function loadDesignsSettings() {
    if (isHiddenResolvePane()) return designsSettings;
    designsSettingsLoad = "loading";
    try {
      const result = await getSettings();
      designsSettings = isDesignsSettings(result) ? result : null;
      designsSettingsLoad = designsSettings ? "loaded" : "error";
    } catch {
      designsSettingsLoad = "error";
    }
    return designsSettings;
  }
  var ENV_OVERRIDE_LABEL = "Set by DS_WORKSPACE_ROOT";
  async function openLocationEditor(anchorEl, onDone) {
    if (isHiddenResolvePane()) return;
    locationEditorOpen = true;
    const close = (changed) => {
      locationEditorOpen = false;
      onDone(changed);
    };
    anchorEl.replaceChildren(q("div", "ds-location-note", "Loading the designs folder\u2026"));
    const settings = await loadDesignsSettings();
    const editor = q("div", "ds-location-editor");
    editor.setAttribute("role", "group");
    editor.setAttribute("aria-label", "Designs folder");
    const cancel = q("button", "ds-location-cancel", settings?.envOverride || !settings ? "Close" : "Cancel");
    cancel.addEventListener("click", () => close(false));
    if (!settings) {
      const error2 = q("div", "ds-home-warn ds-location-error", "Could not read the designs folder from the local service.");
      error2.setAttribute("role", "alert");
      editor.append(error2, cancel);
      anchorEl.replaceChildren(editor);
      return;
    }
    if (settings.envOverride) {
      editor.append(q("div", "ds-location-path", settings.workspaceRoot));
      editor.append(q("div", "ds-location-readonly", ENV_OVERRIDE_LABEL));
      editor.append(cancel);
      anchorEl.replaceChildren(editor);
      return;
    }
    const input = q("input", "ds-location-input");
    input.type = "text";
    input.value = settings.workspaceRoot;
    input.setAttribute("aria-label", "Designs folder path");
    const error = q("div", "ds-home-warn ds-location-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const save = q("button", "primary ds-location-save", "Save");
    const reset = q("button", "ds-location-default", "Use default");
    reset.title = `Use the default folder: ${settings.defaultRoot}`;
    const actions = q("div", "ds-location-actions");
    actions.append(save, reset, cancel);
    let busy = false;
    const setBusy = (on) => {
      busy = on;
      input.disabled = on;
      save.disabled = on;
      reset.disabled = on;
      cancel.disabled = on;
      save.textContent = on ? "Saving\u2026" : "Save";
      editor.setAttribute("aria-busy", String(on));
    };
    const submit = async (value) => {
      if (busy) return;
      if (value !== null && value.trim() === "") {
        error.textContent = "Enter a full folder path, or choose Use default.";
        error.hidden = false;
        return;
      }
      setBusy(true);
      error.hidden = true;
      let failure = "";
      try {
        const result = await putSettings(value === null ? null : value.trim());
        if (!result.ok) failure = result.error || "The designs folder could not be changed.";
      } catch (caught) {
        failure = `The designs folder could not be changed: ${caught instanceof Error ? caught.message : String(caught)}`;
      }
      if (failure) {
        setBusy(false);
        error.textContent = failure;
        error.hidden = false;
        input.focus();
        return;
      }
      await loadDesignsSettings();
      if (canLoadDesignWork()) await loadCanvasWorkspaces({ quiet: true });
      close(true);
    };
    save.addEventListener("click", () => void submit(input.value));
    reset.addEventListener("click", () => void submit(null));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit(input.value);
      } else if (event.key === "Escape" && !busy) {
        event.preventDefault();
        close(false);
      }
    });
    editor.append(input, actions, error);
    anchorEl.replaceChildren(editor);
    queueMicrotask(() => input.focus());
  }
  function renderLocationRow(container) {
    container.classList.add("ds-location");
    if (isHiddenResolvePane() || state.surface === "panel" && !isRealPane()) {
      container.replaceChildren();
      container.hidden = true;
      return;
    }
    if (locationEditorOpen) return;
    const settings = designsSettings;
    if (!settings) {
      container.replaceChildren();
      container.hidden = true;
      if (designsSettingsLoad === "idle") void loadDesignsSettings().then(() => renderLocationRow(container));
      return;
    }
    container.hidden = false;
    const line = q("div", "ds-location-line");
    line.append(q("span", "ds-location-label", "Designs: "));
    const path = q("span", "ds-location-path", middleTruncatePath(settings.workspaceRoot));
    path.title = settings.workspaceRoot;
    line.append(path, q("span", "ds-location-sep", " \xB7 "));
    if (settings.envOverride) {
      line.append(q("span", "ds-location-readonly", ENV_OVERRIDE_LABEL));
    } else {
      const change = q("button", "ds-link ds-location-change", "Change");
      change.setAttribute("aria-label", "Change the designs folder");
      change.addEventListener("click", () => void openLocationEditor(container, () => renderLocationRow(container)));
      line.append(change);
    }
    container.replaceChildren(line);
  }
  function renderWindowStatus() {
    if (hintEl) {
      hintEl.textContent = PICK_HINT;
      hintEl.classList.toggle("active", pickHintActive(state));
      hintEl.classList.toggle("idle", !pickHintActive(state));
    }
    renderSessionStatus();
    renderCanvasControls();
  }
  function renderSessionStatus() {
    if (!sessionLineEl) return;
    const ws = state.workspace;
    if (!ws) {
      sessionLineEl.textContent = state.sessionId ? NO_WORKSPACE_MESSAGE : `${NO_SESSION_HINT}, then press Start.`;
      sessionLineEl.classList.add("off");
      return;
    }
    sessionLineEl.textContent = canvasSessionStatus({
      modeOn: state.mode.on,
      workspaceDir: ws.dir,
      wsReady: projectReady(currentConfig())
    });
    sessionLineEl.classList.toggle("off", !state.mode.on);
  }
  function renderCanvasControls() {
    const ready = Boolean(state.workspace && projectReady(currentConfig()));
    const hasScreens = state.liveScreens.length > 0;
    if (playToggleBtn) {
      playToggleBtn.hidden = !ready || !hasScreens;
      if (!playToggleBtn.hidden) {
        const mode = state.liveMode;
        playToggleBtn.textContent = mode === "play" ? "Play" : "Edit";
        playToggleBtn.title = mode === "play" ? "Canvas is in play mode \u2014 click to switch to edit" : "Canvas is in edit mode \u2014 click to switch to play";
        playToggleBtn.classList.toggle("on", mode === "play");
      }
    }
    if (screenSelectEl) {
      screenSelectEl.hidden = !ready || !hasScreens;
      if (!screenSelectEl.hidden) {
        screenSelectEl.replaceChildren();
        for (const screen of state.liveScreens) {
          screenSelectEl.append(option(screen.id, screen.title || screen.id));
        }
        screenSelectEl.value = state.activeScreen ?? state.liveScreens[0]?.id ?? "";
        screenSelectEl.title = "Active screen";
        screenSelectEl.setAttribute("aria-label", "Active screen");
      }
    }
    if (focusLiveBtn) {
      focusLiveBtn.hidden = !(state.mode.on && state.windowOpen);
    }
  }
  async function onPlayToggleClick() {
    const next = state.liveMode === "play" ? "edit" : "play";
    try {
      const result = await setMode(next);
      if (result.ok === false && result.error) {
        setStatus(result.error, "error");
      } else {
        state.liveMode = next;
        state.mode.canvMode = next;
        await saveMode();
      }
    } catch (error) {
      setStatus(`Could not switch the canvas mode: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
    renderCanvasControls();
  }
  async function onScreenSelectChange() {
    const id = screenSelectEl?.value;
    const ws = state.workspace;
    if (!id || !ws) return;
    try {
      await openWorkspace({ dir: ws.dir, screen: id, focus: false });
      state.activeScreen = id;
    } catch (error) {
      setStatus(`Could not switch screens: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
    renderCanvasControls();
  }
  async function onFocusClick() {
    try {
      await focusLive();
    } catch {
    }
  }
  function renderRow() {
    if (barEl) barEl.classList.toggle("hidden", false);
    if (hintEl) hintEl.classList.toggle("hidden", !projectReady(currentConfig()));
    if (!projectReady(currentConfig()) && focusInside(hintEl)) focusSessionLine();
    renderServerControl();
    renderWindowStatus();
  }
  async function applyState(stateData) {
    state.url = stateData.url;
    state.title = stateData.title;
    state.windowOpen = stateData.windowOpen;
    if (stateData.mode === "edit" || stateData.mode === "play") state.liveMode = stateData.mode;
    if (stateData.screens !== void 0) state.liveScreens = stateData.screens.map((screen) => ({ ...screen }));
    state.activeScreen = stateData.activeScreen ?? null;
    const registry = shouldToastRegistryError(state.registryErrorNotified, stateData.registryError ?? null);
    state.registryErrorNotified = registry.key;
    if (registry.toast) {
      await host.toast({ kind: "error", message: registryErrorToastMessage(stateData.registryError) });
    }
    renderWindowStatus();
    if (!state.windowOpen && state.mode.on && !state.pendingOpen) {
      await turnModeOffByWindowClose();
    }
  }
  async function turnModeOffByWindowClose() {
    if (!state.mode.on) return;
    state.mode.on = false;
    state.pendingOpen = false;
    await saveMode();
    renderModeUi();
    try {
      await requestDevServerStop();
    } catch {
    }
  }
  async function poll() {
    try {
      await syncRowFromStorage();
    } catch {
    }
    if (document.visibilityState !== "visible") return;
    void readStudioConfig(false);
    try {
      await applyState(await getState());
    } catch (error) {
      setStatus(error instanceof ServiceUnavailable ? `Local service not ready: ${error.message}` : `Live canvas error: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
    void refreshServerStatus();
  }
  function renderModeUi() {
    if (modeToggleBtn) {
      modeToggleBtn.textContent = state.mode.on ? "Design Mode: ON" : "Design Mode: OFF";
      modeToggleBtn.title = state.mode.on ? "Design Mode is on \u2014 click to turn it off" : "Design Mode is off \u2014 click to turn it on";
      modeToggleBtn.classList.toggle("on", state.mode.on);
    }
    renderSessionStatus();
    renderRailControls();
  }
  function surfaceKind(surface) {
    if (surface === "status") return "row";
    if (surface === "panel") return "rail";
    if (surface === "page") return "page";
    return "none";
  }
  function setSurfaceHeight(height) {
    if (state.surface !== "status") return;
    void host.setHeight(height).catch(() => {
    });
  }
  var reportedStatusHeight = 0;
  var statusHeightObserver = null;
  var statusHeightGeneration = 0;
  function reportContentHeight(content, generation) {
    if (content !== statusRoot || generation !== statusHeightGeneration || state.surface !== "status") return;
    const verticalMargins = (element) => {
      const style = window.getComputedStyle(element);
      return (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    };
    const height = Math.ceil(content.getBoundingClientRect().height + verticalMargins(content) + verticalMargins(document.body));
    if (height <= 0 || Math.abs(height - reportedStatusHeight) <= 1) return;
    reportedStatusHeight = height;
    setSurfaceHeight(height);
  }
  function observeRowHeight() {
    statusHeightObserver?.disconnect();
    statusHeightObserver = null;
    const generation = ++statusHeightGeneration;
    reportedStatusHeight = 0;
    const content = statusRoot;
    if (!content || state.surface !== "status") return;
    if (typeof ResizeObserver === "undefined") {
      reportContentHeight(content, generation);
      return;
    }
    statusHeightObserver = new ResizeObserver(() => reportContentHeight(content, generation));
    statusHeightObserver.observe(content);
    reportContentHeight(content, generation);
  }
  function buildRow(root) {
    statusRoot = q("div", "ds-statusmode");
    const bar = q("div", "ds-rowline");
    serverBtn = q("button", "ds-server-control");
    serverBtn.addEventListener("click", () => void onServerControlClick());
    serverBtn.hidden = true;
    modeToggleBtn = q("button", "primary");
    modeToggleBtn.addEventListener("click", () => {
      void toggleMode(!state.mode.on);
    });
    playToggleBtn = q("button", "ds-chip ds-play-toggle");
    playToggleBtn.hidden = true;
    playToggleBtn.addEventListener("click", () => void onPlayToggleClick());
    screenSelectEl = q("select", "ds-screen-select");
    screenSelectEl.hidden = true;
    screenSelectEl.addEventListener("change", () => void onScreenSelectChange());
    focusLiveBtn = q("button", "ds-chip ds-focus");
    focusLiveBtn.textContent = "Focus";
    focusLiveBtn.title = "Raise the live canvas window";
    focusLiveBtn.hidden = true;
    focusLiveBtn.addEventListener("click", () => void onFocusClick());
    bar.append(serverBtn, modeToggleBtn, playToggleBtn, screenSelectEl, focusLiveBtn);
    barEl = bar;
    sessionLineEl = q("div", "ds-sessionline");
    hintEl = q("span", "ds-hintline");
    serverAnnounceEl = q("div", "ds-server-announce");
    serverAnnounceEl.setAttribute("aria-live", "polite");
    serverAnnounceEl.setAttribute("aria-atomic", "true");
    statusRoot.append(bar, sessionLineEl, hintEl, serverAnnounceEl);
    root.append(statusRoot);
    renderRow();
    observeRowHeight();
  }
  function buildPage(root) {
    const wrap = q("div", "ds ds-page");
    pageBody = q("div", "ds-page-body");
    referenceLiveEl = q("div", "ds-reference-announcement");
    referenceLiveEl.setAttribute("role", "status");
    referenceLiveEl.setAttribute("aria-live", "polite");
    referenceLiveEl.setAttribute("aria-atomic", "true");
    wrap.append(pageBody, referenceLiveEl);
    root.append(wrap);
    window.addEventListener("click", onPageWindowClick);
    window.addEventListener("keydown", onPageKeydown);
    wrap.addEventListener("dragenter", onPageDragEnter);
    wrap.addEventListener("dragover", onPageDragOver);
    wrap.addEventListener("dragleave", onPageDragLeave);
    wrap.addEventListener("drop", onPageDrop);
    window.addEventListener("dragover", onPageWindowDragOver);
    window.addEventListener("drop", onPageWindowDrop);
    renderPage();
    void loadPagePrefs();
    void loadDesignHome();
  }
  function onPageWindowDragOver(event) {
    if (dragHasFiles(event)) event.preventDefault();
  }
  function onPageWindowDrop(event) {
    if (dragHasFiles(event)) {
      event.preventDefault();
      dragDepth = 0;
      pageBody?.classList.remove("ds-drop");
    }
  }
  function build(root) {
    const kind = surfaceKind(state.surface);
    if (kind === "row") {
      buildRow(root);
      return;
    }
    if (kind === "rail") {
      buildRail(root);
      return;
    }
    if (kind === "page") {
      buildPage(root);
    }
  }
  var RAIL_POLL_MS = 2e3;
  var RAIL_CLAIM_DELAY_MS = 4e3;
  var railClaimDelayMs = RAIL_CLAIM_DELAY_MS;
  var RAIL_FOOTER_HINT = "Full home: Design Canvas in the sidebar.";
  var railStatusEl = null;
  var railPrimaryBtn = null;
  var railPrimaryHintEl = null;
  var railPromptEl = null;
  var railStartBtn = null;
  var railErrorEl = null;
  var railWorkEl = null;
  var railLocationEl = null;
  var railBusy = false;
  var railLive = false;
  var railWorkLoaded = false;
  function buildRail(root) {
    const wrap = q("div", "ds ds-rail");
    railStatusEl = q("div", "ds-rail-status");
    railStatusEl.setAttribute("role", "status");
    railPrimaryBtn = q("button", "primary ds-rail-primary");
    railPrimaryBtn.addEventListener("click", () => void onRailPrimaryClick());
    railPrimaryHintEl = q("div", "ds-rail-hint");
    const brief = q("div", "ds-rail-brief");
    railPromptEl = q("textarea", "ds-rail-input");
    railPromptEl.rows = 3;
    railPromptEl.placeholder = "Describe a new design\u2026";
    railPromptEl.setAttribute("aria-label", "Design brief");
    railPromptEl.value = state.prompt;
    railPromptEl.addEventListener("input", () => {
      state.prompt = railPromptEl?.value ?? "";
      renderRailControls();
    });
    railPromptEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void onRailStartDesign();
      }
    });
    railStartBtn = q("button", "ds-rail-start", "Start design");
    railStartBtn.title = "Start a new design chat with this brief";
    railStartBtn.addEventListener("click", () => void onRailStartDesign());
    railErrorEl = q("div", "ds-home-warn ds-rail-error");
    railErrorEl.setAttribute("role", "alert");
    brief.append(railPromptEl, railStartBtn, railErrorEl);
    railWorkEl = q("div", "ds-rail-work");
    railLocationEl = q("div", "ds-rail-location");
    railLocationEl.hidden = true;
    const footer = q("div", "ds-rail-footer", RAIL_FOOTER_HINT);
    wrap.append(railStatusEl, railPrimaryBtn, railPrimaryHintEl, brief, railWorkEl, railLocationEl, footer);
    root.append(wrap);
    window.addEventListener("resize", onRailWake);
    window.addEventListener("focus", onRailWake);
    document.addEventListener("visibilitychange", onRailWake);
    renderRail();
  }
  function railStatusText() {
    if (!state.sessionId) return "This chat has not started yet.";
    const ws = state.workspace;
    if (!ws) return "No canvas for this chat yet.";
    return canvasSessionStatus({ modeOn: state.mode.on, workspaceDir: ws.dir, wsReady: projectReady(currentConfig()) });
  }
  function renderRailControls() {
    if (!railPrimaryBtn) return;
    if (railStatusEl) {
      railStatusEl.textContent = railStatusText();
      railStatusEl.classList.toggle("off", !state.workspace || !state.mode.on);
    }
    const working = railBusy || state.serverPending;
    railPrimaryBtn.textContent = working ? "Working\u2026" : state.workspace ? "Open canvas" : "Create canvas";
    railPrimaryBtn.disabled = working || !state.sessionId;
    railPrimaryBtn.title = !state.sessionId ? NO_SESSION_HINT : state.workspace ? state.windowOpen ? "Raise the live canvas window" : "Open the live canvas for this chat" : "Create a Design Canvas workspace for this chat";
    if (railPrimaryHintEl) {
      railPrimaryHintEl.textContent = state.sessionId ? "" : NO_SESSION_HINT;
      railPrimaryHintEl.hidden = Boolean(state.sessionId);
    }
    if (railPromptEl) {
      if (railPromptEl.value !== state.prompt) railPromptEl.value = state.prompt;
      railPromptEl.disabled = state.pageBusy;
    }
    if (railStartBtn) {
      const ready = canSend();
      railStartBtn.disabled = !ready;
      railStartBtn.textContent = state.pageBusy ? "Starting\u2026" : "Start design";
      railStartBtn.setAttribute("aria-busy", String(state.pageBusy));
    }
    if (railErrorEl) {
      railErrorEl.textContent = state.pageError;
      railErrorEl.hidden = state.pageError === "";
    }
  }
  function renderRailWork() {
    if (!railWorkEl) return;
    if (!isRealPane() || !railWorkLoaded) {
      railWorkEl.replaceChildren();
      return;
    }
    railWorkEl.replaceChildren(renderCanvasSection());
  }
  function renderRailLocation() {
    if (!railLocationEl) return;
    if (!isRealPane() || !railWorkLoaded) {
      railLocationEl.replaceChildren();
      railLocationEl.hidden = true;
      return;
    }
    renderLocationRow(railLocationEl);
  }
  function renderRail() {
    renderRailControls();
    renderRailWork();
    renderRailLocation();
  }
  async function onRailPrimaryClick() {
    if (railBusy || state.serverPending || !isRealPane()) return;
    if (!state.sessionId) {
      await host.toast({ kind: "error", message: NO_SESSION_MESSAGE });
      return;
    }
    railBusy = true;
    renderRailControls();
    try {
      if (state.workspace) {
        if (state.windowOpen) {
          try {
            await focusLive();
          } catch (error) {
            setStatus(`Focus failed: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
          return;
        }
        await handRailOpenToRow({ record: state.workspace, jobId: null });
        return;
      }
      const prepared = await prepareCanvasWorkspace("", state.sessionId, modeScaffoldChoice());
      if ("error" in prepared) {
        if (prepared.noSession) await host.toast({ kind: "error", message: NO_SESSION_MESSAGE });
        return;
      }
      await handRailOpenToRow(prepared);
    } finally {
      railBusy = false;
      renderRail();
    }
  }
  async function handRailOpenToRow(ws) {
    const sessionId = state.sessionId;
    await armDesignModeForRow(ws, null, void 0);
    renderRailControls();
    await sleep(railClaimDelayMs);
    if (!isRealPane() || state.sessionId !== sessionId) return;
    const claimed = await beginOpenHandoff();
    if (claimed) await claimed.task;
  }
  async function onRailStartDesign() {
    if (!canSend()) return;
    await startNewDesign();
    renderRail();
  }
  async function refreshRail() {
    if (!isRealPane() || document.visibilityState !== "visible") return;
    const sessionId = state.sessionId;
    if (sessionId) {
      const record = await readStoredWorkspace(sessionId);
      if (sessionId === state.sessionId) {
        if (record && !(state.workspace && sameDirPath(state.workspace.dir, record.dir))) bindWorkspace(record);
        else if (!record && state.workspace && !railBusy) state.workspace = null;
      }
      await syncModeFromStorage();
    }
    try {
      state.windowOpen = (await getState()).windowOpen === true;
    } catch {
    }
    renderRailControls();
  }
  async function loadRailWork() {
    if (!isRealPane()) return;
    railWorkLoaded = true;
    await Promise.all([loadDesignHome(), loadDesignsSettings()]);
    renderRailLocation();
  }
  function startRailLive() {
    if (railLive || state.surface !== "panel" || !isRealPane()) return;
    railLive = true;
    void refreshRail();
    void loadRailWork();
    setInterval(() => void refreshRail(), RAIL_POLL_MS);
  }
  function onRailWake() {
    if (!isRealPane()) return;
    if (!railLive) {
      startRailLive();
      return;
    }
    if (document.visibilityState !== "visible") return;
    void refreshRail();
    void loadRailWork();
  }
  function mountSurface(root) {
    build(root);
    setStatus("Loading\u2026");
    void loadMode();
    void loadWorkspace();
    void loadStudioConfig();
    const kind = surfaceKind(state.surface);
    if (kind === "row") {
      void poll();
      setInterval(() => void poll(), POLL_MS);
      startPickLoop();
    } else if (kind === "rail") {
      startRailLive();
    }
  }
  async function main() {
    const root = document.getElementById("root");
    if (!root) throw new Error("missing #root");
    host.onResolve((request) => resolveCanvasCommand(request.args));
    let started = false;
    host.onReady((context) => {
      applyHostReady(context, document.documentElement);
      state.surface = context.surface;
      state.directory = context.directory;
      state.sessionId = context.session?.id ?? null;
      state.resolveAllowed = context.surface === "panel" || context.surface === "page";
      if (started) return;
      started = true;
      mountSurface(root);
    });
    host.onSession((session) => {
      void applySessionSnapshot(session);
    });
    host.onSessionLifecycle((event) => {
      void handleSessionLifecycle(event);
    });
    host.onDirectory((directory) => {
      state.directory = directory;
      state.serverStatus = null;
      state.serverPending = false;
      state.serverError = null;
      renderRow();
      rerender();
    });
  }
  function setProjectDirectory(dir) {
    state.directory = dir;
    directoryGeneration += 1;
    state.serverStatus = null;
    state.serverPending = false;
    state.serverError = null;
  }
  function setWorkspace(workspace) {
    state.workspace = workspace;
    if (workspace) state.configDir = null;
  }
  function getWorkspaceState() {
    return state.workspace;
  }
  function setSurface(surface) {
    state.surface = surface;
  }
  function setPrompt(prompt) {
    state.prompt = prompt;
  }
  function getPageDraft() {
    return { prompt: state.prompt, references: state.references.map((reference) => ({ ...reference })), error: state.pageError, path: attachPathDraft, referenceError, pending: referencePending };
  }
  function resetReferenceDraft() {
    cancelReferenceValidation();
    state.references = [];
    attachPathDraft = "";
    referenceError = "";
  }
  function setSessionId(id) {
    state.sessionId = id;
  }
  function getModeState() {
    return { ...state.mode };
  }
  function getPendingOpen() {
    return state.pendingOpen;
  }
  function setPageChoice(choice) {
    if (choice.type) state.pageType = choice.type;
    if (choice.direction) state.pageDirection = choice.direction;
    if (choice.look !== void 0) state.pageLookKind = choice.look;
    if (choice.presetId !== void 0) state.pageDesignSystemId = choice.presetId;
  }
  function getPageChoice() {
    return { type: state.pageType, spec: pageBriefSpec() };
  }
  function getPagePrefs() {
    return pagePrefs();
  }
  async function setPagePrefs(change) {
    if (change.look) {
      state.pageLookKind = change.look.kind;
      state.pageDesignSystemId = change.look.presetId;
      state.pageDirection = change.look.direction;
    }
    setPagePref(change);
    await savePagePrefs();
  }
  function resetPagePrefs() {
    state.pageQuestions = true;
    state.pageOptions = "ask";
    state.pageDevices = [];
    state.pageLookKind = null;
    state.pageDesignSystemId = null;
    state.pageDirection = "auto";
  }
  function allowResolve(value) {
    state.resolveAllowed = value;
  }
  function setSessionBusy(busy) {
    state.sessionBusy = busy;
  }
  function resetStopState() {
    state.sessionBusy = false;
    state.pendingStop = null;
    state.startedServers.clear();
    state.serverStatus = null;
    state.serverPending = false;
    state.serverError = null;
  }
  function getStopState() {
    return {
      pendingStop: state.pendingStop !== null,
      pendingRequest: state.pendingStop ? { ...state.pendingStop } : null,
      sessionBusy: state.sessionBusy,
      startedServers: [...state.startedServers]
    };
  }
  function setStudioConfig(config) {
    state.config = config;
    state.configDir = state.workspace?.dir ?? state.directory;
  }
  function getServerControlState() {
    return { status: state.serverStatus, pending: state.serverPending, error: state.serverError };
  }
  function getServerAnnouncements() {
    return [...serverAnnouncements];
  }
  function resetServerAnnouncements() {
    serverAnnouncements.length = 0;
  }
  function resetDesignsSettings() {
    designsSettings = null;
    designsSettingsLoad = "idle";
    locationEditorOpen = false;
  }
  function setRailClaimDelay(ms) {
    railClaimDelayMs = ms ?? RAIL_CLAIM_DELAY_MS;
  }
  void main();
})();

// Explicit palettes. Own shadow styles are excluded from Dark Reader's rewriting.
export const THEME_STYLES = `
:host([data-cgp-theme="light"]){color-scheme:light;--cgp-bg:#ffffff;--cgp-text:#202124;--cgp-muted:#687078;--cgp-border:#e4e6e9;--cgp-soft:#f3f4f6;--cgp-hover:#e9edf2;--cgp-link:#0057d9;--cgp-error:#b42318;--cgp-brand:#292d32;--cgp-on-brand:#fff;--cgp-success:#33765c;--cgp-shadow:0 12px 36px #18202c14,0 2px 6px #18202c0a}
:host([data-cgp-theme="dark"]){color-scheme:dark;--cgp-bg:#202328;--cgp-text:#edf0f4;--cgp-muted:#afb7c2;--cgp-border:#3d434c;--cgp-soft:#2d323a;--cgp-hover:#3b424d;--cgp-link:#91baff;--cgp-error:#ffaaa3;--cgp-brand:#e1e6ed;--cgp-on-brand:#202328;--cgp-success:#86c9ab;--cgp-shadow:0 16px 40px #0006,0 2px 8px #0003}
:host{color:var(--cgp-text);--s-color-bg-body:var(--cgp-bg);--s-color-bg-primary:var(--cgp-bg);--s-color-bg-trans:var(--cgp-soft);--s-color-bg-trans-primary:var(--cgp-hover);--s-color-text-primary:var(--cgp-text);--s-color-text-secondary:var(--cgp-text);--s-color-text-tertiary:var(--cgp-muted);--s-color-text-quaternary:var(--cgp-muted);--s-color-border-primary:var(--cgp-border);--s-color-border-secondary:var(--cgp-border);--color-neutral-100:var(--cgp-text);--color-neutral-70:var(--cgp-muted);--color-neutral-50:var(--cgp-muted);--color-bg-trans-primary:var(--cgp-hover);--color-text-primary:var(--cgp-text);--color-primary-50:var(--cgp-link);--neutral-transparent-1:var(--cgp-border);--neutral-transparent-2:var(--cgp-border);--select-assistant-bg-color:var(--cgp-bg);--select-assistant-shadow:var(--cgp-shadow)}
.cgp-popover,.contentContainer-K4iWxu{background:var(--cgp-bg);color:var(--cgp-text)}
.cgp-selected,.cgp-state,.cgp-mode,.cgp-mode-note{color:var(--cgp-muted)}
.cgp-error{color:var(--cgp-error)}
.cgp-mode select,.cgp-mindmap-tools select{background:var(--cgp-soft);color:var(--cgp-text);border-color:var(--cgp-border)}
.cgp-form textarea{background:transparent;color:var(--cgp-text);border-color:var(--cgp-border)}
textarea::placeholder,input::placeholder{color:var(--cgp-muted)}
.cgp-result a,.cgp-sources a{color:var(--cgp-link)}
.cgp-result pre,.cgp-result code,.cgp-mindmap-source pre{background:var(--cgp-soft)!important;color:var(--cgp-text)}
.cgp-result th,.cgp-result td{border-color:var(--cgp-border)}
.cgp-send{background:var(--cgp-brand);color:var(--cgp-on-brand)}
.cgp-options button[aria-pressed=true]{color:var(--cgp-link);background:var(--cgp-soft)}
.cgp-mindmap-canvas{background:var(--cgp-bg);color:var(--cgp-text)}
.cgp-mindmap-canvas svg text{fill:var(--cgp-text)!important}
.cgp-mindmap-canvas .mindmap-node rect,.cgp-mindmap-canvas .mindmap-node path,.cgp-mindmap-canvas .mindmap-node circle,.cgp-mindmap-canvas .mindmap-node polygon{fill:var(--cgp-soft)!important;stroke:var(--cgp-border)!important}
button:focus-visible,a:focus-visible,select:focus-visible,textarea:focus-visible{outline-color:var(--cgp-link)}
`;

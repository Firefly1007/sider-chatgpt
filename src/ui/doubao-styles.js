// Presentation rules for the selection toolbar and result popup.
export const DOUBAO_STYLES = `
.rootContainer-YnW249{position:relative;max-width:calc(100vw - 40px)}
.contentContainer-K4iWxu{background:var(--cgp-bg);border:1px solid var(--cgp-border);border-radius:13px;box-shadow:var(--cgp-shadow);width:max-content;max-width:100%}
.container-XupkMZ{display:flex;align-items:center;padding:2px;min-height:28px}
.actions-pdxL43{display:flex;align-items:center;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:thin}
.btnArea-GIIUrK{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;height:24px;padding:0 9px;border:0;border-radius:8px;background:transparent;color:var(--cgp-text);font-size:13px;font-weight:500;line-height:20px;white-space:nowrap}
.btnArea-GIIUrK[data-action=ask]{background:var(--cgp-soft);font-weight:650}
.btnArea-GIIUrK:hover{background:var(--cgp-hover)}
.container-yap8B5{display:flex;flex-direction:column;min-height:0;max-height:inherit;color:var(--cgp-text)}
.header-container-cL372Q{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px 10px;flex-shrink:0}
.cgp-heading{max-width:calc(50% - 26px);display:flex;align-items:center;gap:0 10px;min-width:0;flex-wrap:wrap}
.caption-ElsTYI{color:var(--cgp-text);font-size:16px;font-weight:650;line-height:24px;letter-spacing:.02em}
.options-node-nfubHU{display:flex;align-items:center;gap:4px;flex-shrink:0}
.options-btn-dUYPEp{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:transparent;color:var(--cgp-muted)}
.options-btn-dUYPEp svg{width:17px;height:17px}
.options-btn-dUYPEp:hover{background:var(--cgp-hover);color:var(--cgp-text)}
.result-YM4GhA{word-wrap:break-word}
.actionButton-DxGdJm{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;padding:4px 9px;border-radius:7px;background:transparent;color:var(--cgp-muted);font-size:12px;line-height:20px}
.actionButton-DxGdJm:hover:not(:disabled){background:var(--cgp-hover);color:var(--cgp-text)}
.popover-container-aQawvz{background:var(--cgp-bg);border:1px solid var(--cgp-border);border-radius:18px;box-shadow:var(--cgp-shadow)}
button,select{transition:background-color .14s ease,color .14s ease,box-shadow .14s ease}
@media(prefers-reduced-motion:reduce){button,select{transition:none}}
`;

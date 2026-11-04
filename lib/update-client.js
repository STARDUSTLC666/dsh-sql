// Generated: shared optional update controls; edit the original client templates.
(function(){
/* DSH workbench UI v1. MIT. Canonical source: dsh-suite/ui/workbench-ui.js.
 * Vendored into each plugin: no Suite or extra runtime dependency is required.
 * Styles are scoped to .dshw and never replace the host chrome or theme.
 */
function createWorkbenchUI(React) {
  const h = React.createElement;
  const { useEffect, useId, useRef } = React;
  const cx = (...values) => values.filter(Boolean).join(' ');
  const paths = {
    book: ['M4 4h6a3 3 0 0 1 2 2v15a4 4 0 0 0-4-2H4z', 'M20 4h-6a3 3 0 0 0-2 2v15a4 4 0 0 1 4-2h4z'],
    calendar: ['M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2Z', 'M7 3v4M17 3v4M3 10h18'],
    mail: ['M3 5h18v14H3z', 'm3 6 9 7 9-7'],
    rss: ['M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16', 'M4 19h.01'],
    slides: ['M3 4h18v13H3z', 'M12 17v4M8 21h8'],
    shield: ['m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z', 'm8 12 3 3 5-6'],
    layers: ['M5 3h16v16H5z', 'M2 7v15h15'],
    play: ['m9 6 9 6-9 6Z'],
    video: ['M3 5h12v14H3z', 'm15 10 6-4v12l-6-4'],
    search: ['M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z', 'm16 16 5 5'],
    plus: ['M12 5v14M5 12h14'],
    refresh: ['M20 7a9 9 0 1 0 1 8', 'M20 2v5h-5'],
    settings: ['m9 3-.7 2.4-2 .9L4 5.8 2.5 8.4l1.7 1.8v2.3L2.5 14 4 17l2.5-.4 1.9 1L9 20h3l.8-2.4 2-1 2.5.4 1.5-2.7-1.7-1.9v-2.2l1.7-1.8-1.5-2.6-2.5.4-2-1L12 3Z', 'M14 11.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z'],
    close: ['m6 6 12 12M18 6 6 18'],
    left: ['m14 5-7 7 7 7'],
    right: ['m10 5 7 7-7 7'],
    down: ['m5 9 7 7 7-7'],
    filter: ['M4 5h16M7 12h10M10 19h4'],
    download: ['M12 3v12m-5-5 5 5 5-5', 'M4 16v5h16v-5'],
    upload: ['M12 16V4m-5 5 5-5 5 5', 'M4 16v5h16v-5'],
    copy: ['M8 8h13v13H8z', 'M16 8V3H3v13h5'],
    external: ['M14 3h7v7m0-7L10 14', 'M10 3H3v18h18v-7'],
    file: ['M4 3h10l6 6v12H4z', 'M14 3v6h6M8 13h8M8 17h6'],
    folder: ['M3 5h7l2 3h9v12H3z'],
    edit: ['m15 4 5 5-10 10-6 1 1-6Z', 'm13 6 5 5'],
    trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
    more: ['M5 12h.01M12 12h.01M19 12h.01'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 11v6M12 7h.01'],
    check: ['m5 12 4 4L19 6'],
    quote: ['M4 12h6v7H3v-7c0-4 2-6 5-7M15 12h6v7h-7v-7c0-4 2-6 5-7'],
    star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z'],
    reply: ['m9 5-7 7 7 7v-5h6c3 0 5 2 6 5 0-8-4-11-12-11Z'],
    link: ['m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0', 'm14 8 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0'],
  };
  function Icon({ name = 'file', size = 20, ...props }) {
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false, ...props },
      (paths[name] || paths.file).map((d, index) => h('path', { key: index, d })));
  }
  function Button({ children, icon, variant, className, ...props }) {
    return h('button', { type: 'button', ...props, className: cx('w-button', variant && 'w-' + variant, className) }, icon ? h(Icon, { name: icon, size: 18 }) : null, children);
  }
  function IconButton({ label, icon, ...props }) {
    return h(Button, { ...props, icon, className: cx('w-icon-button', props.className), 'aria-label': label, title: label });
  }
  function Page({ title, subtitle, actions, children, workbench = false, className, rootRef, ...props }) {
    return h('section', { ...props, ref: rootRef, className: cx('dshw', 'w-page', className), 'data-main': workbench ? 'true' : 'false' },
      h(Styles, { key: 'styles' }),
      h('header', { className: 'w-page-header' }, h('div', { className: 'w-heading' }, h('h1', null, title), subtitle ? h('p', { className: 'w-subtitle' }, subtitle) : null), actions ? h('div', { className: 'w-header-actions' }, actions) : null),
      h('div', { className: 'w-body' }, children));
  }
  function Tabs({ items, value, onChange, label, children }) {
    const id = useId();
    const active = items.some(item => item.id === value) ? value : items[0]?.id;
    function keys(event, index) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      const node = event.currentTarget.parentElement?.querySelectorAll('[role=tab]')[next];
      if (node) { onChange(items[next].id); node.focus(); }
    }
    return h('div', { className: 'w-tabs-layout' },
      h('div', { className: 'w-tabs', role: 'tablist', 'aria-label': label }, items.map((item, index) => h('button', {
        type: 'button', role: 'tab', key: item.id, id: id + '-' + item.id, 'aria-controls': id + '-panel', 'aria-selected': active === item.id, tabIndex: active === item.id ? 0 : -1,
        onClick: () => onChange(item.id), onKeyDown: event => keys(event, index),
      }, item.label, item.count !== undefined ? h('span', { className: 'w-count' }, item.count) : null))),
      h('div', { className: 'w-tab-panel', id: id + '-panel', role: 'tabpanel', 'aria-labelledby': id + '-' + active }, children));
  }
  function Status({ children, tone = 'info', className }) {
    if (!children) return null;
    return h('div', { className: cx('dshw', 'w-status', 'w-status-' + tone, className), role: tone === 'error' ? 'alert' : 'status', 'aria-live': tone === 'error' ? 'assertive' : 'polite' }, h(Icon, { name: tone === 'success' ? 'check' : 'info', size: 18 }), h('div', null, children));
  }
  function Empty({ title, children, action, icon = 'file' }) {
    return h('div', { className: 'dshw w-empty' }, h(Styles, { key: 'styles' }), h(Icon, { name: icon, size: 32 }), h('h2', null, title), children ? h('div', { className: 'w-muted' }, children) : null, action ? h('div', { className: 'w-toolbar' }, action) : null);
  }
  function Split({ list, detail, selected, onBack, backLabel, className, listWidth = 360 }) {
    const ref = useRef(null);
    useEffect(() => {
      if (!selected || !ref.current || ref.current.clientWidth > 760) return;
      const heading = ref.current.querySelector('.w-detail h2');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }, [selected]);
    return h('div', { ref, className: cx('w-split', className), 'data-selected': selected ? 'true' : 'false', style: { '--w-list-width': listWidth + 'px' } },
      h('div', { className: 'w-master' }, list),
      h('div', { className: 'w-detail' }, selected ? h(Button, { className: 'w-back', icon: 'left', variant: 'ghost', onClick: onBack }, backLabel) : null, detail));
  }
  function Row({ title, meta, description, active, onClick, children, status, className, disabled }) {
    return h('div', { className: cx('w-row', active && 'w-selected', className) },
      children ? h('div', { className: 'w-row-select' }, children) : null,
      h('button', { type: 'button', className: 'w-row-button', onClick, disabled, 'aria-pressed': !!active },
        h('span', { className: 'w-row-head' }, h('strong', null, title), status ? h('span', { className: 'w-tag' }, status) : null),
        meta ? h('span', { className: 'w-row-meta' }, meta) : null,
        description ? h('span', { className: 'w-row-description' }, description) : null));
  }
  function Search({ label, value, onChange, ...props }) {
    const id = useId();
    return h('div', { className: 'w-search' }, h(Icon, { name: 'search', size: 18 }), h('input', { type: 'search', id, 'aria-label': label, placeholder: label, value, onChange, ...props }));
  }
  function Switch({ label, checked, onChange, disabled }) {
    return h('label', { className: 'w-switch-label' }, h('span', null, label), h('input', { type: 'checkbox', role: 'switch', checked, disabled, onChange, 'aria-label': label }), h('span', { className: 'w-switch-track', 'aria-hidden': true }));
  }
  function Dialog({ title, children, onClose, closeLabel, className, busy = false }) {
    const id = useId(), panel = useRef(null);
    useEffect(() => {
      const previous = document.activeElement;
      panel.current?.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')?.focus();
      return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
    }, []);
    function keydown(event) {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(node => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!controls.length) { event.preventDefault(); panel.current.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return h('div', { className: 'dshw w-overlay', onClick: event => { if (!busy && event.target === event.currentTarget) onClose(); } },
      h(Styles, { key: 'styles' }),
      h('section', { ref: panel, className: cx('w-dialog', className), role: 'dialog', 'aria-modal': true, 'aria-labelledby': id, tabIndex: -1, onKeyDown: keydown },
        h('header', { className: 'w-dialog-header' }, h('h2', { id }, title), h(IconButton, { icon: 'close', label: closeLabel, disabled: busy, onClick: onClose })), h('div', { className: 'w-dialog-body' }, children)));
  }
  function register(ctx, { id, label, icon, component, inject, order = 50 }) {
    // The two slots are optional. Existing settings and manual tools still load
    // in hosts without a workbench, while RC.3 owns navigation/pinning itself.
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: id, inject: () => ({ ...(inject?.() || {}), workbench: true }) }, component));
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id, order, label }, function WorkbenchIcon({ size }) { return h(Icon, { name: icon, size }); }));
  }
  const styles = `
.dshw{--w-bg:var(--dsw-alias-bg-layer-1,#fff);--w-soft:var(--dsw-alias-bg-layer-2,#f7f8fa);--w-text:var(--dsw-alias-label-primary,#18202c);--w-muted:var(--dsw-alias-label-secondary,#667085);--w-border:var(--dsw-alias-border-l3,#e7e9ef);--w-accent:var(--dsh-plugin-workbench-accent,#4f6bdb);--w-selected:color-mix(in srgb,var(--w-accent) 10%,var(--w-bg));--w-primary:var(--w-text);--w-on-primary:var(--w-bg);container-type:inline-size;container-name:dsh-workbench;color:var(--w-text);font:14px/1.65 var(--dsh-font-family-content,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif);min-width:0;max-width:100%;box-sizing:border-box;text-align:start;color-scheme:inherit}
.dshw *,.dshw *:before,.dshw *:after{box-sizing:border-box}.dshw h1,.dshw h2,.dshw h3,.dshw h4,.dshw p{margin:0}.dshw h1{font-size:30px;line-height:1.25;letter-spacing:-.025em;font-weight:650}.dshw h2{font-size:24px;line-height:1.35;font-weight:650;letter-spacing:-.015em;overflow-wrap:anywhere}.dshw h3,.dshw h4{font-size:16px;line-height:1.4;font-weight:600}.dshw a{color:var(--w-accent);text-underline-offset:3px;overflow-wrap:anywhere}.dshw button,.dshw input,.dshw select,.dshw textarea{font:inherit;color:inherit;max-width:100%}.dshw input:not([type=checkbox]):not([type=radio]):not([type=file]),.dshw select,.dshw textarea{background:var(--dsw-specific-input-major,var(--w-bg));border:1px solid var(--w-border);border-radius:8px;padding:8px 11px;min-width:0;line-height:1.5}.dshw input:not([type=checkbox]):not([type=radio]):not([type=file]),.dshw select{min-height:38px}.dshw textarea{resize:vertical}.dshw input[type=checkbox],.dshw input[type=radio]{width:16px;height:16px;flex-shrink:0;accent-color:var(--w-accent)}.dshw :focus-visible{outline:2px solid var(--w-accent);outline-offset:3px}.dshw button:disabled,.dshw input:disabled,.dshw select:disabled,.dshw textarea:disabled{opacity:.5;cursor:not-allowed}.dshw label{font-size:13px}.dshw fieldset{min-width:0;border:1px solid var(--w-border);border-radius:8px}.dshw summary{cursor:pointer;font-weight:550;list-style:none;display:flex;align-items:center;gap:8px}.dshw summary::-webkit-details-marker{display:none}.dshw summary:after{content:'';display:block;margin-inline-start:auto;width:7px;height:7px;border-inline-end:1.75px solid currentColor;border-bottom:1.75px solid currentColor;transform:rotate(45deg);flex-shrink:0}.dshw details[open]>summary:after{transform:rotate(225deg)}.dshw details>summary+*{margin-top:12px}.dshw pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;max-width:100%;background:var(--w-soft);border-radius:6px;padding:14px}.dshw img,.dshw video,.dshw iframe{max-width:100%}
.w-page{display:flex;flex-direction:column;position:relative;padding:0;min-height:540px;gap:0}.w-page[data-main=true]{height:100%;min-height:0;padding:calc(24px + var(--dsh-frame-top-clearance,0px)) 28px 0 max(28px,var(--dsh-frame-leading-clearance,0px));overflow:auto}.dshw[data-main=true]{background:var(--w-bg)}.dshw.w-page,.dshw .w-body,.dshw .w-tab-panel{overflow-x:clip}.w-page-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding-bottom:22px;flex-shrink:0}.w-heading{min-width:0}.w-subtitle{margin-top:8px!important;font-size:14px;color:var(--w-muted);line-height:1.6}.w-header-actions,.w-toolbar,.w-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}.w-header-actions{justify-content:flex-end}.w-body,.w-tabs-layout{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}.w-body{overflow:auto}.w-tab-panel{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:auto}.w-tabs{display:flex;align-items:stretch;gap:20px;border-bottom:1px solid var(--w-border);flex-shrink:0;overflow-x:auto;scrollbar-width:thin}.dshw .w-tabs>button{border:0;border-bottom:2px solid transparent;background:transparent;padding:11px 8px 13px;white-space:nowrap;font-size:14px;font-weight:550;cursor:pointer;color:var(--w-muted);display:flex;align-items:center;gap:7px}.dshw .w-tabs>button[aria-selected=true]{border-bottom-color:var(--w-accent);color:var(--w-accent)}.w-count,.w-tag{font-size:12px;line-height:1.5;display:inline-flex;align-items:center;flex-shrink:0;background:var(--w-soft);border-radius:5px;padding:1px 6px;color:var(--w-muted)}.w-tabs [aria-selected=true] .w-count,.w-selected .w-tag{color:var(--w-accent);background:var(--w-selected)}
.dshw .w-button{display:inline-flex;justify-content:center;align-items:center;gap:7px;background:var(--w-bg);border:1px solid var(--w-border);border-radius:8px;padding:8px 12px;min-height:36px;line-height:1.4;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;white-space:normal}.dshw .w-button:not(:disabled):hover{background:var(--w-soft)}.dshw .w-primary{background:var(--w-primary);border-color:var(--w-primary);color:var(--w-on-primary)}.dshw .w-primary:not(:disabled):hover{background:var(--w-primary);opacity:.9}.dshw .w-ghost{background:transparent;border-color:transparent}.dshw .w-danger{color:var(--dsw-alias-state-error-primary,#b43c3c)}.dshw .w-icon-button{width:36px;min-width:36px;padding:8px}.dshw .w-button svg{flex-shrink:0}.w-muted{color:var(--w-muted);font-size:12px;line-height:1.6}.w-section{padding:24px 0;border-bottom:1px solid var(--w-border);min-width:0}.w-section>h3{margin-bottom:12px}.w-section>p+p{margin-top:8px}.w-fields{display:grid;gap:16px;min-width:0}.w-field{display:grid;gap:6px;min-width:0}.w-field>input,.w-field>select,.w-field>textarea{width:100%}.w-status{display:flex;align-items:flex-start;gap:8px;padding:11px 13px;margin:12px 0;border:1px solid var(--w-border);border-radius:8px;background:var(--w-soft);font-size:13px;overflow-wrap:anywhere;flex-shrink:0}.w-status>svg{flex-shrink:0;margin-top:2px}.w-status-error{color:var(--dsw-alias-state-error-primary,#ad3636)}.w-status-success{color:var(--dsw-alias-state-success-primary,#24794a)}.w-status-warn{color:var(--dsw-alias-state-warning-primary,#8a5a00)}.w-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;width:100%;max-width:580px;padding:48px 24px;margin:auto;min-height:280px;overflow-wrap:anywhere}.w-empty>svg{color:var(--w-muted)}.w-empty h2{font-size:20px}.w-empty .w-muted{font-size:14px}.w-empty .w-toolbar{justify-content:center}
.w-split{display:grid;grid-template-columns:minmax(240px,var(--w-list-width)) minmax(0,1fr);min-height:460px;flex:1;min-width:0}.w-master{min-width:0;border-inline-end:1px solid var(--w-border);overflow:auto;padding-bottom:24px}.w-detail{min-width:0;padding:26px 28px;overflow:auto;overflow-wrap:anywhere;display:flex;flex-direction:column}.w-master-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:20px 16px}.w-search{display:flex;align-items:center;gap:8px;border:1px solid var(--w-border);border-radius:8px;padding:0 10px;min-width:0;flex:1;background:var(--w-bg)}.w-search>svg{color:var(--w-muted);flex-shrink:0}.dshw .w-search>input{border:0!important;background:transparent!important;padding:8px 0!important;width:100%;outline-offset:0}.w-row{display:flex;gap:0;min-width:0;position:relative;border-bottom:1px solid var(--w-border);border-inline-start:3px solid transparent}.w-row-select{display:flex;align-items:flex-start;padding:21px 0 0 14px}.dshw .w-row-button{display:flex;flex-direction:column;align-items:stretch;gap:7px;text-align:start;width:100%;padding:18px 18px 18px 16px;border:0;background:transparent;color:inherit;min-width:0;cursor:pointer;line-height:1.5}.dshw .w-row-button:hover{background:var(--w-soft)}.w-row-head{display:flex;align-items:flex-start;gap:10px;justify-content:space-between;min-width:0}.w-row-head>strong{font-size:14px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.w-row-meta,.w-row-description{color:var(--w-muted);font-size:12px;line-height:1.6;overflow-wrap:anywhere}.w-row-description{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.w-selected{background:var(--w-selected);border-inline-start-color:var(--w-accent)}.w-back{display:none!important}.w-detail-title{margin-bottom:12px!important}.w-detail-meta{color:var(--w-muted);font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.w-detail-footer{padding:24px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:auto;border-top:1px solid var(--w-border)}.w-detail-footer .w-muted{flex:1;min-width:160px}.w-definition{display:grid;grid-template-columns:minmax(80px,120px) minmax(0,1fr);gap:8px 16px;font-size:14px;margin:20px 0}.w-definition dt{color:var(--w-muted)}.w-definition dd{margin:0;min-width:0;overflow-wrap:anywhere}
.w-switch-label{display:inline-flex;align-items:center;gap:8px;font-size:13px;position:relative;cursor:pointer}.w-switch-label>input{position:absolute;opacity:0;inset-inline-end:0;width:36px!important;height:22px!important;margin:0;cursor:pointer}.w-switch-track{width:36px;height:22px;border-radius:12px;display:block;background:var(--w-border);border:1px solid var(--w-border);pointer-events:none;padding:2px;transition:background .15s}.w-switch-track:before{content:'';display:block;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #0002;transition:transform .15s}.w-switch-label>input:checked+.w-switch-track{background:var(--w-accent);border-color:var(--w-accent)}.w-switch-label>input:checked+.w-switch-track:before{transform:translateX(14px)}.w-switch-label>input:focus-visible+.w-switch-track{outline:2px solid var(--w-accent);outline-offset:3px}.w-switch-label:has(>input:disabled){opacity:.5;cursor:not-allowed}
.w-overlay{position:fixed;inset:0;background:#0005;display:flex;justify-content:flex-end;z-index:1000;padding:12px;overflow:auto}.w-dialog{width:min(620px,100%);max-height:100%;display:flex;flex-direction:column;min-height:0;background:var(--w-bg);color:var(--w-text);border:1px solid var(--w-border);border-radius:12px;box-shadow:0 18px 70px #0003}.w-dialog-header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 24px;border-bottom:1px solid var(--w-border);flex-shrink:0}.w-dialog-header>h2{font-size:20px}.w-dialog-body{overflow:auto;padding:20px 24px;min-height:0}.w-editor-grid{display:grid;grid-template-columns:210px minmax(0,1fr) 300px;min-height:500px;flex:1}.w-editor-list{padding:20px 12px;border-inline-end:1px solid var(--w-border);min-width:0}.w-editor-canvas{background:var(--w-soft);padding:20px;min-width:0;display:flex;flex-direction:column;gap:14px}.w-editor-inspector{padding:24px;border-inline-start:1px solid var(--w-border);min-width:0;overflow:auto}.w-editor-inspector h3{margin-bottom:18px}.w-preview-empty{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:12px;aspect-ratio:16/9;min-height:180px;background:var(--w-soft);border:1px solid var(--w-border);border-radius:8px;padding:24px;color:var(--w-muted)}.w-content-pad{padding:24px 0}.w-stack{display:flex;flex-direction:column;gap:16px;min-width:0}.w-scroll-x{overflow:auto;max-width:100%}
@container dsh-workbench (max-width:1000px){.w-editor-grid{grid-template-columns:160px minmax(0,1fr)}.w-editor-inspector{grid-column:1/-1;border-inline-start:0;border-top:1px solid var(--w-border)}.w-header-actions{max-width:60%}.w-split{grid-template-columns:minmax(240px,32%) minmax(0,1fr)}}
@container dsh-workbench (max-width:760px){.w-page-header{gap:14px;flex-wrap:wrap;padding-bottom:18px}.w-heading{flex:1;min-width:170px}.dshw h1{font-size:24px}.w-header-actions{max-width:100%;justify-content:flex-start}.w-subtitle{font-size:13px}.w-tabs{gap:12px}.dshw .w-tabs>button{padding:10px 4px 12px}.w-split{display:block;min-height:360px}.w-split[data-selected=false]>.w-detail{display:none}.w-split[data-selected=true]>.w-master{display:none}.w-master{border-inline-end:0}.w-detail{padding:20px 0}.w-back{display:inline-flex!important;align-self:flex-start;margin:0 0 16px!important}.w-detail h2{font-size:22px}.w-master-toolbar{padding:16px 0}.dshw .w-row-button{padding:16px 10px}.w-detail-footer{position:static}.w-detail-footer .w-muted{flex-basis:100%}.w-editor-grid{display:flex;flex-direction:column}.w-editor-list{border-inline-end:0;border-bottom:1px solid var(--w-border);padding:16px 0}.w-editor-canvas{padding:16px 0;background:var(--w-bg)}.w-editor-inspector{padding:20px 0}.w-dialog-header,.w-dialog-body{padding:16px}.w-button{min-height:40px}.w-definition{grid-template-columns:80px minmax(0,1fr)}}
@media(max-width:700px){.w-page[data-main=true]{padding:calc(16px + var(--dsh-frame-top-clearance,0px)) 16px 0 max(16px,var(--dsh-frame-leading-clearance,0px))}.w-overlay{padding:8px}.w-dialog{width:100%}}
@media(prefers-reduced-motion:reduce){.dshw *,.dshw *:before{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;
  function Styles() { return h('style', null, styles); }
  return { Icon, Button, IconButton, Page, Tabs, Status, Empty, Split, Row, Search, Switch, Dialog, Styles, register, styles };
}

/* One update control per plugin. Only transport, idle guards and installation
 * coordination are shared; no global update page or update-all action exists. */
function __stardustUpdatesGuards() {
  const key = Symbol.for('stardustlc.plugin-updates.guards.v1');
  return globalThis[key] ||= { values: new Map(), listeners: new Set(), viewListeners: new Set(), clients: new Set() };
}
function __stardustUpdatesGuard(React, name, { dirty = false, busy = false, retainOnClose = false } = {}) {
  const token = React.useRef(null);
  if (!token.current) token.current = {};
  React.useLayoutEffect(() => {
    const pool = __stardustUpdatesGuards();
    if (!dirty && !busy) for (const [key, value] of pool.values) if (value.name === name && value.orphan) pool.values.delete(key);
    pool.values.set(token.current, { name, dirty: !!dirty, busy: !!busy, retainOnClose, orphan: false });
    for (const listener of pool.listeners) listener();
  }, [name, !!dirty, !!busy, retainOnClose]);
  React.useEffect(() => () => {
    const pool = __stardustUpdatesGuards(), value = pool.values.get(token.current);
    if (value?.retainOnClose && (value.dirty || value.busy)) value.orphan = true;
    else pool.values.delete(token.current);
    for (const listener of pool.listeners) listener();
  }, []);
}
function __StardustPluginUpdatesFooter({ React, name }) {
  const [, render] = React.useState(0), pool = __stardustUpdatesGuards();
  React.useEffect(() => { const fn = () => render(value => value + 1); pool.viewListeners.add(fn); return () => pool.viewListeners.delete(fn); }, []);
  const client = [...pool.clients].find(client => typeof client.Footer === 'function' && client.has(name));
  if (!client) return null;
  return React.createElement(client.Footer, { name });
}
function __stardustUpdatesInlinePage(React, element, name) {
  return React.cloneElement(element, null, element.props.children, React.createElement(__StardustPluginUpdatesFooter, { key: 'plugin-updates', React, name }));
}
function __stardustUpdatesDetailName(subject, rows) {
  if (!subject || !['bundle', 'row'].includes(subject.kind)) return null;
  if (subject.kind === 'row' && subject.pkg?.name === '@stardustlc/dsh-suite') {
    const component = rows.find(row => row.bundledBy === subject.pkg.name && (subject.row?.moduleName === row.name || subject.row?.moduleName?.startsWith(row.name + '/')));
    if (component) return component.name;
  }
  return rows.some(row => row.name === subject.pkg?.name) ? subject.pkg.name : null;
}
function __stardustUpdatesNativeFormState(document) {
  let dirty = false, busy = false;
  for (const scope of document.querySelectorAll('[data-plugin-detail],[data-plugin-row-detail]')) for (const button of scope.querySelectorAll('button')) {
    if (!button.getClientRects().length || button.closest('.plugin-updates-footer')) continue;
    const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
    if (/^(?:正在保存|保存中|Saving)(?:[.…\s]|$)/i.test(label) || button.getAttribute('aria-busy') === 'true') busy = true;
    if (!button.disabled && button.getAttribute('aria-disabled') !== 'true' && /^(?:保存(?:更改|设置|配置)?|Save(?: changes| settings| configuration)?)(?:\s+(?:Ctrl|⌘|Enter|↵).*)?$/i.test(label)) dirty = true;
  }
  return { dirty, busy };
}
function __stardustUpdatesDisplayRows(next, known) {
  for (const row of next.rows) known.set(row.name, row);
  if (!['verifying', 'installing', 'cancelling', 'unknown', 'restore-failed'].includes(next.job?.state)) return next;
  const rows = [...next.rows];
  for (const row of known.values()) if ((row.name === next.job.name || row.bundledBy === next.job.name) && !rows.some(item => item.name === row.name)) rows.push({ ...row, updating: true });
  return { ...next, rows };
}
function __stardustUpdatesSuiteRows(next, participants) {
  // The official manager lists top-level dependencies, not Suite's transitive
  // components. Project active, build-identified clients for display only.
  // Installation and preferences still use the real Suite row from the host.
  const suite = next.rows.find(row => row.name === '@stardustlc/dsh-suite' && row.enabled);
  if (!suite) return next;
  const rows = [...next.rows], names = new Set(rows.map(row => row.name));
  for (const item of participants) if (item.suiteComponent && item.packageVersion && item.label && !names.has(item.name)) {
    names.add(item.name);
    rows.push({ name: item.name, version: item.packageVersion, enabled: true, sourceKind: 'suite', loadError: false, label: item.label, labelEn: item.labelEn, bundledBy: suite.name });
  }
  return { ...next, rows };
}
function __stardustUpdatesWrap(definition, participant) {
  return { ...definition, factory(require) {
    const original = definition.factory(require);
    if (!original || typeof original !== 'object') return original;
    const React = require('react');
    return { ...original, apply(ctx, ...args) {
      const result = original.apply?.call(this, ctx, ...args);
      // The optional alpha.3 slot stays dormant in older hosts; its scoped
      // injection unregisters naturally when the plugin is unloaded.
      if (participant.iconData && participant.sectionIds?.length && typeof ctx.inject === 'function') ctx.inject(['slots'], host => {
        for (const id of new Set(participant.sectionIds)) host.slots.inject('settings.section.icon', () => host.slots.register({ name: 'settings.section.icon', id }, function PluginSettingsIcon({ size = 20 }) {
          return React.createElement('img', { src: participant.iconData, alt: '', 'aria-hidden': true, width: size, height: size, style: { objectFit: 'contain', display: 'block', flexShrink: 0 } });
        }));
      });
      if (typeof ctx.inject === 'function') ctx.inject(['slots', 'locale', 'remote', 'remote.pluginManager'], host => __stardustUpdatesJoin(host, React, require, participant));
      return result;
    } };
  } };
}
function __stardustUpdatesJoin(host, React, require, participant) {
  const key = Symbol.for('stardustlc.plugin-updates.client.v1'), pools = globalThis[key] ||= new WeakMap(), root = host.root || host;
  if (typeof root.plugin !== 'function') return;
  let record = pools.get(root);
  if (!record) {
    record = { refs: new Map(), timer: null, version: participant.version, alive: true, hold: false, uiRevision: 2 };
    pools.set(root, record);
    __stardustUpdatesActivate(record, pools, root, React, require);
  } else if (record.uiRevision !== 2 && !record.migration) {
    // The first loaded participant may still own a pre-footer client. Keep
    // its references and draft guards, wait for any admitted install, then
    // replace that one client fiber instead of running two window heartbeats.
    const shared = record;
    record.migration = Promise.resolve().then(async () => {
      while (shared.alive && shared.hold) await new Promise(resolve => setTimeout(resolve, 500));
      if (!shared.alive || !shared.refs.size) return;
      await shared.fiber?.dispose?.();
      if (!shared.refs.size) return;
      shared.alive = true; shared.uiRevision = 2; pools.set(root, shared);
      __stardustUpdatesActivate(shared, pools, root, React, require);
    }).catch(() => { /* The original page remains usable if host disposal fails. */ });
  }
  clearTimeout(record.timer);
  const ref = {}; record.refs.set(ref, participant);
  host.effect(() => () => {
    record.refs.delete(ref);
    const stop = () => {
      if (record.refs.size || !record.alive) return;
      if (record.hold) { record.timer = setTimeout(stop, 1000); return; }
      record.alive = false; Promise.resolve(record.fiber?.dispose?.()).catch(() => {});
    };
    if (!record.refs.size) record.timer = setTimeout(stop, 1000);
  });
}
function __stardustUpdatesActivate(shared, pools, root, React, require) {
  shared.fiber = root.plugin({ name: 'stardustlc-plugin-updates-client', inject: ['slots', 'locale', 'remote', 'remote.pluginManager'], apply(ctx) {
    const client = __stardustUpdatesClient(ctx, React, require, shared);
    ctx.effect(() => () => { shared.alive = false; client.dispose(); if (pools.get(root) === shared) pools.delete(root); });
  } });
  Promise.resolve(shared.fiber).catch(() => { shared.alive = false; if (pools.get(root) === shared) pools.delete(root); });
}
function __stardustUpdatesClient(ctx, React, require, shared) {
  const h = React.createElement, W = createWorkbenchUI(React), route = new URL('api/stardustlc/plugin-updates', document.baseURI);
  const { useState, useEffect } = React, id = crypto.randomUUID(), listeners = new Set(), pool = __stardustUpdatesGuards(), requests = new Set(), notified = new Set(), knownRows = new Map();
  let alive = true, registered = false, state = null, lastInteraction = Date.now(), inPoll = false, manualOperation = false, legacyHint = null;
  const language = () => String(ctx.locale?.getSnapshot?.().active || '').startsWith('en') ? 'en' : 'zh';
  const t = (zh, en) => language() === 'en' ? en : zh;
  const preferences = name => state?.preferences.packages[name] || { checkEnabled: true, autoInstall: false, deferredUntil: 0, ignoredVersion: null };
  const originalRow = name => state?.rows.find(row => row.name === name);
  const rowFor = name => { const row = originalRow(name); return row?.bundledBy ? originalRow(row.bundledBy) : row; };
  const activeJob = () => ['verifying', 'installing', 'cancelling'].includes(state?.job?.state);
  function notify() { shared.hold = manualOperation || activeJob(); for (const listener of listeners) listener(); for (const listener of pool.viewListeners) listener(); }
  async function api(body = { action: 'state' }) {
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), body.action === 'check' ? 95000 : 45000);
    try {
      const response = await fetch(route, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-stardustlc-updates': '1' }, body: JSON.stringify(body) });
      let data; try { data = await response.json(); } catch { throw new Error('service-unavailable'); }
      if (!response.ok || !data.ok) throw new Error(response.status === 403 ? 'owner-required' : data.code || 'service-unavailable');
      return data.value;
    } catch (error) { if (error?.name === 'AbortError') throw new Error('service-unavailable'); throw error; }
    finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function pageState(manual = manualOperation) {
    const values = [...pool.values.values()], nativeForm = __stardustUpdatesNativeFormState(document);
    const dialog = [...document.querySelectorAll('[role="dialog"],dialog[open]')].some(node => node.getClientRects().length && !(manual && (node.closest('.plugin-updates-footer') || node.querySelector('.plugin-updates-footer'))));
    return { action: 'heartbeat', id, dirty: nativeForm.dirty || values.some(value => value.dirty), busy: nativeForm.busy || values.some(value => value.busy) || dialog, idleForMs: Math.min(86400000, Math.max(0, Date.now() - lastInteraction)) };
  }
  const heartbeat = () => api(pageState());
  function interaction() { lastInteraction = Date.now(); if (registered && alive) void heartbeat().catch(() => {}); }
  const guardChanged = () => { if (registered && alive) void heartbeat().catch(() => {}); };
  for (const event of ['pointerdown', 'keydown', 'input']) document.addEventListener(event, interaction, { capture: true, passive: true });
  pool.listeners.add(guardChanged);
  const close = () => { void fetch(route, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'content-type': 'application/json', 'x-stardustlc-updates': '1' }, body: JSON.stringify({ action: 'client-close', id }) }).catch(() => {}); };
  window.addEventListener('pagehide', close);
  async function refresh() { const next = await api(); if (alive) { state = __stardustUpdatesDisplayRows(__stardustUpdatesSuiteRows(next, shared.refs.values()), knownRows); notify(); } return next; }
  function useSnapshot() {
    const [, render] = useState(0);
    useEffect(() => { const fn = () => render(value => value + 1); listeners.add(fn); const stop = ctx.locale?.subscribe?.(fn); return () => { listeners.delete(fn); stop?.(); }; }, []);
    return state;
  }
  function message(code) {
    return ({
      'page-dirty': t('有未保存的修改。请先保存或放弃修改，再更新。', 'Save or discard unsaved changes before updating.'),
      'page-busy': t('有页面操作或对话框尚未结束，请完成后再试。', 'Finish the active page operation or close its dialog, then retry.'),
      'page-not-ready': t('还有窗口状态未确认，或旧版插件尚未提供状态保护。请刷新相关窗口，必要时先手动更新旧版插件。', 'A window state is unknown or an older plugin lacks state protection. Refresh the affected windows and manually update legacy plugins if needed.'),
      busy: t('DSH 正在执行任务或安装，请等操作结束。', 'DSH is running a task or installation. Wait for it to finish.'),
      'activity-unknown': t('无法确认任务是否空闲，已暂停安装。', 'Installation paused because task activity is unknown.'),
      'restart-required': t('更新服务需要重启后继续。请在方便时手动重启 DSH。', 'The updater needs a restart. Restart DSH manually when convenient.'),
      'operation-unconfirmed': t('上次安装未确认或恢复失败。请在官方插件管理中检查并修复，之后手动重启 DSH。', 'The last installation is unconfirmed or recovery failed. Check and repair it in native plugin management, then restart DSH manually.'),
      'check-first': t('检查结果已过期，请重新检查。', 'This check expired. Check again.'),
      'release-changed': t('发布信息已变化，本次未安装。请重新检查。', 'Release metadata changed. Nothing was installed; check again.'),
      'preferences-conflict': t('另一个窗口修改了偏好，已刷新，请重试。', 'Preferences changed in another window. They have been refreshed; retry.'),
      'preferences-unreadable': t('更新偏好文件无法读取，自动安装已关闭。请检查当前 profile 的 stardustlc-plugin-updates.json。', 'Preferences could not be read. Automatic installation is off. Check stardustlc-plugin-updates.json in this profile.'),
      'no-update': t('版本已变化或暂不兼容，请重新检查。', 'The version changed or is incompatible. Check again.'),
      'source-not-registry': t('本地源码、Git 等安装，请通过原安装方式更新。', 'Update local, Git and other external sources through their original installation method.'),
      'managed-by-suite': t('这个插件随 Suite 安装，通过 Suite 更新。', 'This plugin was installed through Suite and is updated through Suite.'),
      'owner-required': t('只有 profile 拥有者能管理更新。', 'Only the profile owner can manage updates.'),
    })[code] || t('操作未完成，请刷新后重试。DSH 不会因此自动重启。', 'The operation could not be completed. Refresh and retry. DSH will not restart automatically.');
  }
  // releaseOf() keeps the failing engine/peer range check as a stable code; say which
  // environment has to change instead of only reporting that the release is incompatible.
  function requirement(release) {
    return ({
      'dsh-version': t('需要换成与该版本匹配的 DSH 本体', 'it needs a different DSH version'),
      'node-version': t('需要换成与该版本匹配的 Node.js', 'it needs a different Node.js version'),
      deprecated: t('作者已把这个版本标记为弃用', 'the author marked this release as deprecated'),
      'not-bundle': t('这个版本不是可加载的 DSH 插件包', 'this release is not a loadable DSH plugin bundle'),
    })[release?.reason] || t('发布元数据的兼容范围与当前环境不符', 'its published compatibility range does not match this environment');
  }
  function jobLabel(job) {
    return ({ verifying: t('正在核对版本', 'Verifying release'), installing: t('正在安装', 'Installing'), cancelling: t('正在请求取消', 'Requesting cancellation'), complete: t('已更新', 'Updated'), 'restart-required': t('已安装，等待你手动重启', 'Installed; manual restart needed'), restored: t('更新未成功，已恢复原版本', 'Update failed; previous version restored'), 'restore-failed': t('恢复未成功，请检查官方插件管理', 'Recovery failed; check native plugin management'), unknown: t('结果未确认，请检查官方插件管理', 'Result unconfirmed; check native plugin management'), cancelled: t('已取消', 'Cancelled'), failed: t('更新未成功', 'Update failed') })[job.state] || job.state;
  }
  function FooterFrame({ name, label, subtitle, actions, children }) {
    return h('section', { className: 'dshw plugin-updates-footer', 'data-plugin-update-footer': name, 'aria-label': label + t(' · 版本与更新', ' · Version and updates') },
      h('style', null, W.styles),
      h('style', null, '.plugin-updates-footer{box-sizing:border-box;flex-shrink:0;margin-top:28px;padding-top:18px;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);min-width:0;max-width:100%;color:var(--dsw-alias-label-primary,#202124)}.plugin-updates-footer .updates-head{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px}.plugin-updates-footer h2{font-size:14px;line-height:22px;margin:0;font-weight:600}.plugin-updates-footer .updates-subtitle,.plugin-updates-footer .updates-version{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;margin:4px 0}.plugin-updates-footer .updates-options{margin-top:12px}.plugin-updates-footer .updates-options>summary{cursor:pointer;font-size:12px;line-height:22px;color:var(--dsw-alias-label-secondary,#657080)}.plugin-updates-footer .updates-options>summary:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#6b79df);outline-offset:4px}.plugin-updates-footer .updates-settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px;padding:14px 0 0}.plugin-updates-footer .updates-note{margin:5px 0 0;font-size:12px;line-height:1.6}.plugin-updates-footer>.w-section{margin:10px 0 0;padding:0;border:0}.plugin-updates-footer .w-toolbar{margin-top:10px!important}.plugin-updates-footer .w-switch-label{max-width:100%;gap:12px;align-items:flex-start}.plugin-updates-footer .w-switch-track{flex-shrink:0}.plugin-updates-footer .updates-notes{margin-top:12px;padding:12px;border:1px solid var(--dsw-alias-border-l3,#e5e7eb);border-radius:10px}.plugin-updates-footer .updates-notes pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font:12px/1.7 ui-monospace,monospace}.plugin-updates-footer .w-overlay{z-index:1002}@media(max-width:600px){.plugin-updates-footer .updates-head{gap:8px}.plugin-updates-footer .w-toolbar{gap:6px;flex-wrap:wrap}.plugin-updates-footer .w-button{max-width:100%}}'),
      h('div', { className: 'updates-head' }, h('div', null, h('h2', null, t('版本与更新', 'Version and updates')), h('p', { className: 'updates-subtitle w-muted' }, subtitle)), actions), children);
  }
  function Panel({ name }) {
    const snapshot = useSnapshot(), [error, setError] = useState(''), [working, setWorking] = useState(false), [checking, setChecking] = useState(false), [dialog, setDialog] = useState(null), [notes, setNotes] = useState(null), [notesOpen, setNotesOpen] = useState(false), [loadingNotes, setLoadingNotes] = useState(false);
    const row = rowFor(name), original = originalRow(name), target = row?.name || name, prefs = preferences(target), job = snapshot?.job?.name === target ? snapshot.job : null;
    async function perform(callback) { setError(''); setWorking(true); try { await callback(); await refresh(); } catch (error) { setError(error.message); await refresh().catch(() => {}); } finally { setWorking(false); } }
    async function save(changes, consent) { await api({ action: 'preferences', name: target, revision: state.preferences.revision, changes, consent }); }
    async function check() { setError(''); setChecking(true); try { await api({ action: 'check', name: target }); await refresh(); } catch (error) { setError(error.message); } finally { setChecking(false); } }
    async function install() {
      setDialog(null); manualOperation = true; notify();
      await perform(async () => {
        try {
          await heartbeat();
          const started = await api({ action: 'install', name: row.name, version: row.release.version, confirmation: 'update-installed-plugin' });
          while (alive) {
            await new Promise(resolve => setTimeout(resolve, 800)); await heartbeat(); await refresh();
            if (state.job?.id !== started.id) throw new Error('operation-unconfirmed');
            if (!activeJob()) break;
          }
        } finally { manualOperation = false; notify(); }
      });
    }
    async function showNotes() {
      if (notesOpen) { setNotesOpen(false); return; }
      setNotesOpen(true); setNotes(null); setLoadingNotes(true); setError('');
      try { setNotes(await api({ action: 'notes', name: target, version: row.release.version })); } catch (error) { setError(error.message); } finally { setLoadingNotes(false); }
    }
    if (!snapshot || !row) return h(W.Status, null, t('此插件尚未安装或已从当前 profile 移除。', 'This plugin is not installed in the current profile.'));
    const title = language() === 'en' ? original.labelEn : original.label;
    const ownPage = pageState(true), unconfirmed = ['unknown', 'restore-failed'].includes(snapshot.job?.state), pageBusy = ownPage.busy || (snapshot.pages.clients || []).some(client => client.id !== id && client.busy), installLocked = working || activeJob() || unconfirmed || snapshot.updaterRestart || snapshot.preferenceError || !snapshot.activity.known || snapshot.activity.busy || snapshot.pages.dirty || ownPage.dirty || pageBusy || !snapshot.pages.known;
    const checkingThis = checking || snapshot.checkingNames?.includes(target);
    const status = row.sourceKind !== 'registry' ? t('本地 / 外部来源，保留原安装方式', 'Local / external source; keep original install method') : row.loadError ? t('加载异常，请先检查官方插件管理', 'Loading error; check native plugin management') : row.error ? t('检查失败，可以重试', 'Check failed; retry available') : row.release && !row.release.compatible ? t('新版本暂不兼容当前环境：', 'Latest release is incompatible with this environment: ') + requirement(row.release) : row.available ? (prefs.ignoredVersion === row.release.version ? t('已忽略提醒，仍可手动更新', 'Reminder ignored; manual update available') : t('有新版本', 'Update available')) : row.checkedAt ? t('当前已是最新稳定版', 'Latest stable version') : t('尚未检查', 'Not checked yet');
    return h(FooterFrame, { name, label: title, subtitle: original.name + ' · ' + original.version, actions: h(W.Button, { icon: 'refresh', disabled: checkingThis || row.sourceKind !== 'registry', onClick: check }, checkingThis ? t('正在检查…', 'Checking…') : target === '@stardustlc/dsh-suite' ? t('检查整包更新', 'Check Suite updates') : t('检查更新', 'Check for updates')) },
      original.bundledBy && h(W.Status, null, t('此插件随 Suite 安装。以下设置与安装作用于 Suite 整包，以保持组件版本一致。单独安装的插件可以独立更新。', 'This plugin was installed through Suite. These controls update Suite as a package so its components stay consistent. Independently installed plugins update individually.')),
      h('section', { className: 'w-section' }, (original.bundledBy || row.available) && h('p', { className: 'updates-version' }, target + ' · ' + row.version, row.release?.version && row.release.version !== row.version ? ' → ' + row.release.version : ''), h('p', { className: 'w-muted updates-note' }, status), !row.enabled && h('p', { className: 'w-muted' }, t('当前已停用，更新后仍保持停用。', 'Currently disabled; it will remain disabled after updating.')), row.checkedAt && h('p', { className: 'w-muted updates-note' }, t('上次检查：', 'Last checked: ') + new Date(row.checkedAt).toLocaleString(language() === 'en' ? 'en-US' : 'zh-CN')),
        h('div', { className: 'w-toolbar' }, row.available && row.sourceKind === 'registry' && h(W.Button, { variant: 'primary', icon: 'download', disabled: installLocked || row.loadError, onClick: () => setDialog('install') }, target === '@stardustlc/dsh-suite' ? t('更新 Suite 整包', 'Update whole Suite') : t('更新此插件', 'Update this plugin')), row.release && h(W.Button, { variant: 'ghost', onClick: showNotes, 'aria-expanded': notesOpen }, t('更新记录', 'Release notes')), row.available && h(W.Button, { variant: 'ghost', disabled: working, onClick: () => perform(() => api({ action: 'later', name: target, revision: state.preferences.revision })) }, t('明天再提醒', 'Remind me tomorrow')), row.available && prefs.ignoredVersion !== row.release.version && h(W.Button, { variant: 'ghost', disabled: working, onClick: () => perform(() => api({ action: 'ignore', name: target, revision: state.preferences.revision, version: row.release.version })) }, t('忽略此版本提醒', 'Ignore this reminder')))),
      notesOpen && h('section', { className: 'updates-notes', 'aria-label': t('更新记录', 'Release notes') }, h('strong', null, target + ' · ' + (notes?.version || row.release?.version || '')), loadingNotes ? h('p', null, t('正在读取…', 'Loading…')) : notes?.text ? h('pre', null, notes.text) : h('p', null, t('未找到此版本的独立更新记录。', 'No separate notes were found for this version.')), notes?.url && h('a', { href: notes.url, target: '_blank', rel: 'noreferrer noopener' }, t('查看仓库更新记录', 'View repository changelog'))),
      h('details', { className: 'updates-options' }, h('summary', null, t('更新选项', 'Update options'), ' · ', prefs.checkEnabled ? t('自动检查：开', 'Checks: on') : t('自动检查：关', 'Checks: off'), ' · ', prefs.autoInstall ? t('自动安装：开', 'Install: on') : t('自动安装：关', 'Install: off')), h('section', { className: 'updates-settings', 'aria-label': t('这个插件的更新偏好', 'Update preferences for this plugin') },
        h('div', null, h(W.Switch, { label: t('自动检查这个插件的更新', 'Automatically check this plugin'), checked: prefs.checkEnabled, disabled: working || !!snapshot.preferenceError || row.sourceKind !== 'registry', onChange: event => perform(() => save({ checkEnabled: event.target.checked })) }), h('p', { className: 'w-muted updates-note' }, t('默认开启，每天最多一次。只影响这个插件，关闭后仍可手动检查。', 'On by default, at most once daily. This affects only this plugin; manual checks remain available.'))),
        h('div', null, h(W.Switch, { label: t('空闲时自动安装这个插件的补丁', 'Install patches for this plugin while idle'), checked: prefs.autoInstall, disabled: working || !!snapshot.preferenceError || row.sourceKind !== 'registry', onChange: event => event.target.checked ? setDialog('automatic') : perform(() => save({ autoInstall: false })) }), h('p', { className: 'w-muted updates-note' }, t('默认关闭。明确开启后，仅空闲且没有未保存修改时安装兼容补丁。其他插件的开关不变。', 'Off by default. Explicitly enable compatible patches while idle with no unsaved changes. Other plugins’ settings stay unchanged.'))))),
      error && h(W.Status, { tone: 'error' }, message(error)), snapshot.preferenceError && h(W.Status, { tone: 'error' }, message('preferences-unreadable')),
      snapshot.pendingRestart && h(W.Status, null, snapshot.updaterRestart ? message('restart-required') : t('已有更新等待手动重启后生效。你可以继续工作，自动安装已暂停。', 'Some updates need a manual restart. Continue your work; automatic installation is paused.')),
      prefs.autoInstall && snapshot.autoReady === false && h(W.Status, null, message('page-not-ready')),
      snapshot.pages.clients.some(client => !client.fresh) && h(W.Status, null, h('p', null, t('有窗口已断开，无法确认是否还有未保存修改。仍在使用的窗口请先保存并刷新；已关闭的窗口可以手动重新确认。', 'A disconnected window may contain unsaved changes. Save and refresh windows still in use. If they are closed, you can confirm that manually.')), h(W.Button, { onClick: () => setDialog('windows') }, t('重新确认已关闭的窗口', 'Confirm closed windows'))),
      (snapshot.pages.dirty || ownPage.dirty) && h(W.Status, null, message('page-dirty')), (snapshot.activity.busy || pageBusy) && h(W.Status, null, message(snapshot.activity.busy ? 'busy' : 'page-busy')),
      prefs.deferredUntil > Date.now() && h(W.Status, null, t('此插件已推迟提醒和自动安装 24 小时，仍可手动更新。', 'Reminders and automatic installation for this plugin are deferred for 24 hours. Manual updates remain available.')),
      unconfirmed && h(W.Status, { tone: 'error' }, message('operation-unconfirmed')),
      job && h('section', { className: 'w-section', 'aria-label': t('这个插件的更新进度', 'Update progress for this plugin') }, h('h3', null, jobLabel(job)), h('p', { className: 'w-muted' }, job.from + ' → ' + job.to + (job.mode === 'automatic' ? t(' · 自动补丁更新', ' · Automatic patch') : '')), (job.reason || job.outcome?.result?.error?.code) && h(W.Status, { tone: 'error' }, message(job.reason || job.outcome.result.error.code)), activeJob() && h(W.Button, { disabled: job.state === 'cancelling', onClick: () => perform(() => api({ action: 'cancel', id: job.id })) }, t('取消更新', 'Cancel update')), h('p', { className: 'w-muted updates-note' }, t('安装开始后，取消由官方包管理器处理；已落盘的写入以实际结果或恢复状态为准。', 'After installation starts, the native package manager handles cancellation. Completed writes and recovery are reported as they occur.'))),
      dialog && h(W.Dialog, { title: dialog === 'windows' ? t('断开的窗口都已关闭？', 'Are the disconnected windows closed?') : dialog === 'automatic' ? t('允许这个插件自动安装补丁？', 'Allow automatic patches for this plugin?') : t('确认更新此插件', 'Confirm this plugin update'), closeLabel: t('关闭', 'Close'), onClose: () => setDialog(null) },
        target === '@stardustlc/dsh-suite' && h('p', null, t('此处操作的是 Suite 整包，包含 18 个组件。独立安装的其他插件不受影响。', 'This action applies to the whole Suite, including its 18 components. Other independently installed plugins are unaffected.')),
        dialog === 'windows' ? h('div', { className: 'w-stack' }, h('p', null, t('只清除超过 45 秒未回应的其他窗口记录。请先确认它们已经关闭；仍在使用的窗口请保存修改并刷新。当前或仍在回应的窗口保护会保留。', 'Only other windows silent for over 45 seconds are cleared. Confirm that they are closed; save and refresh windows still in use. Current and responsive windows remain protected.')), h('div', { className: 'w-toolbar' }, h(W.Button, { onClick: () => setDialog(null) }, t('取消', 'Cancel')), h(W.Button, { onClick: () => { setDialog(null); void perform(() => api({ ...pageState(true), action: 'reconfirm-windows', confirmation: 'other-stale-windows-are-closed' })); } }, t('已关闭，重新确认状态', 'They are closed; reconfirm')))) :
        dialog === 'automatic' ? h('div', { className: 'w-stack' }, h('p', null, (language() === 'en' ? row.labelEn : row.label) + ' · ' + target), h('p', null, t('你正在主动启用这个插件的自动安装。只处理兼容的稳定补丁；有任务、未保存修改、未知窗口或等待重启时暂停。', 'You are explicitly enabling automatic installation for this plugin. Only compatible stable patches qualify; running tasks, unsaved changes, unknown windows or a pending restart pause it.')), h('p', null, t('不会自动重启 DSH，其他插件不会跟着开启。可随时关闭。', 'DSH will not restart automatically, and other plugins will not be enabled for automatic updates. Turn it off anytime.')), h('div', { className: 'w-toolbar' }, h(W.Button, { onClick: () => setDialog(null) }, t('保持关闭', 'Keep off')), h(W.Button, { variant: 'primary', onClick: () => { setDialog(null); void perform(() => save({ checkEnabled: true, autoInstall: true }, 'enable-idle-patch-updates')); } }, t('允许此插件自动安装补丁', 'Allow patches for this plugin')))) :
        h('div', { className: 'w-stack' }, h('p', { className: 'updates-version' }, target + ': ' + row.version + ' → ' + row.release.version), h('p', null, t('通过 DSH 官方插件管理器安装。需要重启时，由你手动决定时间；停用状态会保留。', 'Install through DSH’s native plugin manager. Choose when to restart if needed; disabled status is preserved.')), h('p', { className: 'w-muted' }, t('来源：npm 官方 registry，网络不可达时回退 npmmirror。安装前再次核对版本与完整性。', 'Source: official npm registry, with npmmirror fallback if unreachable. Version and integrity are checked again before installation.')), (ownPage.dirty || snapshot.pages.dirty) && h(W.Status, null, message('page-dirty')), h('div', { className: 'w-toolbar' }, h(W.Button, { onClick: () => setDialog(null) }, t('取消', 'Cancel')), h(W.Button, { variant: 'primary', disabled: installLocked || row.loadError, onClick: install }, t('确认安装此版本', 'Install this version')))))
    );
  }
  function NativeFooter({ subject }) {
    const snapshot = useSnapshot(), name = __stardustUpdatesDetailName(subject, snapshot?.rows || []);
    return name ? h(Panel, { name }) : null;
  }
  function Reminder() {
    useSnapshot();
    const row = state?.rows.find(row => { const prefs = preferences(row.name); return row.available && !row.updating && !row.bundledBy && prefs.checkEnabled && prefs.deferredUntil <= Date.now() && prefs.ignoredVersion !== row.release.version && !notified.has(row.name + '@' + row.release.version); });
    if (!row && !legacyHint) return null;
    let Toast; try { Toast = require('@deepseek-ai/dsh-client-ui-primitives').Toast; } catch { return null; }
    if (!Toast) return null;
    const hint = legacyHint, key = hint ? 'legacy-' + hint : row.name + '@' + row.release.version;
    return h(Toast, { key, text: hint ? hint + t('：请打开「插件」中的此插件详情页，在底部管理更新。', ': open its details in Plugins to manage updates at the bottom.') : (language() === 'en' ? row.labelEn : row.label) + t('有新版本，可在页面底部查看。', ' has an update. Review it at the bottom of its page.'), icon: h(W.Icon, { name: 'refresh', size: 18 }), holdMs: 7000, onDone: () => { if (hint) legacyHint = null; else notified.add(key); notify(); } });
  }
  function register() {
    if (!alive) return;
    if (!registered) {
      registered = true; pool.clients.add(client);
      ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({ name: 'plugins.detail.section', id: 'stardustlc.plugin-update-footer', order: 1000 }, NativeFooter));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'stardustlc.plugin-update-reminder' }, Reminder));
      notify();
    }
  }
  async function poll() {
    if (inPoll || !alive || !shared.refs.size) return;
    inPoll = true;
    try { await refresh(); register(); await heartbeat(); }
    catch { /* Owner-only controls stay absent for guests and unsupported hosts. */ }
    finally { inPoll = false; }
  }
  const timer = setInterval(() => { void poll(); }, 15000), first = setTimeout(() => { void poll(); }, 100);
  const client = { t, Footer: Panel, Button: W.Button, open(name) { const footer = [...document.querySelectorAll('[data-plugin-update-footer]')].find(node => node.getAttribute('data-plugin-update-footer') === name); if (footer) footer.scrollIntoView({ block: 'end', behavior: 'smooth' }); else { legacyHint = name; notify(); } }, has: name => registered && !!originalRow(name), row: rowFor, dispose() {
    close(); alive = false; clearTimeout(first); clearInterval(timer); pool.clients.delete(client);
    pool.listeners.delete(guardChanged); listeners.clear();
    for (const event of ['pointerdown', 'keydown', 'input']) document.removeEventListener(event, interaction, true);
    window.removeEventListener('pagehide', close);
    for (const controller of requests) controller.abort();
    for (const listener of pool.viewListeners) listener();
  } };
  return client;
}

/* STARDUSTLC_UPDATE_CLIENT_BODY_START */
window.__ModuleLoader__.load(__stardustUpdatesWrap({id:"dsh-sql",factory:require=>({apply(){}})},{"name":"dsh-sql","version":"0.1.0","hasWorkbench":false,"packageVersion":"0.5.11","label":"数据库","labelEn":"SQL","suiteComponent":true,"sectionIds":[],"iconData":"data:image/webp;base64,UklGRgZbAABXRUJQVlA4WAoAAAAQAAAA/wAA/wAAQUxQSEgZAAABDMZtGzmS+i978oV/REwAv+rZqw3mO9Hujv0Fx49zcQmo3Mlh5u6dDZe5YoeOHaiaqDdpwyPPcErDiDIoqWXJCod0TIkNTIkylt/1gO2fIUn2/70jIhtja62xZ+2ZWdu2bdu2bdvW8KBnPT47WO/Y3V0ZERmv66qMjMxOVJ3zYUS4giSpata78BANEsQFEcmvp9q2ddtWtQ0FKEDDf/zEAQWoIIaJfzyQsIAHLBAkhALOmr31ulJau4/61+eJRwQsSJKqSOXgW0QYYBjdi/umqr/8v//47zEwzoXgnFXlbcP9uWIhPF5VwT1hZTXRdYOhm285ok/X0EeI6ukTpnJd/0Nufe+HvxoDwDTP+/bRQ3uUY1T9AkRz15pHPj65hGPaa2kABoue2qQKCgvDdz3mg+UwMOrj9XVs9g60Vr4yMI91IlHdbIIR2+qJeTCQvgr3h80m7SvMGFbVRHBqdfCYAEZKHSRbtI+l21YvEYLqjp4Go30VSWYDY8XHn32IV6mtiPb6AUZJ19lmTpnRbplQT6w6bTX8Q0CF4R0SUY4py3VVyIt51PoWGdqMcSLYGmMCjeW9q44XF7TNj9AyaVETuGF53VBtDMHENRrSusy6oHXMvl0nosJP7arLao96fAyl3CWN9Ms7NAhLYV8qp5rAkl1IVBUd9hN87UhYLaWx6LZfatYIFyW1K0NazpuqCTzacxlkeb8RUwZAU8NDp+6+yYC+vYfvdOTNH80DyrExLovEl8SqiB6tjHIkqtKQn57YO+ay0nXf11dBaxcU5pZXVA09EUqZKCTkCyMsEiYED5fwC4hRv2eV0Q5oLFvdBVaOnGe5GKvEeiq0yy4xdYtyOno8lpFyRqNmQwZRmMYo82BxTTHlVZVWD4fWUdUSL3cgTyRqf6uto9UbHKKxch0Llk/NuqMPPf2Ci844aJvVRaVtmyqzrSbjoJpa4QZiIkHkPGYFpQ7/hLKoVxnzOxOzKundDnhy8grYi1n6zSMH96ykbVOc+v0FF6lQuIwET9QK4/Xb54xLzjuq9wZ/wKZmCl9zi6z2e2QBDKClX16kBgwWP7cRsQq5G0Z1EyEdKnEteSxBZYxtett3zTAAzNhJEUi8Hp6ebW9qDJumVJSc6vK3SAP5ct/y71cZzbvhO7nUQyRYfE28Zp8vtMU+rRR18Y5TqIb6fgvta4uRuSmrr7HyHMF4JQx0kL3WyjYS4+qIxTfDbDbRaoWJ5CulHUHu36fbgD/ha4upOiQSK6nxbgfilc+v2xwXFH5bN5ZKl2vidyhIGSRbDH6fCxmtiMRXVXUJn7cmFrkue57glcm81/bTZehA7URerA79GtKqcETOKWNckAqBctTDTILKaQkvhGAec7TnVp5Av/rYX/HqiN+NCXTvFfDdNXEy8iKV8DyqEvRMjI+Tqa6c3+o3Ouykw0euzcIyvNLgH1/LBwozOxGL0yMC7buzk1PHnjcBB49JYWodUfuLplg11+VfndqVOK8s+tP/YxgHxwUStJ/WVrFCs1OrF5+MtAQ6uGP0qB9hAimlNgbzL29HoqKs/zs7LvFVnJ3ToKVQzgwFDuAClRIdBpcqcimSAaZtTl4F2cuPRSy7x2YJ9mXYEpEYpKUVM70aBL7SyllO+Wg+hkTlMH/DDG6FSSI2VkdCBk44+QvYbG6JRHmKo0njfBIVA39kJqePi8mL6WxBE6EcZY0Igp0TOGCLwnGVQtiPvlWsPafNEWzoIIncs9b7CIyJh4hRJIGdaHXRTtaisGwA8Qqx5leoSMu6xPc1kZBcELUaMGrEZRh4SBvLKQUjcaAV9LBvxnjEKsJe114Gu1DQZfdLkbzAOfW/c4YPo7TZozj5rW9AORIqCm4fcgLVVgRssCqCoIxHSdix6XBnM4yx7kB0kAmxOqoDEo5dU8v0g1cAx2qLnXjWgqAh0xFWMrXWsUzDXd87KAjDFHneqSzfjaoADJRR3UzHjiQaBAvtw+ahpGPpA21Hezgdtmi3NfRd7cgrvvNVVyOqwo5Uy6jTZPjx184vylMIG7J+M5g8VnTecYgrkRWmdKOakIgnOHOAKyuyl3JMEx+rji/6LhjVfwvpkm+3ptXDkiiWQPu3TBtge4BGU6k0bin6LjiNlIHLaoIxbyJ57klX7ZRFguMNx3OtqehyQAlSam2LhgkS5RYnT2fsXM0aYitlPiZ0JVH0ey7TYeBoK5UJChnv7FEE2artUKc8ShjTgXjBpc0Jny+UfgxpsjBmuQDWwkmsj7+vUXArZyTajvwZ2sEsUgG1sINaCmSbZCQiMaVHwYXV0uoTEN51jsd5yxBrpygUYnhIg5x2xiWMbUe84NWPf0EluMIC0naodTXnguQ1MzrUQ9DE+figFbEik4+u38N3JHFcTfuKxfVUMYJ6Gi+VPp4nzgqMt/E9axJYpl1jS07heJFdXtwwgs6Bv03QAbKTcXUMsk+TydRhk79X1ECDVhit8gp66gALuKju+ZiUWbkJiYLiacv0pXTxeb9IACKqdyLpk/ihA7FC6uAmY/e1DNg7PCsFoWVK0+HjOeKFXH81/CAOWkojbBc7RWaCfZxexDCMvrI6m/rsbQejnW0hhaPNinLDfwE5xx9QzsIDpb2sfPhoJUbntWqwjNXyVzz6xWn9ZqNtZlCMXZiRXn1KE650m7bd1oMMXvEod8lo53XxHkrCpbZqWFuvtb8l8aI5ei6E62GiPkEUabof4hSexD/riRVNxkAmKxYTRKmEsncJYX+fXzSvWjoOMqZMZHkVwfuljO2eSgpFP5nCgvUK5cUE9f8E8ZdWbNqa+ME+x9RCN/lmksKurLxQekIjEtAmbRbJFtYW4xXtfi5gCWy0wp4kCrT1LdCyJQVMj7w50tkry2erXd8Wh3wIuunzNaT3M2Zu7vripIRpllRtt3jIrjPIK4oei48h2nUXuETvJBMUZrYvhsGp32Iskm+8bbiBLqrGS0lD3cEuuYREMfA6pKw3VtcgZ2nYZkDBclWXYP4aRTA4DWqOue5rO9IxICumOU+5jBXyLol6StxSBEPQdba5BYDAVqyyW4I3S2ZwFovXKQT5mARtRHPrH9ybraeM8xttOcry4akoxogGnNZaloBwRmpUYnxok2RwaqVA4ecuxHLv3hw6IdiujsTch9Z6Lf0Lfd1ilzx3L1xAIvfYAaolN44fNaXVXegwvaNY444wQJngeZnt0ZZY3jESSrcI7raLUsoWF/htC7YmNX6IHJp3g9PAktEJ02AfBNVDKonWOgW4GxCofltiAst/l8PpUeezW0jgmeigIgiFbTiimhfZCqu7aI2tiefdeYN1s1lXCb7RaCMtn2SoNK9hJ+fjfhJ5N9b6A/YYChdMKahjoadUkY1nWBesv1SqfrKrsTD35Nujh8rGBURzK6W0ISPYgglQ9p5nuEucmXOD0ybLHC3Oeu0C64tzoSfLIk3AbT0Uxuc+yCTIlipymXlYWnNcuiWnGSKaZ3fwbz1Y1NJpbEs81yGPggzMhXUYh468ZFlq8BQVZlO3ACE+7s61k9MHUUTjqLMmpXyl68RZLIX0ywgzoo5jOjxuUNtzWp4bIBl1/gvaAcekJJ2IHkZZIpvZ4LD0o8WUdmKVzi8Tyk45NgQNU8YCQNknIu8as5lpYS92Zgy8XCQvfNyTXzDG3488USrjk2EtaS+EIUZJh8UEFPvZpFac57fFPUbF6cqcXAk8a4V+jmiDuI1ahh9azs3YG63LTs/j+dRfY8bgOHQLNZqmlVAJYVk8dZHy31PKmwjB8rdNj/98LlbMEf5G0DIZuS0YsuvbInQ9nAWDqWf1IkbCC0f/Yvkxra52BuCMG6iW2WIWAT9IaASMNFjy9G4domSB50X3whoKPdEYTM+Y2pYRKuHTWJ9JeaqDkgb45enTdxy2/gbdiLF8+HWagWW4e7QzwT4+7kQrGG1OjYMPY8yBGmLqfvYARgDUylULX+1NLDcNDhwiMncv8MwzC0Oh11jQJHBFCAm7AQLM6pkD4TRwBTRAsdRFjxoApDAD3R29NDTa+PYD0KrQjCtJ5AAvQgYeVg4Ny0s5M4+0mHUeTPF0WOJ94tnr1kbrJPDsgBmnLTHicxrQjhyRTAcIPiCWPV6zbjeaGlJhzyh7y1qmOxTwobqg/s5t5rq5CnQLIGxnDk8aTVMKwl1rPYzv4qTNygGZOwQ9E6lw5PgmJc9uk1xUl9bFx4M5MNdZCh04PrTej5DnWMKO9JHWezyttSISf65NLHPzEsi4K7xnVHsWga2Qx4k/EJRp3j5zkxFrgEqOaaLzLD0AS2/NkLVDMpD7kcjBIHvl0HEEz8jPgjTZCW5IGmuJlfuSlw/Krdo6TlAXrM9LxFX5ZRkjNMDfq/G3gXlohGP82LbzYylmPLxmur17Szp3xfKLa/KgNbTp4s+pdMnmGJJHUgx2xa1Er/B0L+LZK6uhYb8eb1pTnIy8SSS7yzZUm4P6pkejFmDJ0b3qCyfgGJff2EzYTRTmdKLsVXA6sckoy7bfW/jY7xCMvN4D5eM0Enl4nc5DUCppMjzPn74azd4BqSfOPGY9tZa+xu3EcuC7+Y+QOmg5QjMi6EBqtlOutt6Dw2DFKVnXtVjZ1v7GUqgtxt7vwt6XsJRY/TnumvUzXss9RuKouc5gWfa1942nLIDUwSZWtR5ZDiFYxmPKtD347zBJfadgB8e472WDchirwNOR5tVUl+1aRkPvmgMTfluLcXhBxghCWgpbPE5dV8ENf+uW7R4EHRyEthYfPjG6Iw6VoiZLoLFstFkjXVxGXrajyk1Ds9JBeog29bBQYU5vgTYrRpDItJodpJYm+QFz/DVacCNMbnNO7k48Q2yKTFHxCyhwZdnwNX4oGM+wc9Fv0KnB3GfuKFyCu0sY8jTPTgTdjFKi5LxNnGYA/VkcwXsdycvOmIxSdkZUDb07vg2w5O89MxNOvSdDSZ2bFfYAI4xywe4ouq28C2YOyVDaP2SAQKUltwh08CbTJAeX7ZqdcNrs0TkaOgMBwmujGoYC/fKVaNyLRHZjC1D7/jdCplUOcHw7hJGMVN+tNIwO1PHZEbCw31rbH1FSaV8IEVQ1hulxC7grSuFk8rJsch00G0ZLqVM0fJ3iN4Bror4BtPRJOatA7UNelhS8593zYQCVMQxF84YoVxitHRn/WQFkC2eUaRydaR2EUZeRh+x+PqTKsiEEaP0O9zxYYoxprbWoI4w9iMK8DYhnKMIiYvehZZWEr0jfh6bxLT7yPWN6fJ4vK7TEp5xl2wApPM5PmwftTEZ02Y1QtT3lsci29Nt0tWIRsCuyv/PO6r6Bikk2cxXIxx/hn9+QUQA+SwfGKQKtZebjknl0G2SQPnafysFjjxEEa8kRfehFLGPd3WidTuLcQqZLPQBRShMpbZtclalW2DFTL0F9/4RKgSEaq7CWOduAOO/IwmUtC+CxeJV4ltr9B8gE1bx0cfYj3Zk0X8Ht9QN90rOWveSCAILG4rWIZ6dd/g6ZRdtC9RTDfHOU0brmCK8MkARLHJWZ06MuEyCTlbGF9sVkh9DgMQ/I6eQoR192RPx4VvCoVwNkFtcYQ3FYUbmoZWhz0OCtL3H8ORuf2Y334bPgJ0/ZcKxhloIjm1Gx32Yss4vO/G/AFH5qSywT0r3HEtcbluKrGA170W5GzNjPMVTP6jZsj+dVwau4zhnAI7rCBMqVMPFthcGq033Y0d/xKI8W8WM/n5mtiaXvu/5nUFHVmPED5pKzPLqjMX4t2nDWzzii8aDEmPSV0xGLIXV0K4kLx2PtTHAD2z5JjfgrDmofD6S9maCOTyNwfaXGokH/KuNtFuLE90SqosK+KUPQsOkxbS0SH9fMsnHdMejeoa1OaZP8rIc3r/Roq4Xw3Wevj1uowYZ2N7wJKCtU3iJrNBasSTxV+5ZLIQM3JE6jp/HizNwUVASF9tb2v1niI9X2d059/nJqBEfRoXjpHLgaru08fntjeByZI87noTTB6D34QTxOpi5zPpfJXOCiDM3YpV2PCRLvpugQtA9kEAsfdxCdL9MzyhTFzT1Nr+O34bZhc1I3hM8HqXqPS1LPlphINeFq4+zknQOKvpdqLEvJ6W8hs5f9Rw98PJWeg9NgmeRM0oHelPr+63Nprnw6YNEV5mQ6h51CEW0kTkgPgk6ETMbc37l45SeNeW8LU80Ksi/wYnxtOGyDg9KDR3fYoVV8aqEcFZsZW9yD5lqrBJ5tC4nWHH05vEU8vY+H4CdML6X5XRVMypHfsLRZ/yKZiVD4vROx9O4xWDCfNkHrT8aNsZcpdzwvhQFooI0aRDxVb4WZG62AmRHPR7tvg5Evc9VBkqT+uDtNJkaRSG8zP9ASH9Jk66WaaaEpAOTMeLZSc1zc03/zwugTSIUJdC38SMaws3jmhsADCTnqm7VRegE5jQy0wsp1OlsjjCb6va17TnUX5Cagk/R2wGgsCsde6ck1kCW8TvvFvU7ayG0xtO1c4pog7gvM95qicyMpyrUwzXiGTkGQRHka2lnmjK5Tp9s77fRxFomUJxYyCwEmv4IETaMhvc0Ogcl2RTkVfulKLOVehx3PmjAfMC3D3ALoYDScd72dfgaj8Ya99u9Dqby+Zbj0Lhao2WQel9xz3+NjQSz9my6jVRjaefRMAZjAVE28j9dZ4vue6SujmgYo0Bwei6nXt0cEDfaNsy03ZDTQhNWIZ/J2JRmbwAFhLjlJuwz1K5tOV+6IjM5yrz6bPhdjnW1MAUFLeNmWQIgx4KJu15dIUWQP91JNJm+XajI6ka9Oem5nAe01ZGpqv3A9nLCn39HiKhIZja+d7Oxq9o2tzwK/bhB7aSnweiW8Xuzr0yz7nHl0PfwkUPhsPnSWcL6ncWIP2fZsrZG4GPc4TiyLjwedGDJ4X3pmyThw6Tc3/E54L54pMhiTER6KguavxEfbQ2Xw9CwADqR1VbYoQ6+T53fWEntm47g2EXw8uDG0jpNy6wJZCoCdxsA4qaAyw8dd2QQ5BDKIEQsPr2Mcr93pAbUtcVKJZIQO+gfI1C1UatSQ++kswGmDlUiQwRRmD5wF5eIhlYjUIGtz4F6JzljE/TumhhYY1y2n9Hn3x5BG65fCuAmRGUcFuRUnqPArgxTIFihy+Yp/DCkL595OOGmXil6LikZlnarXZuYxIk15ngRlYryZrMOlSo1WB3rY5ULRehoo8WI24LTO7/jo5pC0KHq2powqckRClmwLP0RWbxj6E752pMXb6EiefZ1nLOaCzhQkrKlRajf6ngCnOCy8XM2qT7tlo4V4iUR2U+u5qREqMJk9aGMFWnsQsHdOZJ68TIKye/p8zU8jc4u5UgGmUHfQKEuzm2u+lHQFyazffaeJkCpZXmgMUOmsC+R7BAkc9e9vXwTm5Tw4dGbfoSlZiYzO77UoUUeGoXZq+MTnvB6thpFxR7W81T09X7w2W/DRk8xt/eFdckf5HUztb//5v088MWqO+eXc25lUPnTcSb7C0n63hzJ/6lYwou7bXtocWpIgKtcpyzrye1GUiqjvOxBzzyn7MRg5PQY/UYeA2I9bO4D6YplT2VZWG66LX/PgXLyIkNdQrzmQycTFyjxqbyn7wZayuhGdm1Nu3ri5EH6S0tWkhfmBkKDdVeK3tYjl5r1Tw39CoLQD4eG7IcxzGd3Y1GoqUJIEDW/S+NZbCHMjXe9psqfCamXxAIBOhu2xZ9cBS5rHFIL2MX/HBHrZBhlw31yDyKJnjfsm0M6WBB7QOsl4v65cv5jbmBtxKQesC9rXmLh+Qs12FJK2217w5MeTGj546uJNWhM9BT+lM8cPEqlCjuumW3iwPl6Z/ZHgNoD2Ayy/rN7SnFniyuL6j+GnSJ+NaQGiGUVPLcFI32IQCoGvdBhbLRUs9t9yRGMlpUHpyfXyOT1FJjzB7P8Rw8IB2t4J0yMVKBlE46dpQRjnn/KA/nhnsdN7yxBZFjYBQGAAg+8vGw8YKXX82ezcVkdfNxYYLLh3YK6nq8xcAxOxC1chkDpBpV8q6YiNVr6CKQHammG42a/FVUjJMFpY+NRm1hGtdtBtr33yySs379d9+E1/m9ccqCWTn9qznrxRLy6BgfalSv47h0egATSNOa1HyBaLMgmbPk81wiDyJ1O0zX6swjnyxwvsGZXPvbDvDb/Cio+cT/LflksZIIzWny8e0T08rWNTi3XtPWzw6rWROUivfsLb8+zDsei16zttzqkQLvPeO6Mvo+LMzNLK3L2v/a4EA+fS+M3D+x/12iwrNgaNU57avx0xaj/6wrsfuv3UId/95d+kciFYOu2Ny3ft4ppzPPeE4OFs9MvnNnMMAheJVpcdLnv3Fz8aZ7u6E40EGme+c8norvaE1wv2tyvI63/4XR9898uChQv+mD7x5cv33cA67lYDdzvx7NOP3K53jT0Xf+ev9ZPvfvf7P1x40TlH7bHJ6jV2avPE/9uIWxFyxq3dwN3PfuDdSbP+WrKquVQqNS1f/OuUsW/cevzOfWrdR1Aoi50/vHbdenRrXxe5dSs8K51dGccqrL2yi3/pk0x3y8+SRP/fiLfqvEbvAYMGDeq3bs92Nc4jKOyfTPK488rEWWQWxtbCWaL0OybPilUWBykS5C3hxRxBQYNGlgIdJY8s4bFW/eX//cf/0gABVlA4IJhBAAAQrwCdASoAAQABPjEUiUKiISEWXNVYIAMEtDdwufhurN/2nZ/ZE8p/a/RAqz9h/tH6Y/v/u66wuufKa52/6v+H/Mj5if6P/qf5j3R/pL/0+4B+s365+uh+0nuj/wf/K/LH4Bf1j/M/t17vn+s/Zf3Pf3f/d+wF/Sv8f/7fXU9hv/J/9b//+4B+4P/19db92//f8mf9j/4X7j/9f5GP2q//vsAf+L1AP+56gHZFf2/0ReC34f8t/OH8Y+b/tn7H/57+0f/H3l/nbyjehfxv/R/xvqh/HPt/+E/t37ef4b9uvkz/beEPyj/r/zG+AX8e/mP99/vP7Wf2r9tvdJ2ju2/5b/c+oL7B/RP8n/c/2+/yPo//53oX9jv+J9sf2A/zH+mf57++fuh/n///9if8fwIvwX+t/8P+n/GD7Av5b/Wv9r/mP9L+2P0xfzX/a/yH+z/ar2y/nn9//5/+S/zX7YfYP/J/6V/pf7x/mf/H/iv///3/vC/83uW/Z3/x+6B+uv/U/PBsBJIN+6jxDdL8j/vAQzI1WgnD+WeIve6aBokts5wGtUN5wp3yGiSPgJ3PfftFsrKs1OwDFrNxImuRX3D1k5Ve3aGHbmAjaxvvXlBDcpVIzFVmnGG6Xyp/i6GmjQrVgWcwRTM4GMVOglYce/FXFTfEQ6lxOPZTLs2jQF3mv8U35Cbs8zyxYCByaZFVWzrqLQYWyEm5cOfcUkg0tNGz9sDzcLBwMQm8YawQbqsIaGLCst+BTDtqM0bwND235lOyr+boJynj2pSQu9OdqThQIWTqHnOs7Q4al+MQkGNZGTvhgFNUbKEmHqZaPo3G8T8xMUaDj7LzSXQ2SXMubx8uxZQYuvtTJT2nW1JD6iPeoYh1FsKDFGus7Cix+R/HrQ9Z8Xa/45QAl0fKBk8PUg2+doinr/Nxgr9YSqHkYK8orsfn1FPg3WzPP3+kJq7ot6uV/CUzFVyotaZUhI4FIX5S1PsBMPJPHYZDbI8cGtXOZPv7KFaWSbepXGglqlvk+zxMGM0m0BqdH5SqF4wWOujPTOaeeKWPPvhx4ibD7uBhyGWwG9F7PHRJ3+qFzj//+Guz8qPjyYgYWaUEpIH01x6LQiguebiu3MalQ7c3ICI10Cg8m1U9de7uFT/EyF75g8MEonNhYS3hx/CVa4A0TZHbJvi8cr3dfqcKzUFTHRWDI8G3P38HX0l4ot8rp28l4Ndv8PJFHv617g5jVWpQuk0qhYKQLd1BiJawADUZto/imHVk1zUHof6riqoTbOtjW1dAqo9OJtepjEtt2fWxLvgP5iEQHDfquwdjhkzdLX8Rw8/r/CX80uD3iibUNW6UA1L/oW74MnfkJaC92gZjGOnLjrMHwEk1mmIBLM6stuQtUqxRxJdpMBouxBd1YnGNskDFXfdb2Wq5Eup0jQhNSHIiAHClF4j/+Zt2pvOoeJJ7PRBY6D1ArclSKl4vvR59EJWbmj3FKrYTZlUm/ul8RYR4/UxQqznZiWG1/zdtVcOwwob1BPfKePlBZGuqDhbdYqp/4OMF6fwTi8TbF/cyk1LZ82UL1vP+nqcvebWthy2RmsvYm5510pN5Em+1VPnJ65EE0kw8eKlM0KDDTxgZVq0G9YvlUAz0FzQ9zW5NB7PMu/LbF2KsCjrLKVBjNlcDFxokCNmbQjDdURuYfE6/uhAo+PYnV0W4qgJbl5HrCJZrWkzbirPdiwkY4/0oT9njzrT5Fm1v/ztv3cA9xELNa5AbK9drPBfesWwkAQfrm2u2KvWxs3mSJcPwZHuPlZQIQlc1q+9+IyzwH+AqPii542Tfh7kveR+J6oee18vFJc/K/OW/Kv7ANGqB1fte8GifP0Jc8kaF+rpLhul+R/37nCnZgAD+//KPAAAHFIkQ6wBVVVCLMumVfyajmtufMU7R099+UZNaeWkgr0dDmMKBsBqU94iNnNKzO0IU94WMS01FFi+aW6OhgKu02EpckAWOsa/h2fIBeAf8mNPxZXm1JJm8Mdg6RCX7xxp9hPPAda9Ux5z8o3Kbdug9a7QDjAa7Yq+3oErtOXrayt9FeiIGQEd0vJr+sN/D5LRWY2WDdJA+0FJ25aL0xgW6zp1VmMV9Gv0aJPFOf7aH3H27FfJQXnrxdODA8n2gTJEqNGko0AMQOrXjeDyS3TAZDMnMVQ539cR9Xgxr3cqi6xYaxKHFgfUl7weKj2tzEzoGh/fjZI3W+lIJCzGMU8vs9n80/T6+AY7cxZ4e/7vXfCjt+/8i14gevCZlGrP47IwW3zmOqkgUV6QT7ksCW5PIonIedV2z/TwlHfuGNjc7avQoVkHVZSAniLzqlKCrdAkmjMvXKu82oGQo9TciA7DECHsSQ49YUsW5aXSjl6ENAkYlCnrrX3xWH+OH6572ltwIP0Z1cqgqKhJwRb6natmza8WqVSYxuuZoMAeFp59K/wZ8X6AmdcnTi+hvbDE5NBl02mss65kTJ/6rkzCxsjjeLN/PRUtBL081jSWixXjz2i/Yv8eGwRyHOLfcRUlpCkV+ylVRLrHDI2FGn1W5ZjP1rni+uqtIhkhJtxU0YklUfYe+ZBlN4QEP5/JqXjvou1WK4yQtfITsUkNqK1viQpbHT6KtP7TsrKxHsw1kzFHiqiI/XiRkqRbxJaLgMoVj9yZQOGkUBnGf97J3kmH4WLJDRdpXRTwyVo46g84CDLNS0gu+bVmO8tz29hSOiGk0kEuoEZfMntImoQIpmn4nfHd1q8Hp7rlrRwPfWfPguNjAXiHVD8JZLcVHdZvdO1AjxTu97dCvAYa3fMk6BEhHZzhTIBL/bAQYlkuaKyGs5M1XAabTaaY0prQsC1h5pHoTJrJnaXP46BGGp1y2XdqxOgEif2FruOIw82v9nfg6aFY1Lz0N6wtnvI58UsNwPOkgrx1+ZYTL786CqDIWNZ3O3Fq7KASaQ7xjAz7qAVH0b3ffHf4WMoOByH08ESPDim5Uzj6s0ELBDYgMJiZvTooZhn0K/MqD1RTTlabseyL8ijsvi0wqHtgeiwxNyMpc/2sGwTiQQBeZSFHdQyBbYhANMNQym7tjlGlulxPINAGbmyf9Rmv4wAy7+nfAIaukmOzwjRe55iY3tKF1tzFUzq6ASChGcHLz6elFlz+a+ddHFhmUYmzA4pe1V0c39Mttn2NH5SV776gfAAQqXUyEDewEbIL/XcjvzkbYnwWl2BaR/wH5HFM8pLBJW6d2Z1DNtcmHhHeGAFrRQdkBKMYtUVw+sao/C/SIcEWQLnLDJlvlFCPx2po1EFsR8Yy5P/ZwC35+YUna3/7bgmRxwXtGFrM9S4P0NqfOJlWjIOMdAy6RAvWJesa8ojwxiODXVAl1Kbbj8XaJsqnrIapYTHe2PkBUJ23dC8NxCV6VS6SGiWeieG35/6XZ/FmdFjH9E/Ng3a0J5VhxMW+AD17SeU77wo6E3esbb/opLaVTxe+tcwtyaG8KE7zw5Mx5ZdVNwjP4IvoyCkzml4TIHtudIWR5F7TXVSPptIQfCOYV030RLJ2uEB+WsAMQ762knjtxVxxfmR/pvfiUaQplicGVREmbpT76o01Co9RobWqVKAQ/xbhxk56gJBroCv06EMyRuGbM2+hGGuut9tkw24qJBDkK/ZdCAUvnxlXoqmlg/y/koVsvp/IICFqeINpDPb9uT6vMGBx7RIZXi63BQpsHDyn+VVmsA5MJNt8iXg/1PUdnbFlFxgu4xHo4en/G0c0/OY9423PGQXdo5XZ29YmxpHnS/9AlN+odz3GQdcsODR8grvXjU5SRMin82tIXNvxTg29mJwOXD2v+q3nDmlWjh/IFY3BlZ7otoKXVXSTfiRUzZ+VEW0NlGI/W7Y5gW66h95D5iArzJX5Y7Fb0YigaIMwPN+UT9kOK1p7TIqXh0v9eaPru6Tuqs4+Q9QAz1Vb3SjQTWIQLYTajK3C1NsUvElBx3uFtctqWanyDT9wJGmlE5LnnGz0oBSihwCy2af2pR5YkGwMO4l28KG3kDu9K1xotsKE1OKCMKeDbHkPik/hbEi5WQLrT0hIS2c89sTz+DY039EhjjQfjmoEDyyQYf3ET/TCBAY/w10YRlxvjMzxI4yiFURJpY5Nq15BUjupbsew7JErKRKoQq0av7JqISWXFfTCUZ3oJRcP7VZ9o5hZsXujhzVgj2ujByW+eRigb7rEjYNn1J5TZNbRo5JWvPC6Ekzg9ZnTZ0MfyTcemF8fmK08FH4Wpv+ghR/fn/XexyG5SZsBmLvuKHc5P+x/pkbwJx0Q7yPC8BZzxA7hlNFIVig9CkyC6OUPBeTsUGNA3wLo98B5OjGnafMtjI0zdzEPY9YNURuoHWiyhfq+oxDKLWvPS9Plo/yo47Cp3C8SIeN7kSWElheexZ84F5BgsFypZAITM/DLxPzeu0ZE8+dqKFO6ePKoD9jtHKjgesTU4+UpwrMCVVhSJD0fhGHX/b1l2XobISCFhxU3MqVEoDIM5SzcwPVljKnzpb2KO8E2MXuQ+LPkci6ia5ll2aHCocXvJZwXLdpRgp9RQFfGdZfbY/Q4qNOGZnPqSP6joWoAXDTTRfM3tAmlv6glmkgD0xRdO8YwgE3A67cHYn9YaUTJ6+DDl1cZrSiKOOJ/5epSx4cNJewPGkQmCqzRBVAr/VxyDLjvBBxRqN+R91jZbHnGy37ifn6/dxw9G5nkFqeP9UBUfmxDEhgefxMOQ0FuMoEHwCJBSpWkVv+4r9IvEvpFOCEqgcVEwkeB+6JoIVhuT/1dX40U3qiSDl7dMTwKSJLD/dX//hqzUfM+Es1AArtTDjlTei0s1LYRfQrh97nNNzRJE/zrxkcTf92X8pMem40RitrN7S4UCTzwkToTqsn25rWDU5/tlkFLM/5Bd+dkn/8hsE59naURaD5JkG+UQAGUvse7Ku02lYqVkMhqBRot7YgTT+6CGQWic8wKdIsW+WpbAagdGU3eSpTFn1iWQLc6MCwYoqG/UNdzr5VsEp5pj9NN9HRjONpKhMkzpjTeTuMhuGXTJe+SkmgG+cNBwTE369HjUhKW4V2CJ8A4vSQlBgXk2wN/caWpS5dhIP6269ar+U8gubOvuh4I2DATLLmZ/vPiB1DpZ93TXwcbhH38MFDcUFzjN5ftwrY4g65U8jysgYJce271UDNcVOzVhdIsH7DuZXdAfGgQF1vqrrJuBueNpN8b0C+8jhBRGfgAGnwC0v/DlLPQIn5BXF7VxupVYqgPTLp7SH0B73Mv/6U5ztqHOwSGr77+u1srv6nUXkVVM4NG96TURuOwfFHKIqhiyEqOBB3P99v/EzvxOVVWlUC9lhp4Rt/PXEwdXx+rPcW/hKFHrLlR0EEmZh71A8FgCsEcN+l2AfKiJ7GB3ySUUf2UXzY4j8iPS8MA/3+d9Kao2DzBzUBCwOXqs4bPlPQWLysTMCJQ86NgKYx7uh3w82rrfFnAkLCdrv0gSc6HDsmcYObMHJRPxfFO8WpmjdhQH2+VSJeoUjnvYy2+vsgoSKzccSLMon1nNyIh+GRZEqovgYGNKTkKqkTHoYIVYzdhnnVc5lljgoSxTYoh+X8iGYH1phUlqKyzRPE+Gzxdd5z4dLCANFYNQspSK7w3F2yIBrlPdq2fs8E9fvNG7ccnpGmehlL4TYym8ajmtPRKNmamJMJtzL24U/HDvWF0QwgRYapeQlZC6JD+chQdbn9XFK8E5moSOJOoayMf8eP5ENPJVd0Nl5b2AO/USzGZiGJzN0SkTwndcNhfTMeGKKgdGtf6uAwKWKoZR0m0AXKB3c5UqA1i5Tr9YT7sgGVJFPMdxX58zvD8gBNCvCjEXKZmfZqwmDOkzISPFBbNxo6D3kSNat33X6/ahJAN1txqDq+VKVIidGRyHumd1Aq3r/w5y2sHqqpC7bCjtE17s3OnlX+QxUB7Znm/+L52vNKOV4CFgRZCW83TSQcwdt5pWf83rrkCN6PqP88xhYRweQO9MfYPgefx00RfM+7joqUEc/fJc4RdRx4SSwZTIIg/YZ2nVUMMDEufcXm0e/jmYN11TRddPdg/dcM3aRDEtAcp7pCHkROqs4VFmqVqScPjUkzZ8SxMapzizs7V0P+7zHN0MqNWK2H+3VgfA5wM/C4RIB2qUZvWrQvGxqr6o883SegVGrMKDhh68ddVLpSX7s5oQUTdELm76G/641U5J7CvDmwBYjEluz4vddo5KLKm91ZOvnZsAxhuz2EN6Y/osOd4snOCk1N9kJsEDCj4mlyWsVCtDy9hkrqEO1xdh81Jx9SZdpD0IfMoPLPhsJ2krWr8Kf+2AQptq4JBxwv47GRjt/EUxkoiLwrdVODQ2VPxmVyDlQZgbVHIW8/Hx12yOZAR5Um6+3kc70N/AmNS1uzmgP6N0CWjreju/eoPZHsogL4ealkRaij42lLCLmskE3uMhnjZiGkk4EnBzaMuOOw2YCRdfNcrxV8RaZKUvrJoi2un9iCaNjc8VZywbdwbAucmsBY4Pa82HJviNzZ+hb7smux2gEVf22KOh0c9exKrszBK1XeuURl00UERFIFpyzTCridJuZNgM8rWDNWiOZXETCTGp6vhoXe1aXuY30nMhPxFlvX3FTScUv1ZKTa0owcrZUNlQ6oJT7WJvnOBxG7GlmuWRRHt9oP+pZ61Cc/BcDDrxrMR1n6NiNvrK69S2emJAKRKAZQyp162u1iJUzV+Gs9s2b/tYvt/MAyUlEz71JK3rBWN0cNuDErQTzOYFno6acg/Z2ab9DEVs+S+0x1idAo99kgCpgK8BQtE//zw+OAUT0TgA5KLaJtQLdVc1YdPuP6wNnlVREum6O1gRvUiAiSN2hnv0WpCMHr9By2IhFxvOJqWBYQQraMNUGBWJQSV5fFFkZLP22rsPht6IQszF39tKmUEIWS2ZVajfpKvm/lUoVsA335ifYTJ6EtSf6fxwuGDxT/qhEiWnlaOqRj+oB6233JH4jf1p0WjbAnk8pcP1lenb88UqKcWcQI6l8mg8abWdij2fq3yfijFJP2RPodiF46kOURKwklHxGANgjaMA6hiNhJFLfkHiOAGiUoOD+FrOVcTavh5+t4V5ZXJo9HBZlQAkCGMqjHOnBdQ4cRvUqYoyOF7WHhuazmKpXk/DgXGnKiljDkZhecnr11TbT95gJLd7M43JyI/48gPRGGj3rGp1quqLYh/+P5iF0x2PdiIEkpcdBOqrachzHKlupFWNaXK5nngsYvNw1m9mNHoEYjBahGBGtX4dB2q/HFGMa2P4j5dIJxR0ikuF0be8iqnhppEuW4fWa1442qNTx1thTUCLsSlEIr4OrTAb0dC4EWpu0rH4/JBNJTGSFLCHizx/E6S2jWh8Sd9z2QPq98YUvHRTVSGJyj0ut92e441S1bzUURNdpdqzENEN6PgSkr9fkkVMfhChiryKGs0jcuXTMoY/qdDkLH39Tu7E6utJxzfHYK8RMlbWD4r/Y8+qluWUIpkpxg2m5DQv2zkEJdkH23xUQh+JMSy4rpg4sHlevLbQI4ozxE9Gyv9eP/OYK17mUnyE/jKn/3afmZ9VOPL0MxV3qj6dARaF4qjn6W8tyBwqoToCwjf7s9eblggTJ9ct7l0Fkym+nLxqTwkClH2w3VEqQ7LkqeUuowdtGkWQPDX9tSFh4tUG2iPEIG5Bz3Dn1DWTYIe4vWxlfnLDD65D7Y+XFRQ6qGdx0hwb/sllHcV/c6RCOBbdS8hUdtl+UQTLRxQ9K/vlCHOADNhQz2NU+EEpuntkoMj2N50ALG9kSVmgt846ySOIHWnjHMTWH1r4aTERUewhxeBomsQQDEpw6gfks8dzzcm5npno0KC93abDVkpr/r8WzCNKHOZ3/iokHphIyoA1LCQocyQat5u49Ij6530DsMPSm4lVnluQGtQnEYigqvyc6lg2BlKmJlATsIQ8mbRISqmGV54rL4F1pCDP37FKLOEaMjIa7oEcjYL4eHC6tE8zThBro3u+A3j2D/JBY7QVFJN0n5reyeXXKFwregUsoZtM+dOZD71FSwLWq+FEjAc5slC7jpm1iRb4oPigTdAj3k7fRk93Jo0Q278KOll39K8YEOr1uRbJbO/w5t4xTs7ZTu5x9WxJqyMzqhfYEp6NXN/7BrNhJLgi54E/IhG09VFmaQ2ubUJ6mhbxs5jzOvFaTjkngHC2paN8CHuoqXQfbV28Ti8u7mrdAeaSW5EPX5KTnFb61vOqvsltm6BZhqwMjCkrJNnXBH1qmfYRTf4Kupz8bQGVYxCa+9U1FKb9dCtTzkF3YN2/S4lq4T+4HvWMdtr7o00aZqd07u7WB+GrXgMzaH/0Hg3u+8N25YmYC/M2k4mP0QFGpZAFjaifxddnYnPIncEqVIe8kNqgC1aPdJ0BPtyy1ksXk48yPwnoTv1V4Av47AhnIU6r8U/wY6zDBXyQ2iS102OSiPs7XPbgx0mqU8uPNvZeeXy5je5tDp4Q8zhL6bBF1IsH8nSLj15VWbJ9yG46GoPdZiZnFGCA4SR6wlJBSgi9mJthCJHJQnpHeao3E7GkI1gkfSd7Hm4lPTc8TE7IBHh/KsITEMX6TJoV+5mnpEcXLfGn23sUoV/yBb68UlS3duYHDVguQB6FWfnNeSQxfrc3QotWDy6Q7Buuh1UBk3KZKmICzQwuItJTNyafW+5/036hMHZj1jPOvqn0V+AG1+Nb5kpCsSJxqQ8vvUVmLTnzYumEqTyXG3GHa7bzbMD9IMprxhNTRrpcW8KHfSyf7GqfduffFuyx1EdljOglq89nPxSbtjL4qz1slYI0fVv7TzrlSmjp6ZmUaufKr7pW4munAvrgSAksWShxqH9QWw9Ruo2kye3MIA3DD8CjbP1zhWBv0TlR1Hq1zmLaPtu/a2X8z5uRfTIXhmH7JSww3bDIEObca+s6XC60zymEYSzlIC5Mh1SYVu4uWOTwJ+FOpbyghgG+HdvOSlA8nqb/pcKhy12DvEOVCDwG+f0VDM+RGahe1J9tcgsEJiGz5tCQeQc1cbyAWSyzoZLS1K5Iw/RpgsiXQ2miIZGmyNbkPByHsEAQzQyh0POct6ThbD7GwQ1Hch7bsQlKkpg1O0IOvbVYBLVktMH6kiqUE4d9N8oI2NUdfkxkyBZj+s+hTL/Zwnmkromj9sIozWcsT95mnagzcFcD7aUmoCKNFd7ZiNMQyZzWLlDBJnR0l3It5RIkwNMOh5Ig3NHsiq9kapLht+eSzcy7XdYXv8BGsTojjScmKspgTnADZLQUnOxthsikb4aV03SrBkCIxZp5Xq8y96FhxRo+XZP6/1DB/HIP9g0zxBm3n150o6Splk/WVceyxlfUnDqLBRZeU8WRLVQNFMhf4Hb+QoioQtLFLv4wrycKuh7rA6cgE5OQlMeoNwyDqCUJKXm2Rkq59GhkymtPjsXfjz6H7J2ZLwwV1jKdTkSohnIcqs9N5oMinnAviHhkaCP+/MTV82K4I4hun1mvrejBbOo6Cw0SxBKgrZAEw0Lco6xZ1b/yqI/JdlCPC8cuZDQEPxU7OftAFbDN5pUkTj/ZseHpgKA6FMcIZbGU7c3HAYMgx2apvTXUTYlXcDuEhjvyodWtUheTif2xd0rk6nDk+/ZoHp2B0fJYG2/mp+dCwP5dBL+uQo6IXTwqAT0Feqeio5OAX11PoImCiOWXPOzK/Wk2srwY141sve0eNcuUslRnrZh0ic99ya8n5YLxxkxDD1V53IxpPoxM9Tnuv4qVRBA1pmlm4FvfRH9LYlxxESppC1tLR5mItWueAGp77AdcDDeQdsC1lys/c0er80Cp7XNXxF3767IXkHzJbt8IM7qDlMP2t7kTsZpTrpYERZ5WTZLEvDoppS9IhzrDdJqbJl7UMD1/UFLjkUO/Td0z2LanJfCDbAKvKVcMVAd5VvKgPuixoc2s5uM7WZqYj84SH1SdZPyw4GucPmLEIZbhtV9Wz7HZFUwrv2ZZ5n3wrrXdoMb81+q3wSyeqITFxLW+GE0cW3OC4yOcIZkGQxaeTgtm8O4aaAlZ2EuWeP/Rpl20j0Dlj3ZtzwFBJJ9jHSQ5KpyEy8HI4Lj5/X4yzqoSB9WAq13qax+vLN5LIl3Ep/+u0ohtqH7Ekt/8aByyFLWk0YTzgaGzxGASdW8gzXK5CqIMdnUWcOyb40m0SMbzcvOPPKX3U0nnFaGQpwXyv4TMTTHgcK3RnSqAMfcjpTU/KCxrsdcdylWPAU+s+T4EB4Fyf12sl+lWWXj34jkogIaDrR/DtA8D3+y/h9iOpXA2kdaaG9D0KP+pTLBDh+l4EXToWlaHXGmPLDfaj0Q/n7K1ei0spjchEhSHanw+5vWsoGeJk7I585qZh51w+OlLX72gRB8ZoUP+z6+jRjCAyIA09Wca6bu6k3cYsnO3ZF96QjyxDmsaglOeHzhGR+fwUylU659lOOp/URZBvTzoHSzuVf0S/bo1sZX+QDteMNBpWjfI1R/p3jziMRqrMkmfSuL0K0N9ERLuHFwx8fvZdUYc20WZRi0oSAgcN2exyyDoyo/ENpnu2D7WpACNOne2uvbxmIpcfA6vyb9Z8Ovo9bJCqMKy32+bPuYcWTf6BL//oST8NC3G2/7u0b0GukGt0WJAu6BxbrhiZ7vQBmSMle0SQJoLT25lu9rlrt27DXL1yPmDusvvMPE66A0SW3PveeYk+oqvZK6IPxRDfNCE/TroEwpYE8fKieCd5GcCAf/R2WC+56iHzoLKNjbKz20MnEph03eEISQuWVSs8CS93eJQRHYfow5w0vXKyJMpw5YNo6JhomFMbUYl06NgZEzDXOmXZ0sgSyz3/d068UwmFqjfKZ3wg4UVBk52rgEHNNU9qm2pdamOHlpo+82me6PD5wqznjr7AVrVAnXVKaD7Kr5mUN8mtvMVijwAeX9g9brK8xX01jHxJy3Wv2t+YX2qSXX9I14NwhuzU9q9WJWCKoglKWyG9eiSdygO1TXQYCpjO6vj9GyLCBYRbTYZKET27WXvAsjjmY6ZE88LgArqxlsq19IpHmQvDAkuUWvtjyK9CM+/R3R+JPgFbqyYsyiTiCUPFV7vtUxE/antBa4bU1PnHl2p4YcczxGNub0Eqrpd1EoQtCt/N1j896DgHRf01TtVrqCknxBBcyBJsj3b5F4D2JaJDZId0xAAL6RSKRw0lCzk1LtoH18Vrh+Cw+DR4DAXxE/RsmYdCdLRzjYro3HGpnDWE1a7qEYtAVi2zo8/Qcti8CJU7xu8mlZ0lW9IWovhPpF/jl96JEXFkVBiYMIUVWIXJ8NgYIPxguaDG1lBo+bC6uFU/g7WwleO9d3cPDDbU59saZc2Ft2b0Hqk+0LQJWqfgeHDkCnhnsxN6i84dWT3nGcigk05aU5QQ2XKuY+QEE41NCst9LyMJSY829I6AsLxJ/T8dLFFg+X3K1GWetQncBz5tzFXFAAoE+ZjA8Hb9OFuPiZsB/2sR8S7hriX/+JCGKkDwvE+p/C686/ur8cnjty74+ZWCLzOfB5ui/bTYXIhIsaz9pddOIDM4lqZd/BJ73IWNcxUs6TIuxLjtCqBzT/QDrEtJyGTd0j1SKFV+8CDn38c+nd9FG7TxFGS5artWqA4B5RD+DCTzUQlyWTtyA1I0BNEHI4XR73Q7wBrp9lKDnSEwefHBmUFIK3sODiUKeNmpGmx7QNpmXxKc7BRbkQIRuWvHOjALoENlEs4vlpIwhuIkhaymiOiane8Sasynb8jpgfpiFu6RZwjB1e4SHa5IY3rZT4wEbw0LX8kq+nEp5dKFQLOuhoJKwnz63uK7vN19JhRnBXbG+Jgkz4+u/sGCEbxC+lOXmSN9ocjxqkgj5xc2YNoPEnk20ZJBEFCtnDj/6O+1B+KE9ow+Kfl0L55T247ABeKQtrtF/mp452oZCpzYV3AbKH601iTE/wEahUbqhFM9I4gjTERoUpQWrEM2BbEoMv3NOfPJurIQNLaGUrja/bBRcOJv2B/YeBlkQB1AI2Fqktab2TfCzKSI1CmxUG3OK16nMzryfCWZW834uPOUCcuc04hPpp4BrMrmfyQVPypdl3q9as0wJK/Hdpl5lwgrBXDJjEkgPcTYP0gBhN0joGfacJdfi3xkLTeVRr8ewPJcPiFWsFt4rm9ohCxvyA5sC9SjAgc1hawfl1YpaXr7fqRjjVm5rbrjMAQKd5sNeKp1ZBzxQ/yAJOrtiZaAPRosmMXMlYbUHdn0NLkEnpdhS0573bkYhM2L7CNyrDTnTfS0jhtfRqL9XN5sZTm2tRklJJnYNaZgswH+cU0U/kMNZMI6wkjOmP4p2P3/TwCD5XD9AGVhrO+FTmqjQUvD6F1N8O1pzQkfy8jqRgTOuNx6jXLB0uhVn9OI0qtMVjyraHyeA97hvHD7pi4OuXaZqkhrV/zhD5Xd7jSci+TW0m1UYyAQeW9fSfOsBqTquDxdiVq0HQ4NNUVv5xCyPLwlsgAStrcYyNPADLGzZZN7Ey+4cb+1iKi+GQfLSmG2HNs8O2QYjZ9kYv6wceKmnpygf5yLhuR6LZ4G4scjM8B5jyxitffmJFho7SuYDmnxa1dELXnLuFljrFzNnJo18KHZHESrgcyJmy2FvvKjNhYzXSnEdfqpR/dq3c176T5qlQ5ptpjNEeSajHghp+pGPJOWBDvCp4A328crbGgwAzv97S0SgDyf6hszuocZlPBmEJ3zaQVUJ2EpRsL4dy2qO7Nnp9DFqVauRHyJtG/tu/IlC64XYNyHmSf8XGuzJmyhACWzFuYIEzUSPFBu+VyxWaTyZPnGQcRBp3CnMs2sR2IbcPYmcJmgYZPeNdXJ2C6CHeyWQ3PoPuVG3q+40aUJZCyN6HX30l+mtKa3ljZgq5AloUXhG9fHXVV1q6bt2plwK8LwfVKUWelKnqMKX8pKoMuWsB5O60lXubyNUwR/f8AZSgggtGbQFI22Olvs9rjFS3MdDoLvR47Z0TsGhOs0k8CDckSB5AemGJyIHFDG4bjTiqlOp/GlvO1YJSAu3XxM+TyIT/vMv3VAp6jZuRU2eM1wyCbwO9dW/B4xxhep96t4bZ1gQ0Uj36GfuevRLVdfcMkPTaJdz//u5x4bxyscWD+da5D8WkukOxhugv4NKw8HlT+i6bXBiNUx4dE8Sl2gdDbEWnQhhjpsdDAIUWbfT8tP7CR9d8fyKshAda4XofXoiC//+iZdyqlv6qpm+hwA+KikzPi3VDk+wB1xSc+fsUpXhPi6ImN64DgL8QCSsiWSpmx24uEifw2V80bjdS3xiF0gJwKCeGy7jWcOEusAOyECYglYIoJIplL3YECfzb4C+9TA4ex8vGqsjNpsrIG0rUCxhZICSGIXnnIKkFqaecjI4t4gKtYFTMW/hDzOeQIFLNXxgSauOsOmoDne2a9JXlaOGaHNrdT+nw7/O6EYKlT4prEFHHVoNGGPltR1poq8H1aoq2d/yYvgBG2jgLPvChHTmbgJQpIHkNeKoyzqCZ6QHQ3yx389aXr9ImrbBUyfh3fV+xDxi3H49iC3BXUcp5hF8NfFhx9+Ilt52GIh9LfP+3f/mBFTtoi84EWPVPZjX4QHvRQwJxGX1cVGGdCw5VjyP3g8GzCV5CVWEtWntDW0AYxucn+xO9BtnJ3u3h5QlKxK3gK9ysxBXYhneKsrU3sgfbmrEIf61qMDHYrmR7ut7gEoa7K0gV7awvmmaM53X1xSOCaCdDdUjhufPC6H/9NZg32kQQ0MLqy72mbtsDW4dB6YDZHYcg4+U+kYoY3CGIuLs3vouzJphOhDzjpuY6B/QQUZrrlhdp6E5RAfk903EatpCDd40fXArd31xTAjYjxKb+e6LkjFwH1F6cfDkozoZ0mIgwI5V25ltaZbBv6ZYXrIL72/kmNw/+bEUlseqYsFhW1vdZawLykbylFeO0Dim+3C+IuX+J7lQ36dkOW9Z2mbcnmFxtE3jlMyDxF7LeLp5wLKlL0qksT5FzSUt+bQIaHUYg4/cQGNhxeAMvwkglVupq4nd82CQTCSl5xVJpPXgXgaP4pxUi+Bzc+WjBHn0j0HYUMVst1GGrBeaLujuaXFjULYifsvxIGYAodQUA+czS7YH49sTIHU9PtO/WSYJvLGKI/FLS8T80lHxFfZT5uAO//xImgwASigzzzBpMLRcH0ElCleIqHeSZ+GpFRCLVtzTndcWzfOFsmMzUYJGwTRX0CBpU5rLCwC95S6ykm4CDBRfT4+yCBAtN/+nAOqY4CAZlbJIcoz1P+YKyJGV1Vpibl8Se9wWPBoNLzN45mTaharTRsDClrr4Cswa5TSA0FiqhT0AYVPK0U3dUoN9428CsyaGvZqljoBbHYeQltLzmO4C/C63K/zGGoyNF/TUGm/J+xVUtggpmVHujENnyJOc5rmJdEYguA6AxDtVxI4tsEpaMfiHrAtJGjO9t1yEx57gHir6mH5FcaxZDtOEn9uIa0QzbAVvGAVwil8AdpEF1ySADitYymjbUPhEeZEVe56WLR9QQxyi4vmd4d1RLFwLDjMucpMGrsHiZvHejcB7sz42O+nF7cADAmOEMnFt47RmyIdTwVdnemxF40OMG+WM1fl252OBfTCcdAh5Eg62+5MY4bwlR7qxEnXi1hipyh8+e2R3oouxhXurG3ObEaEdWVwQYRDNwKLiT53wiorG3KA/LOl4ZpUcxPKrSgoO98YuWBnU58bKIikVo2ubbGM53oU4znzhlum2ily2OvQSXNV1WtXQrUbfB9vJJ/Sy8/ZTWp2SGzU87WaNXSPplZwZrZtMmVAXDzu2XVdBuhPhnkGT0984doMCQsY8jA+wH7GwHlw/GKA8rS0XChGjncwkvlttiNM3TS9ECv85C2G/spBZBmhvtlk8U0K0VSgxyS4ugeyV9BD2JulnuYM/QsTxCF9ptJEdl9TMqBZUpSM3JzPi8RNtGCYoUDGVmvvUQ4HOwAB4LzoL6U/Z3Owh/jtqNr/vlmigN5rp4L15tGWLFTw+Jh8tLTjkyDozkRf3HLMn4aXK3qn8/tXfB/UYQi03DholxJSCYTPZMvyHWOo+vmb4TGyzTNAIhGx4J3bKl2rteSuxvO6AqoSjFN7n2AE7AfSFRQmgIRfOJgb8PxB9BpEDzZ1FSo4cq5XR+MhMpzoZgjd/bjGUUYrp76N3njnRCHJ3ANLmWDZPG8aAgkOZFRv0j7hNbW5XSlQae5iv26MheGjeBCk9sPhyvswzYckJ02zVhCpO/9Gp2/QYwSkrLAbeO8+GQAX5o4+KUfatNK+oqltGkHCNZtGYqBnTbFUFEaG1NuwBc+NGb1//v9d4BgtsjKiF/EWnLIHaZnUNlR8/BfqiBV3Pzo7hWBLvTNDu1WptWYclSchMO5mb3shhUrXIgF5Dz4JgP4/c3iQPEk5S6wOS0iPlYqoZ+tUa4j6iqFQXezbwOjW9QqwUPO6V2GdqzsvViklt9ZITt3+NCW622ETBub8eEUSe9WyDdCUIgYdiptHSfcu5H3zJafVQAiwphiYpyME923IBYeW56Az4B8fkgArBW73OHjzA5wsxAdCL9uZYBxD605npL9EWQag6/F/GMi2vMWG6v2GGAkMOS7Wv6aTo50HmZGJkvDlOjGpH3rcZraEHCbNEeZbJAx1W9v1AFDngctfJAmK1Cpsd/zuNyZtHNFaSnx5AB4KeLVNXKy9iV3mOpTrxKF9sExZ9iDg/NdN0xLppEF0aFC4dE7Et0tX+bUv0eI7iIQO1JYkcGb1sgEf1bpCPPuMv3nK3FyjAeVqLU1/0Mnh2JsmGaDuPqz4GYpErRPP+cEQEy2ov+YWSJn3Un/BBtFYUCVZUqEUIEsbSOpRFAkEtQDPjsHqo0nWMd0pq2IIb3VRK2WkfHdHrRKwY4nhz2bIPoOIg2la88D3haSDOLmfX8RuEGEiLrJw7ZwUQ2yayj2DEYYi51Yeko73QvF9GPodMuza7d111+UMqaHdSd0ylS+wKGSkiQLyy12qJW3QHBXhQJJCC2Ic2tkgNpir44Ob0sz+gJ68beM/fqT5b7LHSu5dlxP6Ltn9xmgru+0692MT8Z/mKrvgGmeMmxTcNxtI5tTr2sQC757d1rfsAZMAr7/SQ0YqGmhf9QfPlE5hlSytkk1V22pgXZJSwPBLyQTXeyFmruxUPKIhycFjKypdrR8ayo5j2LEafZ8N5RX6SpjdXTQtCHfU7IKwUe6pNVZ6Eg4Fmc/+s+Q0ugQnsGCEBa7/+qvvWaqsF7A1hi/zNSH7KuSdwGQf00ue6z4pqqG5bEZYmQsgXFodlfvSS+20Lzcc+9khY2dLlhPGKDbfNITFFIdgSUXLvdONyGY/7YVFZr7/6e3xNi7//Nvfaf0p7OeOMcvKGvf0XWHpQg1CfxY5QKZSYcznxT19u5rS0aj9myReQvSCLItP0Eepc/DcQNqnA3XvoE18lCHj85dw7grr3Jsr2VDilLqB0CE2TKXO9Hi6ORfLH2IL+MnArm6ifKIUgP9XK/lsQsEzr11DacA5gdMnmGQ4IMLnQbEibgyTLxjI94I7qRtRmUYzQhIKA46ZVnneA0g0wXAHtya0bJZBdMJ4sMEzclPBq7Ifp/OrnEK3O/GyGBLRy5cD2HzhGsNDlvcxYo0CddqotKii5TDJNy9aI1UnO5s+EjgttazjrbUVXfoc+zXd1ts8rrYM26+KZ/FlZrLStP/9fubqAyX7vvcPh8//OrvzF6PHFV5dKjTk+VOThf5/A0M0gv0YOHCAg2lCbnM6afHtCuCt0KRBBVpbrqKLXAPQyMyVKlt/GcfbugMJg9Iib2G0eP8H5k2ioE+oLJVrO7+cG9jebh4Gr/t6Bl3/KqWaWlJ6PGoxayRN2NnvytyPYwH86GA8miOu0k2zU2MB4dJNoC09Lu6NUf6WsmpPT/RGp7DmRDm5XTu2DVANllhnAMfszOtKSdmlyl2oGi2cQuDXQ7/p/frwlUbfes28DotlLzGSzewuKkNaO6p/QTO5j7wO1MUGwpk9PlUDaiJJZkNENtLJB5OTX5nYJl2u4S3g9htM3kl0Hox0jnPifUSSE73GnEn/t7e8V3ZDC1BLHErW5w0VbwH5cMJMwMnUPYhyXrqBpDkJdmE2nHs6z9SshITsYwZVAoCjyOCw04LSFKaDUPgNruZRAhZl5khc2oje4hit0RHqvNW2j2R/rWteFpSzvZlmfQlj++fBdbSSmTL6leExXqv3DUlcjoihai6HjtB+jYDfmDWXFLuptG9LIP+PubidFQmjiAZDFMyKwpUTlhn1zbF0d9kzAdRC5BiZqOmBs2pRr69XUnsVvZYNAvp/jF64bZOcf+Nlp1OItefwb8zpdNCN4xm93O2SCfO+jc//LXhZiwyIFKcbFqLwjGXQc2fRl8FMKH/6Q7Fa2K3n+Jn6X9OORZngTqKTocmYYVRjazp/JfwTWdRolEoGqzzqzIyJgUYjlIc6lc9gdcK76otze2QC/Fwe/PyNLC9OeYeIouGZoKm3wu+YmOddNtSA37h1WwBwnNTedr2K1ETvky+Pug3T4vIrAfzyyKuYQSOeVWRLNrMgTElwKWEV6vxLLxfdXXHwnRfQMDDqYkY+iuY5WcsmIluutbVL+FPrgFhNV9gPoolDUJc6lszHT6FdIVy/Hf3PidzUVTL7tgcBj3wz56xFYuHddmlEGUdUctN1RNoJfBn3socfSYTXcDa3k3WNROojixo5PheqdqafeMkWP1UsF/q9cdTqq4lFJCCeHXe3emQEa7JWqDqYWFbwKwu2PVLx8RY8dXLALgvHUNG1KG3R2JpUCOkQqrikWvOcaicmKMesrFczqUGOw0P4qqk+gF9pNVAL0TAlWAGIOMQn+hlc5Uso5eaPXv7sUKoKYfwcDpTOE8LWCyxCA7w4hGpi2p2UIji0m8hJPtyRxqGv6/L4x08wDnByGjERfuahqKzqBAKIutv7f0DR6z3pnfihYnKBF3BDam0Yt7oqkvSZ9Q7hNOe5D27Zl/pp8Dq1hzQw0tuY2fV8EBJXaT7kHa4YK4dM+VvgxxaTmYzYsQzaoQj3XwD5W0ECDeMeua/7nGB6DKK/Oqf6eyrttS0g1Pns5u4+QvrJ2ZS5sicyUdZ5xO3p0A1SHaEV70Zlsqom7bTcPv7eiWZl607wwHL3LDnaKPg2frcPqnZHrRLVM0UAxM68nz4V+b59DmpjYUQigA2aSxnei6/WvHrjWb4f6a1krdiCaPaQkNEmjX8TMSG82jh8rgqUy4zmPGaOtpmgT7kfCRz1nDyoWXyRa+tT5IqO3R2iyxhawnpCT307st3bf1R2LH01R4N6HZub1K6js8FbcWo0Z/ytp5Ig0Jl70o256BJ+reL+hqE/g7SgRgvyoC+lskauAniV7tl6+hAh0wogHSy7t0Yqjq/PPoJChC2UXGthaqwfofh94E8cecW/o3JQ6yG7QpiGlPAkq/RidI8volCe/gY6eTt3lx0iyOHfoW6SL31yYEdFM9VAwwNGA2alljRxv5NlnFHH0d7e8vgSUjW1RJ86CNs68ZnNoX3dAuEqbXGIDgvpAkFp+J1xLcqtGqMvXXO5Jwmenm1fscMhirrJd/aYtnq8B1wLYpEBhW/KK/2KFNMzrgEr/CVbGFcMf5uglCSgKUeC6E1QlvQoOXX5T/Jh7KzOGteZmJHUgfl/D9u9msqPUxu3kslRsmWbOAPM0KpdGTCKh7hnxUdY8OgOsiryBGpU/IxL9g0BtsD9cK/sVglYKU60R2YJNG2LpuiTKVwuPh0rmygYfxgfskTPXPv7WzNxp87SgsSgnOzkuFxbggnJ+yDnmvXsVs9o5eFdUAjs9ocYW0gZ8NeYr8dv2Y0xFJ0Dp9Rm1Bsq51ec3CE7Fwn3oDy4M+jSoFxkQ2wJXmAFBt+UwXIKDpg+2KXnHkhtTavv28r/1CevogyAmkO7hS593naCneY9UlL0cnKsg8MPZfPT1LtglEEGt647x74GFkeK8Cf4rydLDbv5xDx53yWbXWRk7jHfBoXFRcWIwiyS1l/vLOLjTdm4ll3kbTDgoxAkUeEVBh52IXTAiRPt71rIrn3q0cfwxe0tdlZIJSzT7AjpHjAgTYgWetvcFP5weKqafCSChJ74xdWWJsZSFGKZSZxDPdfxk4fmQkXBLHaMEZK51tnt4RfB2bUcgqWZ99EyQeo/cZb7lpg25hP8mZRfuheL2g42OsUPXmoPQgjlDlTS+AzyqCqZ4xCSs+c0CKP6nKLeUjppi2AwSCgYXIP02JoybO8SQbwlMFgDXuY/o/vP4+AYT7z63wstdwSRz6gFOD3mFs/whmqibq9uZwH/AiY6C3+rENUfLz8Wc10oV8eaFzbg+creC3dB6XIPLE6WeO4z34Yp366u4FjgicTYZgGKfdciI7mPGhlheUxonIMs6d+wG3Wqg40b625Ijt81ulQlSlnUjrIT1Z8OakFZX4pQExBuWA3aWlSzZ6l5h7QDspvnKuwqLAB9V81pmUWSn2Sd77qSRrga1QpF99R+Ml73cFZeL0r0CGvglYvcskx2/BSO2ciI6xfgcUnfhDEJ9Ox3v/5fV+SIbX7gePCATzrlFdniB0sLpRQDgLm/wNdd+hm909AB0rj+7Re2mOglyPjr2K9/DCvlYPgRYaEydqgCS38/etNR9SkfpbJ7X/ie5wKMGfHzv+n8QMPUYe+43aC44RLjF6zhRFXh6z58CC+fMA9SaY10hdWYi0WlwoPcrFKMHvTd98tUbAZM/KDOU0RzsEClt1hsVB/2+7rD9zSoSUrlGkwIqrf6AUum0nc8bzvHHikHe7Lq/CE4EXWrearSEpeq5jHISuXEAhCympOb3uS3WGe/V5wKxfmv3p3HlbaYMZAuqbOxhxTqST//nBXOSsAs+1EC4IDjBEDzZWcu96gZojKGR6rJu88s+NSKpMr1/g9tFOWrnrHj4xJpDbj2yhd6LL2SR6z6fUumc1mh6LZLh3EI2lIrVpzJYSovmwvSZTvILrQnMf2ggnT7I4iPHU+ElRuVRE3qoFCfrmGNICLvV4p+TSxYPNQDfqWnoyMeIC8dR/Qy0gsDr9yvbJtbp+exE7VbNCCSEDcsyVfxU7t0YFRBFyAak8FjuneI4DeCdqn1pVzy8AjvhJVORqyGWsGg+gJh0ow+B9onMi3LAvF0k96+YfW6Fnvm+KPD0V4x8wcvEw9axGz2q6VhhkQtzygBsN1WwhX5FZLhDvCI/kY4TwntPGsqgscnX1xZrqbTRvmk59e3Ka9le3f9TfX+Zv+nNxqbi4Jmmur5XOWl1uduY50fC2wRXS4C0dwlvd1Kmlwczibd6MyX8qekVDUJdz6jL7gv9OCcLgObaazr30TjHcswiwcoQmLZw4/FPW8mmIqSDsT5hLV5V/YoF+JhFsLnpP7m0IXMgRpwH4aZDqlUxnSVS5wCIVi564YAio/gIysUbPmlmHpYhW/43yZYV2G2s7nbIjBzEe1CI7OzewBCI7kxbRpUobXJMaC0JJmKFat9aMJKqlJLNo6gKZG+IJsx6oiuii/yuq3tVkG+p+Kc9Le7lPlqAFpDmWKzWSULlWWwBI104WvwrmU1yB6v4IU3TNTTJ8CDlq1GmfWDRGXI/CsmHURyKhUY/oz4A3u4L1uAA+sjPLR6T8+OE9yYnzcbAJo1Osnqlge7jjmb4H3uLJLz5wGK9Qg9CLeJSE7kze1ao0LjaBmSdsFRhAOgMVVVdbnwmhXWog5WKRmIliOtoraLvSm7JIWEWYhFPyrxGEobZCOKoGymuKWMFwjAukzma0O/Im4gCJ5DAOXArVzW2iaytHUZ/v7hrsZTCmcLPdX5v16h7N9n9iTr2lyNookPTxTfwyM5G7D6Rxhfred8qeXtHthDeCLobY3f3eWlGI9S3LFxr7j9hgYufvQS3jD3RipsSAWz2/rrHUpSPiAk4DFlgsHi4rlXaEvxfN4cAZRQCIbR+uVZT3LQAZpCe0ws/FGEeu3HnXHgcHhDPZ/fsrk6KQVO8ITv5IoHUFJXhRqaUceWhVPGmMZ8pFIA3cUgooDXV2jJvPP2pypsUoXTSNAXY3Oy/jorCYxaaX9u5MdjIoaP47nWvy+hiob+41grNYDGtj+Xyvrb9KBZj9Wqw0QFTaL0cJVtWC3GtBDSYKNvZO3CuoUNU2OdFHj8nV2aTBT4+s2c1xMgi6d0F9Qbhq/CPwsKB/q+QFo42kqE41jaZ+3y2Cdmmzp8b1TY1B0wa+4f7/smCaGHWQ4UCtdykrN3Nr6DFINKAI7fjfTM+BRQP4fRi9D4XRE8dA3RZFv34XOZ+mGU22pp+m/mIYdk4jFYwDq0jzKxfgMnOpu5fl1GFleDFeiBpwARlKHEZ2wMOjQJnytcvC4UDAGktFEfibOcSEDhjQHyhMB2oLNFB82/pLgn7aNw4CB9U4GJV4iQpACsO7snmo4o98b+k5IYpPxpqL4KAZg6Q+WMaKApxFYVEGi3a+tel4ClWOkr+wj35uonud58jgooWANtATtpU1wIT8FEKP2RoKWGCXp08NN4Qtlvyr4RnlnM3VB6GUaGICV0fRV441aix5kS5akCAxCm/89tYGIii1JK9UygUBG81SWePxxgOoy48wjQrRo601X2b5QL9dY27+6kTaXxdMBoC2olGw/vCWk6y6BBXRz4wzKEh+dtmDpB1pJpuvypi8k3i/ihAFoykQ5cnv/9OM0BhSaNeuLSFBKpPrZV/JrW1gADi7fFF+Z8ymg2ayeYlztLWashqTc12sDaG3N/Lg11olxhoQAb0bzkyh1Ukj0NOO3fOD8eBl/nrMODo1EC5E3xq6fLJxrPfgBKzqAyd15IFlBe8wxHVA7ij/GE2yzu4vlNvw+VR4Kn6T3Dk1r9tRWDkDRwYI6Rbm4LZyWACUUWTpkPcCAeUtFmLx+ePjo2YBU3Ov+TofWPrv8jeNF8e29+ilXucTZiWRmyNEpOVcNBSQqpX6EmyxL1I1/a8IX5YX3ya3ytmjeWBiZBZjUFBVfWdXaMME2z+RkWJYVSckrnL8Pkrbr3arFVZEmlaZfAEg1XKbc4rdSGgUOCOTzQ5fn8bTL6nnAUk1ghSr5s56jLn1epoPeabZeEK+lF1tZf+Hbj1soV4WVcaC6AGnMMpg2G8mwpXs/EKrEQ2waN6mLWXtZfIRqOQNOYGq+d7aZoHKLwLOnR90KwgWlBLUlhKCTxqYcBJytbormlCVd0w4IwhacW2vhZIys5hQ0hg0N4YECWsC/mqyLMlxoqCRx2jPE58XNJsW5805kNLn6ozdNA+66UJ/VnXa3gAoyEBaMEnRv2BL6ZS4vghaUhd+JK8Bqmy6Di5CfxZYc6CcWx+CGl6MwOnvVVMFD+g8WBiNG8O/TJNbGP+7Ny/2tN87GrfKSaT/9tN6/kJhPK4LH0pUT96WRFSnAHq/j+o+OAAAA"}));

/* STARDUSTLC_UPDATE_CLIENT_BODY_END */
})();

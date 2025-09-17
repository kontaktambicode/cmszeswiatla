/*!
 * LightTip — lightweight tooltip/popover manager
 * Version: 1.1.0
 * Requires: L >= 1.1.3
 */
(function (global) {
  'use strict';
  const L = global.L;

  const CLS = {
    base: 'light-tip',
    visible: 'light-tip--visible',
    arrow: 'light-tip-arrow',
    inner: 'light-tip-inner'
  };

  const isStr = v => typeof v === 'string';
  const isFn = v => typeof v === 'function';

  const parsePlacement = (p) => {
    if (!p) return { side: 'top', align: 'center', auto: false };
    const auto = p.startsWith('auto-');
    const spec = auto ? p.slice(5) : p;
    const [side, align] = spec.split('-');
    return { side: side || 'top', align: align || 'center', auto };
  };

  const REG = new Set();
  const BY_ANCHOR = new WeakMap();

  function scrollableAncestors(el) {
    const out = [];
    let p = el && el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) || /(auto|scroll|overlay)/.test(cs.overflowX)) out.push(p);
      p = p.parentElement;
    }
    return out;
  }

  function computePosition(anchorRect, tipSize, placement, offset) {
    const { side, align } = placement;
    const o = offset|0;
    let left = 0, top = 0;

    if (side === 'right') {
      left = anchorRect.right + o;
      if (align === 'start') top = anchorRect.top;
      else if (align === 'end') top = anchorRect.bottom - tipSize.height;
      else top = anchorRect.top + (anchorRect.height - tipSize.height)/2;
    } else if (side === 'left') {
      left = anchorRect.left - tipSize.width - o;
      if (align === 'start') top = anchorRect.top;
      else if (align === 'end') top = anchorRect.bottom - tipSize.height;
      else top = anchorRect.top + (anchorRect.height - tipSize.height)/2;
    } else if (side === 'top') {
      top = anchorRect.top - tipSize.height - o;
      if (align === 'start') left = anchorRect.left;
      else if (align === 'end') left = anchorRect.right - tipSize.width;
      else left = anchorRect.left + (anchorRect.width - tipSize.width)/2;
    } else { // bottom
      top = anchorRect.bottom + o;
      if (align === 'start') left = anchorRect.left;
      else if (align === 'end') left = anchorRect.right - tipSize.width;
      else left = anchorRect.left + (anchorRect.width - tipSize.width)/2;
    }
    return { left: Math.round(left), top: Math.round(top) };
  }

  function fitsViewport(pos, tipSize, margin = 4) {
    const vw = L.viewport().width, vh = L.viewport().height;
    return pos.left >= margin &&
           pos.top >= margin &&
           (pos.left + tipSize.width) <= (vw - margin) &&
           (pos.top + tipSize.height) <= (vh - margin);
  }

  function fallbackPlacements(preferred) {
    const { side, align } = preferred;
    const aligns = ['start','center','end'];
    const others = aligns.filter(a => a !== align).map(a => ({ side, align: a, auto: true }));
    const oppositeSide = { top:'bottom', bottom:'top', left:'right', right:'left' }[side];
    const opp = [{ side: oppositeSide, align, auto: true }];
    const perpendicular = side === 'top' || side === 'bottom'
      ? [{ side:'left', align:'center', auto: true }, { side:'right', align:'center', auto: true }]
      : [{ side:'top', align:'center', auto: true }, { side:'bottom', align:'center', auto: true }];
    return [preferred, ...others, ...opp, ...perpendicular];
  }

  // Error codes & logger
  const ERR = {
    E_NO_ELEMENT: 'Anchor element not found',
    E_EMPTY_CONTENT: 'Empty tooltip content',
    E_ALREADY_OPEN: 'Tooltip already open',
    E_NOT_OPEN: 'Tooltip not open'
  };
  try { if (L && L.errors && typeof L.errors.register === 'function') L.errors.register('LightTip', ERR); } catch(_) {}
  function mkLogger(ctx) {
    const p = '[LightTip' + (ctx ? ':'+ctx : '') + ']';
    return {
      info: (...a) => { try { L && L.log && L.log.info && L.log.info(p, ...a); } catch(_) {} },
      warn: (...a) => { try { L && L.log && L.log.warn && L.log.warn(p, ...a); } catch(_) {} },
      danger: (...a) => { try { L && L.log && L.log.danger && L.log.danger(p, ...a); } catch(_) {} },
    };
  }

  class LightTip {
    static version = '1.1.0';

    static attach(anchorEl, options = {}) {
      const el = typeof anchorEl === 'string' ? document.querySelector(anchorEl) : anchorEl;
      L.assert(!!el, 'E_NO_ELEMENT', { id: String(anchorEl).replace(/^#/,'')||'(node)', cls: 'LightTip' });
      if (BY_ANCHOR.has(el)) {
        const inst = BY_ANCHOR.get(el);
        inst.updateOptions(options);
        return inst;
      }
      const tip = new LightTip(el, options);
      BY_ANCHOR.set(el, tip);
      REG.add(tip);
      return tip;
    }

    static hideAll(predicate) { for (const t of Array.from(REG)) if (!predicate || predicate(t)) t.hide(); }
    static hideScope(root) {
      const rootEl = typeof root === 'string' ? document.querySelector(root) : root;
      for (const t of Array.from(REG)) if (rootEl && t.anchor && rootEl.contains(t.anchor)) t.hide();
    }
    static reflowAll() { for (const t of Array.from(REG)) t.update(); }

    constructor(anchor, options) {
      this.anchor = anchor;
      this.opts = L.extend({
        placement: 'auto-top-center',
        offset: 8,
        content: '',
        closeOnBodyClick: true,
        onShow: null, onShown: null, onHide: null, onHidden: null,
        owner: null, scope: null,
        onScroll: 'hide',
        scrollScope: 'any',
        onResize: 'hide',
        trapFocus: false,
        scrollbar: false
      }, options || {});

      this._open = false;
      this._tipEl = null; this._inner = null; this._arrow = null;
      this._scrollUnsubs = [];
      this._bodyClickOff = null;
      this._resizeOff = null;
      this._keyOff = null;
      this._sb = null;

      this._log = mkLogger((anchor && anchor.id) ? anchor.id : 'node');
      this._log.info('construct', { version: LightTip.version });

      this._moOff = L.observe.mutation(document.body, { childList:true, subtree:true }, () => {
        if (!L.dom.inDocument(this.anchor)) this.destroy();
      });
    }

    updateOptions(next) { this.opts = L.extend({}, this.opts, next || {}); if (this._open) this.update(); }
    isOpen() { return this._open; }

    setContent(v) {
      if (!this._inner) return;
      L.dom.clear(this._inner);
      if (v instanceof Node) { this._inner.appendChild(v); return; }
      if (isStr(v) && v.trim().startsWith('<')) { this._inner.appendChild(L.htmlSafe(v)); return; }
      this._inner.appendChild(document.createTextNode(String(v==null?'':v)));
    }

    _ensureDom() {
      if (this._tipEl) return;
      const tip = document.createElement('div');
      tip.className = CLS.base;
      tip.style.position = 'fixed';
      tip.style.left = '-9999px'; tip.style.top = '-9999px';
      tip.style.zIndex = String(L.z.next());
      const inner = document.createElement('div'); inner.className = CLS.inner;
      const arrow = document.createElement('div'); arrow.className = CLS.arrow;
      tip.appendChild(arrow); tip.appendChild(inner);
      document.body.appendChild(tip);
      this._tipEl = tip; this._inner = inner; this._arrow = arrow;
      try { this._log.info('initDOM'); } catch(_){}
      this.setContent(this.opts.content);
    }

    _measure() {
      const el = this._tipEl;
      el.style.visibility = 'hidden';
      el.style.left = '-9999px'; el.style.top = '-9999px';
      el.classList.add(CLS.visible);
      const r = el.getBoundingClientRect();
      const size = { width: Math.ceil(r.width), height: Math.ceil(r.height) };
      el.classList.remove(CLS.visible);
      el.style.visibility = '';
      return size;
    }

    _applyPosition(pos, placement) {
      const el = this._tipEl;
      el.style.left = Math.round(pos.left) + 'px';
      el.style.top = Math.round(pos.top) + 'px';
      el.setAttribute('data-placement', placement.side + '-' + placement.align);
    }

    _positionWithArrow(anchorRect) {
      const size = this._measure();
      const pref = parsePlacement(this.opts.placement);
      let chosen = pref;
      let pos = computePosition(anchorRect, size, chosen, this.opts.offset);
      if (pref.auto) {
        for (const p of fallbackPlacements(pref)) {
          const testPos = computePosition(anchorRect, size, p, this.opts.offset);
          if (fitsViewport(testPos, size)) { chosen = p; pos = testPos; break; }
        }
      }
      this._applyPosition(pos, chosen);
      this._positionArrow(anchorRect, size, chosen, pos);
    }

    _positionArrow(anchorRect, tipSize, placement, tipPos) {
      if (!this._arrow) return;
      const side = placement.side;
      const isHorizontal = (side === 'top' || side === 'bottom');
      const anchorCenter = isHorizontal
        ? (anchorRect.left + anchorRect.width / 2)
        : (anchorRect.top + anchorRect.height / 2);
      const tipStart = isHorizontal ? tipPos.left : tipPos.top;
      let offset = anchorCenter - tipStart;
      const min = 8, max = (isHorizontal ? tipSize.width : tipSize.height) - 8;
      offset = Math.max(min, Math.min(max, offset));
      if (isHorizontal) { this._arrow.style.left = Math.round(offset) + 'px'; this._arrow.style.top = ''; }
      else { this._arrow.style.top = Math.round(offset) + 'px'; this._arrow.style.left = ''; }
      this._tipEl.setAttribute('data-side', side);
    }

    _bindScroll() {
      this._unbindScroll();
      const mode = this.opts.onScroll;
      if (mode === 'none') return;
      const targets = [];
      if (this.opts.scrollScope === 'window' || this.opts.scrollScope === 'any') targets.push(window);
      if (this.opts.scrollScope === 'ancestors' || this.opts.scrollScope === 'any') targets.push(...scrollableAncestors(this.anchor));
      const handler = mode === 'hide' ? () => this.hide() : () => this.update();
      const wrapped = (mode === 'reposition')
        ? (() => { let ticking = false; return () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; this.update(); }); }; })()
        : handler;
      targets.forEach(t => { const off = L.listenScroll(wrapped, t); this._scrollUnsubs.push(off); });
    }
    _unbindScroll() { while (this._scrollUnsubs.length) { try { const off = this._scrollUnsubs.pop(); off && off(); } catch(_){} } }

    _maybeInitScrollbar() {
      if (!this._inner) return;
      const opt = this.opts.scrollbar;
      if (!opt) { this._destroyScrollbar(); return; }
      const needX = this._inner.scrollWidth > this._inner.clientWidth;
      const needY = this._inner.scrollHeight > this._inner.clientHeight;
      const need = needX || needY;
      if (!need) { this._destroyScrollbar(); return; }
      if (this._sb && this._sb.update) { try { this._sb.update(); } catch(_){} return; }
      if (!global.LightScrollbar) return;
      const axis = (opt && opt.axis) ? opt.axis : (needX && needY ? 'xy' : (needY ? 'y' : 'x'));
      const autoHide = (opt && Object.prototype.hasOwnProperty.call(opt,'autoHide')) ? !!opt.autoHide : true;
      try { this._sb = new global.LightScrollbar(this._inner, { axis, autoHide }); } catch(_) {}
    }
    _destroyScrollbar() { if (this._sb && this._sb.destroy) { try { this._sb.destroy(); } catch(_){} } this._sb = null; }

    show() {
      try { this._log.info('show'); } catch(_){}
      if (this._open) return;
      LightTip.hideAll(t => t !== this);
      this._ensureDom();
      this._tipEl.style.zIndex = String(L.z.next());
      const anchorRect = this.anchor.getBoundingClientRect();
      this._positionWithArrow(anchorRect);
      this._tipEl.classList.add(CLS.visible);
      this._open = true;

      const onKey = (e) => {
        if (!this._open) return;
        if (e.key === 'Escape') { e.stopPropagation(); this.hide(); return; }
        if (this.opts.trapFocus && e.key === 'Tab') {
          const nodes = this._tipEl.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
          const list = Array.prototype.filter.call(nodes, el => !el.disabled && el.offsetParent !== null);
          if (list.length) {
            const first = list[0], last = list[list.length-1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          } else {
            e.preventDefault();
            if (!this._tipEl.hasAttribute('tabindex')) this._tipEl.setAttribute('tabindex','-1');
            this._tipEl.focus({ preventScroll: true });
          }
        }
      };
      document.addEventListener('keydown', onKey, true);
      this._keyOff = () => { document.removeEventListener('keydown', onKey, true); };

      if (this.opts.trapFocus) {
        if (!this._tipEl.hasAttribute('tabindex')) this._tipEl.setAttribute('tabindex','-1');
        this._tipEl.focus({ preventScroll: true });
      }

      if (this.opts.closeOnBodyClick) {
        const onBody = (e) => {
          if (!this._open) return;
          const t = e.target;
          if (this._tipEl.contains(t) || this.anchor.contains(t)) return;
          this.hide();
        };
        document.addEventListener('mousedown', onBody, true);
        document.addEventListener('touchstart', onBody, { passive: true, capture: true });
        this._bodyClickOff = () => {
          document.removeEventListener('mousedown', onBody, true);
          document.removeEventListener('touchstart', onBody, { capture: true });
        };
      }

      const offResize = L.listenResize(() => {
        if (this.opts.onResize === 'hide') this.hide(); else this.update();
      });
      this._resizeOff = offResize;

      this._bindScroll();
      this._maybeInitScrollbar();

      if (isFn(this.opts.onShow)) this.opts.onShow(this.anchor, this._tipEl);
      if (isFn(this.opts.onShown)) this.opts.onShown(this.anchor, this._tipEl);
    }

    hide() {
      try { this._log.info('hide'); } catch(_){}
      if (!this._open) return;
      if (isFn(this.opts.onHide)) this.opts.onHide(this.anchor, this._tipEl);
      this._open = false;
      this._tipEl.classList.remove(CLS.visible);
      this._unbindScroll();
      if (this._bodyClickOff) { try { this._bodyClickOff(); } catch(_){} this._bodyClickOff = null; }
      if (this._resizeOff) { try { this._resizeOff(); } catch(_){} this._resizeOff = null; }
      if (this._keyOff) { try { this._keyOff(); } catch(_){} this._keyOff = null; }
      this._destroyScrollbar();
      if (isFn(this.opts.onHidden)) this.opts.onHidden(this.anchor, this._tipEl);
    }

    toggle() { this.isOpen() ? this.hide() : this.show(); }

    update() {
      try { this._log.info('update'); } catch(_){}
      if (!this._tipEl || !this._open) return;
      const anchorRect = this.anchor.getBoundingClientRect();
      this._positionWithArrow(anchorRect);
      this._maybeInitScrollbar();
    }

    destroy() {
      try { this._log.info('destroy'); } catch(_){}
      this.hide();
      this._destroyScrollbar();
      if (this._tipEl && this._tipEl.parentNode) this._tipEl.parentNode.removeChild(this._tipEl);
      this._tipEl = this._inner = this._arrow = null;
      REG.delete(this);
      if (this.anchor && BY_ANCHOR.get(this.anchor) === this) BY_ANCHOR.delete(this.anchor);
      if (this._moOff) { try { this._moOff(); } catch(_){} this._moOff = null; }
      this.anchor = null;
    }
  }

  global.LightTip = LightTip;

})(typeof window !== 'undefined' ? window : this);

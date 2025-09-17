/*!
 * LightScrollbar — minimal custom scrollbar for a host element
 * Version: 1.1.0
 * Requires: L >= 1.1.3
 */
(function (global) {
  'use strict';
  const L = global.L;
  function px(n){ return n+'px'; }
  const CLS = {
    base:'light-scroll',
    hideNative:'light-scroll--hide-native',
    hasX:'light-scroll--has-x',
    hasY:'light-scroll--has-y',
    hidden:'light-hidden',
    trackX:'light-scroll-track-x',
    trackY:'light-scroll-track-y',
    gripX:'light-scroll-grip-x',
    gripY:'light-scroll-grip-y',
    dragging:'light-scroll--dragging'
  };

  // Error codes (english-only)
  const ERR = {
    E_NO_ELEMENT: 'Host element not found',
    E_ASSERT_FAILED: 'Assertion failed',
    E_ALREADY_DESTROYED: 'Instance already destroyed',
    E_DRAG_INACTIVE: 'No active drag state'
  };
  try { if (L && L.errors && typeof L.errors.register === 'function') L.errors.register('LightScrollbar', ERR); } catch(_) {}

  function mkLogger(ctx) {
    const p = '[LightScrollbar' + (ctx ? ':'+ctx : '') + ']';
    return {
      info: (...a) => { try { L && L.log && L.log.info && L.log.info(p, ...a); } catch(_) {} },
      warn: (...a) => { try { L && L.log && L.log.warn && L.log.warn(p, ...a); } catch(_) {} },
      danger: (...a) => { try { L && L.log && L.log.danger && L.log.danger(p, ...a); } catch(_) {} },
    };
  }

  class LightScrollbar {
    static version = '1.1.0';
    constructor(hostEl, options={}){
      L.assert(!!global.L, 'E_ASSERT_FAILED', 'LightScrollbar requires L');
      const el = typeof hostEl==='string' ? document.querySelector(hostEl) : hostEl;
      L.assert(!!el, 'E_NO_ELEMENT', { id:String(hostEl).replace(/^#/,'')||'(node)', cls:'LightScrollbar' });
      this.host = el;
      this.opts = L.extend({ axis:'xy', autoHide:true }, options);
      this._log = mkLogger((this.host && this.host.id) ? this.host.id : 'node');
      this._log.info('construct', { version: LightScrollbar.version, axis: this.opts.axis, autoHide: !!this.opts.autoHide });
      this._state = { hasX:false, hasY:false, dragging:null };
      this._cleanup = [];
      this._initDOM();
      this._bind();
      this.update();
    }

    _initDOM(){
      const h = this.host;
      h.classList.add(CLS.base, CLS.hideNative);
      // tracks + grips
      this.trackX = L.el('div', { class: CLS.trackX, 'aria-hidden':'true' }); this._log.info('initDOM');
      this.trackY = L.el('div', { class: CLS.trackY, 'aria-hidden':'true' });
      this.gripX  = L.el('div', { class: CLS.gripX,  'aria-hidden':'true', tabindex:'-1' });
      this.gripY  = L.el('div', { class: CLS.gripY,  'aria-hidden':'true', tabindex:'-1' });
      this.trackX.appendChild(this.gripX);
      this.trackY.appendChild(this.gripY);
      h.appendChild(this.trackX);
      h.appendChild(this.trackY);
    }

    _bind(){
      const h = this.host;
      // resize/orientation
      const unresize = L.listenResize(() => this.update());
      this._cleanup.push(unresize);
      // box/content changes
      const unro = L.observe.resize(h, () => this.update());
      this._cleanup.push(unro);
      // scroll sync
      const onScroll = () => this._syncFromHostScroll();
      L.on(h, 'scroll', onScroll, { passive:true });
      this._cleanup.push(() => L.off(h, 'scroll', onScroll));
      // drag grips
      const startDragX = (e)=>this._dragStart(e,'x');
      const startDragY = (e)=>this._dragStart(e,'y');
      L.on(this.gripX,'mousedown',startDragX);
      L.on(this.gripY,'mousedown',startDragY);
      L.on(this.gripX,'touchstart',startDragX,{ passive:false });
      L.on(this.gripY,'touchstart',startDragY,{ passive:false });
      this._cleanup.push(()=>{ L.off(this.gripX,'mousedown',startDragX); L.off(this.gripY,'mousedown',startDragY);
        L.off(this.gripX,'touchstart',startDragX); L.off(this.gripY,'touchstart',startDragY); });
      // click/tap track jump
      const onTrackX = (e)=>this._jumpTo(e,'x');
      const onTrackY = (e)=>this._jumpTo(e,'y');
      L.on(this.trackX,'mousedown',onTrackX);
      L.on(this.trackY,'mousedown',onTrackY);
      L.on(this.trackX,'touchstart',onTrackX,{ passive:false });
      L.on(this.trackY,'touchstart',onTrackY,{ passive:false });
      this._cleanup.push(()=>{ L.off(this.trackX,'mousedown',onTrackX); L.off(this.trackY,'mousedown',onTrackY);
        L.off(this.trackX,'touchstart',onTrackX); L.off(this.trackY,'touchstart',onTrackY); });
      // auto-destroy if host removed
      const unmo = L.observe.mutation(document.body, { childList: true, subtree: true }, () => {
        if (!L.dom.inDocument(h)) this.destroy();
      });
      this._cleanup.push(unmo);
    }

    _dragStart(e, axis){
      if (e.cancelable!==false) e.preventDefault();
      e.stopPropagation();
      const isX = axis==='x';
      const track = isX ? this.trackX : this.trackY;
      const grip  = isX ? this.gripX  : this.gripY;
      const rect = track.getBoundingClientRect();
      const gripRect = grip.getBoundingClientRect();
      const pt = (e.touches && e.touches[0]) || e;
      const startPos = isX ? pt.clientX : pt.clientY;
      const gripStart = isX ? (gripRect.left-rect.left) : (gripRect.top-rect.top);
      this._state.dragging = { axis, startPos, gripStart }; this._docDragHandlers = {}; this._log.info('drag:start', { axis });
      this.host.classList.add(CLS.dragging);

      const move = (ev)=>{
        const p = (ev.touches && ev.touches[0]) || ev;
        const pos = isX ? p.clientX : p.clientY;
        const delta = pos - this._state.dragging.startPos;
        this._scrollFromGrip(axis, this._state.dragging.gripStart + delta, rect, grip);
      };
      const up = ()=>{
        L.off(document,'mousemove',move); L.off(document,'mouseup',up);
        L.off(document,'touchmove',move); L.off(document,'touchend',up);
        this._state.dragging = null; this._docDragHandlers = null;
        this.host.classList.remove(CLS.dragging);
        this._log.info('drag:stop');
      };
      L.on(document,'mousemove',move);
      L.on(document,'mouseup',up);
      L.on(document,'touchmove',move,{ passive:false });
      L.on(document,'touchend',up);
      this._docDragHandlers.move = move; this._docDragHandlers.up = up;
    }

    _jumpTo(e, axis){
      if (e.target === (axis==='x'?this.gripX:this.gripY)) return;
      if (e.cancelable!==false) e.preventDefault();
      const isX = axis==='x';
      const track = isX ? this.trackX : this.trackY;
      const rect = track.getBoundingClientRect();
      const pt = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      const clickPos = isX ? (pt.clientX - rect.left) : (pt.clientY - rect.top);
      this._scrollFromGrip(axis, clickPos, rect, isX?this.gripX:this.gripY, { center:true });
    }

    _scrollFromGrip(axis, gripPos, trackRect, gripEl, opts={}){
      const isX = axis==='x', h=this.host;
      const gripSize = isX ? this._gripXSize() : this._gripYSize();
      const trackLen = isX ? trackRect.width : trackRect.height;
      const maxGripPos = Math.max(0, trackLen - gripSize);
      const clamped = L.clamp(gripPos - (opts.center? gripSize/2 : 0), 0, maxGripPos);
      const ratio = maxGripPos>0 ? clamped/maxGripPos : 0;
      if (isX) {
        const maxScroll = h.scrollWidth - h.clientWidth;
        h.scrollLeft = Math.round(ratio * maxScroll);
      } else {
        const maxScroll = h.scrollHeight - h.clientHeight;
        h.scrollTop = Math.round(ratio * maxScroll);
      }
      this._syncFromHostScroll();
    }

    _gripXSize(){ return parseFloat(getComputedStyle(this.gripX).width) || 40; }
    _gripYSize(){ return parseFloat(getComputedStyle(this.gripY).height) || 40; }

    _syncFromHostScroll(){
      const h = this.host;
      if (this._state.hasX){
        const rect = this.trackX.getBoundingClientRect();
        const trackLen = rect.width, gripSize = this._gripXSize();
        const maxGripPos = Math.max(0, trackLen - gripSize);
        const maxScroll = Math.max(1, h.scrollWidth - h.clientWidth);
        const pos = Math.round((h.scrollLeft / maxScroll) * maxGripPos);
        this.gripX.style.left = px(pos);
      }
      if (this._state.hasY){
        const rect = this.trackY.getBoundingClientRect();
        const trackLen = rect.height, gripSize = this._gripYSize();
        const maxGripPos = Math.max(0, trackLen - gripSize);
        const maxScroll = Math.max(1, h.scrollHeight - h.clientHeight);
        const pos = Math.round((h.scrollTop / maxScroll) * maxGripPos);
        this.gripY.style.top = px(pos);
      }
    }

    update(){
      const h=this.host, axis=this.opts.axis;
      const needX = (axis==='xy'||axis==='x') && (h.scrollWidth > h.clientWidth);
      const needY = (axis==='xy'||axis==='y') && (h.scrollHeight > h.clientHeight);
      this._state.hasX = !!needX; this._state.hasY = !!needY;
      h.classList.toggle(CLS.hasX, needX); h.classList.toggle(CLS.hasY, needY);
      if (this.opts.autoHide){
        this.trackX.classList.toggle(CLS.hidden, !needX);
        this.trackY.classList.toggle(CLS.hidden, !needY);
      }
      this._syncFromHostScroll();
      this._log.info('update', { hasX: this._state.hasX, hasY: this._state.hasY, scrollLeft: this.host.scrollLeft, scrollTop: this.host.scrollTop });
    }

    isActive(){ return this._state.hasX || this._state.hasY; }

    scrollTo({ left, top }){
      if (typeof left==='number') this.host.scrollLeft = left;
      if (typeof top==='number') this.host.scrollTop = top;
      this._syncFromHostScroll();
    }

    destroy(){
      if (!this.host) { try { this._log && this._log.warn && this._log.warn('destroy called on null host'); } catch(_){}; return; }
      // doc listeners if destroyed mid-drag
      if (this._docDragHandlers){
        try{
          L.off(document,'mousemove',this._docDragHandlers.move);
          L.off(document,'mouseup',this._docDragHandlers.up);
          L.off(document,'touchmove',this._docDragHandlers.move);
          L.off(document,'touchend',this._docDragHandlers.up);
        }catch(_){}
        this._docDragHandlers = null;
      }
      while (this._cleanup.length){ try{ const fn=this._cleanup.pop(); fn && fn(); }catch(_){ } }
      try{
        this.trackX && this.trackX.parentNode===this.host && this.host.removeChild(this.trackX);
        this.trackY && this.trackY.parentNode===this.host && this.host.removeChild(this.trackY);
      }catch(_){}
      this.host.classList.remove(CLS.base, CLS.hasX, CLS.hasY, CLS.dragging, CLS.hideNative);
      this._log.info('destroy');
      this.trackX=this.trackY=this.gripX=this.gripY=null;
      this.host=null;
    }
  }
  global.LightScrollbar = LightScrollbar;
})(typeof window!=='undefined' ? window : this);

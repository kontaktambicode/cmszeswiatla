/*!
 * L (Light Facade) — modern DOM/HTTP/util facade
 * Global: window.L
 * No legacy shims, no jQuery bridge, no i18n.
 * Version: 1.1.3
 */
(function (global) {
  'use strict';

  // ---------- utils (local) ----------
  const isStr = v => typeof v === 'string';
  const isFn = v => typeof v === 'function';
  const isArr = Array.isArray;
  const isObj = v => v !== null && typeof v === 'object';
  const isEl = v => v instanceof Element || v instanceof Document || v instanceof DocumentFragment;
  const isSVG = el => typeof SVGElement !== 'undefined' && el instanceof SVGElement;

  const toArray = v => (Array.from ? Array.from(v) : [].slice.call(v));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const now = () => Date.now();

  // structuredClone fallback
  const deepClone = (val) => {
    if (typeof structuredClone === 'function') return structuredClone(val);
    return JSON.parse(JSON.stringify(val));
  };

  const uid = (() => {
    let i = 0;
    return (prefix = 'l') => `${prefix}_${(++i).toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  })();

  // Safe HTML escaping
  const escapeHTML = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const unescapeHTML = (s) => String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&');

  // Path utils: "a.b[0].c"
  const pathToTokens = (path) => {
    if (!isStr(path)) return [];
    const tokens = [];
    path.replace(/\[(\d+)\]|([^[.\]]+)/g, (_, idx, key) => tokens.push(idx !== undefined ? Number(idx) : key));
    return tokens;
  };

  const getByPath = (obj, path, def) => {
    const tokens = isArr(path) ? path : pathToTokens(path);
    let cur = obj;
    for (let t of tokens) {
      if (cur == null) return def;
      cur = cur[t];
    }
    return cur === undefined ? def : cur;
  };

  const setByPath = (obj, path, val) => {
    const tokens = isArr(path) ? path : pathToTokens(path);
    if (!tokens.length) return obj;
    let cur = obj;
    for (let i = 0; i < tokens.length - 1; i++) {
      const t = tokens[i];
      if (!isObj(cur[t])) cur[t] = typeof tokens[i + 1] === 'number' ? [] : {};
      cur = cur[t];
    }
    cur[tokens[tokens.length - 1]] = val;
    return obj;
  };

  const hasByPath = (obj, path) => getByPath(obj, path, Symbol.for('undef')) !== Symbol.for('undef');

  // Extend (deep if first arg === true)
  const extend = (deep, target, ...sources) => {
    if (typeof deep !== 'boolean') {
      sources.unshift(target);
      target = deep;
      deep = false;
    }
    target = target || {};
    for (const src of sources) {
      if (!isObj(src)) continue;
      for (const k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        const sv = src[k];
        if (deep && (isArr(sv) || isObj(sv))) {
          const base = isArr(sv) ? [] : {};
          target[k] = extend(true, isObj(target[k]) ? target[k] : base, sv);
        } else {
          target[k] = sv;
        }
      }
    }
    return target;
  };

  // Debounce / Throttle
  const debounce = (fn, wait, opts = {}) => {
    let t, lastCall, lastInvoke;
    const leading = !!opts.leading;
    const trailing = opts.trailing !== false;
    const maxWait = typeof opts.maxWait === 'number' ? opts.maxWait : null;

    const invoke = (ctx, args) => {
      lastInvoke = now();
      return fn.apply(ctx, args);
    };

    const debounced = function (...args) {
      const ts = now();
      const shouldInvoke = lastCall === undefined || (ts - lastCall) >= wait || (maxWait != null && (ts - lastInvoke) >= maxWait);
      lastCall = ts;

      if (shouldInvoke && leading) {
        if (t) { clearTimeout(t); t = null; }
        return invoke(this, args);
      }

      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        if (trailing && (!leading || (maxWait != null && (now() - lastInvoke) >= maxWait))) {
          invoke(debounced, args);
        }
      }, wait);
    };

    debounced.cancel = () => { if (t) clearTimeout(t); t = null; lastCall = undefined; };
    return debounced;
  };

  const throttle = (fn, wait, opts = {}) => {
    let last = 0, timer = null, pendingArgs = null, pendingCtx = null;
    const leading = opts.leading !== false;
    const trailing = opts.trailing !== false;

    const invoke = () => {
      last = now();
      fn.apply(pendingCtx, pendingArgs);
      pendingArgs = pendingCtx = null;
    };

    return function (...args) {
      const ts = now();
      if (!last && !leading) last = ts;
      const remaining = wait - (ts - last);
      pendingArgs = args;
      pendingCtx = this;

      if (remaining <= 0 || remaining > wait) {
        if (timer) { clearTimeout(timer); timer = null; }
        invoke();
      } else if (!timer && trailing) {
        timer = setTimeout(() => {
          timer = null;
          if (trailing && pendingArgs) invoke();
        }, remaining);
      }
    };
  };

  // HTML parsing aware of context, inc. SVG
  const parseHTMLInContext = (html, contextEl) => {
    if (!isStr(html)) return [];
    html = html.trim();
    if (!html) return [];
    // SVG context
    if (isSVG(contextEl)) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${html}</svg>`, 'image/svg+xml');
      const nodes = [];
      doc.documentElement.childNodes.forEach(n => nodes.push(global.document.importNode(n, true)));
      return nodes;
    }
    // HTML context
    if (document.createRange && Range.prototype.createContextualFragment) {
      const range = document.createRange();
      // guard: if contextEl is Document, select body or documentElement
      const ctx = (contextEl && contextEl.nodeType === 9) ? (document.body || document.documentElement) : (contextEl || document.body);
      try { range.selectNode(ctx); } catch(e) { range.selectNode(document.body || document.documentElement); }
      const frag = range.createContextualFragment(html);
      return toArray(frag.childNodes);
    }
    // Fallback
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return toArray(tmp.childNodes);
  };

  // Insert helpers
  const insertNodes = (parent, nodes, mode) => {
    const list = isArr(nodes) ? nodes : [nodes];
    const frag = document.createDocumentFragment();
    list.forEach(n => frag.appendChild(isEl(n) ? n : document.createTextNode(String(n))));
    if (mode === 'append') parent.appendChild(frag);
    else if (mode === 'prepend') parent.insertBefore(frag, parent.firstChild);
  };

  // ---------- LSet (chainable wrapper) ----------
  function LSet(nodes) {
    this.length = 0;
    if (nodes && nodes.length) {
      for (let i = 0; i < nodes.length; i++) this[i] = nodes[i];
      this.length = nodes.length;
    }
  }
  LSet.prototype[Symbol.iterator] = function* () { for (let i = 0; i < this.length; i++) yield this[i]; };
  LSet.prototype.toArray = function () { return Array.prototype.slice.call(this); };
  LSet.prototype.each = function (fn) { for (let i = 0; i < this.length; i++) fn.call(this[i], i, this[i]); return this; };
  LSet.prototype.map = function (fn) { const out = []; for (let i = 0; i < this.length; i++) out.push(fn.call(this[i], this[i], i)); return out; };
  LSet.prototype.filter = function (selOrFn) {
    const out = [];
    if (isFn(selOrFn)) {
      for (let i = 0; i < this.length; i++) if (selOrFn.call(this[i], this[i], i)) out.push(this[i]);
    } else {
      for (let i = 0; i < this.length; i++) if (this[i].matches && this[i].matches(selOrFn)) out.push(this[i]);
    }
    return new LSet(out);
  };

  // Traversal
  LSet.prototype.find = function (sel) {
    const out = [];
    this.each((_, el) => out.push.apply(out, toArray(el.querySelectorAll(sel))));
    return new LSet(out);
  };
  LSet.prototype.closest = function (sel) {
    const out = [];
    this.each((_, el) => { const c = el.closest(sel); if (c) out.push(c); });
    return new LSet(out);
  };
  LSet.prototype.parents = function (sel) {
    const out = [];
    this.each((_, el) => {
      let p = el.parentElement;
      while (p) {
        if (!sel || p.matches(sel)) out.push(p);
        p = p.parentElement;
      }
    });
    return new LSet(out);
  };
  LSet.prototype.children = function (sel) {
    const out = [];
    this.each((_, el) => out.push.apply(out, toArray(el.children)));
    return sel ? new LSet(out.filter(n => n.matches && n.matches(sel))) : new LSet(out);
  };
  LSet.prototype.eq = function (n) { n = n < 0 ? this.length + n : n; return new LSet(this[n] ? [this[n]] : []); };
  LSet.prototype.first = function () { return this.eq(0); };
  LSet.prototype.last = function () { return this.eq(-1); };
  LSet.prototype.index = function (el) {
    if (!this.length) return -1;
    const parent = this[0].parentElement;
    const list = parent ? toArray(parent.children) : this.toArray();
    if (!el) return list.indexOf(this[0]);
    if (el instanceof LSet) el = el[0];
    return list.indexOf(el);
  };

  // Content / attrs
  LSet.prototype.html = function (val) {
    if (val === undefined) return this.length ? this[0].innerHTML : undefined;
    return this.each((_, el) => { el.innerHTML = String(val); });
  };
  LSet.prototype.text = function (val) {
    if (val === undefined) return this.length ? this[0].textContent : undefined;
    return this.each((_, el) => { el.textContent = String(val); });
  };
  LSet.prototype.val = function (val) {
    if (!this.length) return val === undefined ? undefined : this;
    const el = this[0];
    if (val === undefined) return el.value != null ? el.value : null;
    return this.each((_, node) => { if ('value' in node) node.value = val; });
  };
  LSet.prototype.attr = function (k, v) {
    if (v === undefined) {
      if (!this.length) return undefined;
      return this[0].getAttribute(k);
    }
    return this.each((_, el) => { if (v === null) el.removeAttribute(k); else el.setAttribute(k, String(v)); });
  };
  LSet.prototype.prop = function (k, v) {
    if (v === undefined) return this.length ? this[0][k] : undefined;
    return this.each((_, el) => { el[k] = v; });
  };
  LSet.prototype.data = function (k, v) {
    if (v === undefined) return this.length ? this[0].dataset[k] : undefined;
    return this.each((_, el) => { el.dataset[k] = v; });
  };

  // Classes / CSS
  LSet.prototype.addClass = function (c) { return this.each((_, el) => el.classList.add(...String(c).split(/\s+/))); };
  LSet.prototype.removeClass = function (c) { return this.each((_, el) => el.classList.remove(...String(c).split(/\s+/))); };
  LSet.prototype.toggleClass = function (c, state) {
    const classes = String(c).split(/\s+/);
    return this.each((_, el) => classes.forEach(cls => el.classList.toggle(cls, state)));
  };
  LSet.prototype.css = function (k, v) {
    if (v === undefined && isStr(k)) return this.length ? getComputedStyle(this[0])[k] : undefined;
    return this.each((_, el) => {
      if (isStr(k)) el.style[k] = v;
      else if (isObj(k)) for (const p in k) el.style[p] = k[p];
    });
  };

  // Visibility / structure
  LSet.prototype.show = function () { return this.each((_, el) => { el.style.display = ''; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }); };
  LSet.prototype.hide = function () { return this.each((_, el) => { el.style.display = 'none'; }); };
  LSet.prototype.toggle = function (state) { return this.each((_, el) => { const s = state != null ? !!state : getComputedStyle(el).display === 'none'; el.style.display = s ? '' : 'none'; }); };

  const asNodes = (input, ctx) => {
    if (input == null) return [];
    if (isEl(input)) return [input];
    if (input instanceof LSet) return input.toArray();
    if (isArr(input) || input instanceof NodeList) return toArray(input);
    if (isStr(input)) return parseHTMLInContext(input, ctx);
    return [document.createTextNode(String(input))];
  };

  LSet.prototype.append = function (content) {
    return this.each((_, el) => {
      const nodes = asNodes(content, el);
      insertNodes(el, nodes, 'append');
    });
  };
  LSet.prototype.prepend = function (content) {
    return this.each((_, el) => {
      const nodes = asNodes(content, el);
      insertNodes(el, nodes, 'prepend');
    });
  };
  LSet.prototype.before = function (content) {
    return this.each((_, el) => {
      if (!el.parentNode) return;
      const nodes = asNodes(content, el);
      nodes.forEach(n => el.parentNode.insertBefore(n, el));
    });
  };
  LSet.prototype.after = function (content) {
    return this.each((_, el) => {
      if (!el.parentNode) return;
      const nodes = asNodes(content, el);
      nodes.forEach(n => el.parentNode.insertBefore(n, el.nextSibling));
    });
  };
  LSet.prototype.remove = function () { return this.each((_, el) => el.parentNode && el.parentNode.removeChild(el)); };
  LSet.prototype.empty = function () { return this.each((_, el) => { while (el.firstChild) el.removeChild(el.firstChild); }); };

  // Measures / position
  LSet.prototype.width = function () { return this.length ? this[0].clientWidth : 0; };
  LSet.prototype.height = function () { return this.length ? this[0].clientHeight : 0; };
  LSet.prototype.outerWidth = function (includeMargin) {
    if (!this.length) return 0;
    const el = this[0], cs = getComputedStyle(el);
    let w = el.offsetWidth;
    if (includeMargin) w += parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
    return w;
  };
  LSet.prototype.outerHeight = function (includeMargin) {
    if (!this.length) return 0;
    const el = this[0], cs = getComputedStyle(el);
    let h = el.offsetHeight;
    if (includeMargin) h += parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    return h;
  };
  LSet.prototype.rect = function () { return this.length ? this[0].getBoundingClientRect() : null; };
  LSet.prototype.offset = function () {
    if (!this.length) return null;
    const r = this[0].getBoundingClientRect();
    return { top: r.top + window.pageYOffset, left: r.left + window.pageXOffset, width: r.width, height: r.height };
    };
  LSet.prototype.position = function () {
    if (!this.length) return null;
    const el = this[0];
    return { top: el.offsetTop, left: el.offsetLeft };
  };
  LSet.prototype.scrollTop = function (v) {
    if (!this.length) return 0;
    const el = this[0];
    if (v === undefined) return 'scrollTop' in el ? el.scrollTop : document.documentElement.scrollTop || document.body.scrollTop;
    if ('scrollTop' in el) el.scrollTop = v; else document.documentElement.scrollTop = document.body.scrollTop = v;
    return this;
  };
  LSet.prototype.scrollLeft = function (v) {
    if (!this.length) return 0;
    const el = this[0];
    if (v === undefined) return 'scrollLeft' in el ? el.scrollLeft : document.documentElement.scrollLeft || document.body.scrollLeft;
    if ('scrollLeft' in el) el.scrollLeft = v; else document.documentElement.scrollLeft = document.body.scrollLeft = v;
    return this;
  };

  // Events (delegation)
  const _events = new WeakMap(); // el -> Map(type -> Set({wrapped,orig,capture}))
  const _ensureMap = (el) => { if (!_events.has(el)) _events.set(el, new Map()); return _events.get(el); };

  const _wrapDelegate = (selector, handler) => function (e) {
    let target = e.target;
    while (target && target !== this) {
      if (target.matches && target.matches(selector)) {
        return handler.call(target, e);
      }
      target = target.parentElement;
    }
  };

  function on(root, type, selector, handler, opts) {
    if (isFn(selector)) { opts = handler; handler = selector; selector = null; }
    const finalHandler = selector ? _wrapDelegate(selector, handler) : handler;
    const capture = (opts === true) || (isObj(opts) && !!opts.capture);
    const map = _ensureMap(root);
    const key = type + (selector ? '::' + selector : '');
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add({ wrapped: finalHandler, orig: handler, capture });
    root.addEventListener(type, finalHandler, opts || false);
  }

  function off(root, type, selector, handler) {
    if (isFn(selector) && handler == null) { handler = selector; selector = null; }
    const map = _events.get(root);
    if (!map) return;
    const key = type ? type + (selector ? '::' + selector : '') : null;
    if (!type) {
      // remove all
      for (const [k, set] of map.entries()) {
        const baseType = k.split('::')[0];
        for (const rec of set) root.removeEventListener(baseType, rec.wrapped, rec.capture);
      }
      map.clear();
      return;
    }
    const set = map.get(key);
    if (!set) return;
    for (const rec of Array.from(set)) {
      if (!handler || rec.orig === handler || rec.wrapped === handler) {
        root.removeEventListener(type, rec.wrapped, rec.capture);
        set.delete(rec);
      }
    }
    if (!set.size) map.delete(key);
  }

  function once(root, type, selector, handler, opts) {
    if (isFn(selector)) { opts = handler; handler = selector; selector = null; }
    const ac = (opts && opts.signal) ? null : new AbortController();
    const options = extend({ once: true }, opts || {}, ac ? { signal: ac.signal } : {});
    const wrapped = selector ? _wrapDelegate(selector, handler) : handler;
    root.addEventListener(type, wrapped, options);
    return () => { try { (ac && ac.abort && ac.abort()); root.removeEventListener(type, wrapped, options); } catch(e){} };
  }

  LSet.prototype.on = function (type, selector, handler, opts) { this.each((_, el) => on(el, type, selector, handler, opts)); return this; };
  LSet.prototype.off = function (type, selector, handler) { this.each((_, el) => off(el, type, selector, handler)); return this; };
  LSet.prototype.once = function (type, selector, handler, opts) { this.each((_, el) => once(el, type, selector, handler, opts)); return this; };
  LSet.prototype.emit = function (type, detail) { return this.each((_, el) => el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))); };

  // ---------- L (selector) ----------
  function L(input, context) {
    if (isFn(input)) return L.ready(input);
    if (input == null) return new LSet([]);
    if (input instanceof LSet) return input;
    if (isEl(input)) return new LSet([input]);
    if (input instanceof NodeList || isArr(input)) return new LSet(toArray(input));
    if (isStr(input)) {
      const ctx = context ? (isStr(context) ? document.querySelector(context) : context) : document;
      if (!ctx) return new LSet([]);
      // CSS selector vs. HTML string
      if (input.trim().startsWith('<')) {
        const nodes = parseHTMLInContext(input, ctx);
        return new LSet(nodes);
      }
      return new LSet(toArray(ctx.querySelectorAll(input)));
    }
    return new LSet([]);
  }

  // static helpers
  L.version = '1.1.3';
  L.isL = v => v instanceof LSet;
  L.noConflict = () => { const prev = global.L; global.L = undefined; return prev; };
  L.ready = (fn) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(fn, 0);
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  };

  // ---------- Core utilities: URL, ENV, TIME, LOG, ASSERT, DOM ----------

  // Error codes (English)
  L.errors = {
    E_INVALID_ID: 'Invalid id "{{id}}"',
    E_NO_ELEMENT: 'No element found with id "{{id}}"',
    E_INSTANCE_EXISTS: 'Instance "{{cls}}" for #{{id}} already exists',
    E_ALREADY_DESTRUCTED: 'Instance "{{cls}}" for #{{id}} already destructed',
    E_DESTRUCT_IN_PROGRESS: 'Destruction already in progress for "{{cls}}" #{{id}}',
    E_NO_ROOT: 'Root element is required for "{{cls}}"',
    E_ASSERT_FAILED: 'Assertion failed: {{message}}'
  };

  // Class-scoped error registries
  L._errorsByNs = Object.create(null);
  L.registerErrors = function(namespace, map, { override = false } = {}) {
    if (!namespace || typeof namespace !== 'string') throw new Error('registerErrors: invalid namespace');
    if (!map || typeof map !== 'object') return;
    const ns = namespace.trim();
    const store = (L._errorsByNs[ns] || (L._errorsByNs[ns] = Object.create(null)));
    for (const k of Object.keys(map)) {
      if (!override && store[k]) throw new Error(`registerErrors: code ${ns}.${k} already exists`);
      store[k] = String(map[k]);
    }
    return Object.freeze(Object.assign({}, store));
  };

  // URL helpers
  L.url = {
    params() {
      const out = {};
      const usp = new URLSearchParams(window.location.search || '');
      for (const [k, v] of usp.entries()) {
        if (out[k] === undefined) out[k] = v;
        else if (Array.isArray(out[k])) out[k].push(v);
        else out[k] = [out[k], v];
      }
      return out;
    },
    get(name, def) {
      const usp = new URLSearchParams(window.location.search || '');
      return usp.has(name) ? usp.get(name) : def;
    }
  };

  // Runtime environment flags
  L.env = (() => {
    const store = Object.create(null);
    return {
      set(key, val) { store[key] = val; },
      get(key, def) { return key in store ? store[key] : def; }
    };
  })();

  // Time helpers
  L.time = {
    stamp() {
      const d = new Date();
      const pad = (n, w=2) => String(n).padStart(w, '0');
      const yyyy = d.getFullYear();
      const MM = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const HH = pad(d.getHours());
      const mm = pad(d.getMinutes());
      const ss = pad(d.getSeconds());
      const mmm = pad(d.getMilliseconds(), 3);
      return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${mmm}`;
    }
  };

  // Logging
  (function initLogging(){
    const LEVELS = { off: 0, danger: 1, warning: 2, info: 3 };
    let level = LEVELS.info;
    const urlLevel = (L.url.get('log') || '').toLowerCase();
    if (urlLevel && urlLevel in LEVELS) level = LEVELS[urlLevel];

    const state = { level, prefix: '' };

    const enabled = (lvl) => LEVELS[lvl] <= state.level && state.level !== LEVELS.off;
    const format = (lvl, args) => {
      const ts = L.time.stamp();
      const pref = state.prefix ? `[${state.prefix}]` : '';
      return [`${ts} [${lvl.toUpperCase()}]${pref}`, ...args];
    };

    const call = (lvl, arglist) => {
      if (!enabled(lvl)) return;
      const first = arglist[0];
      const args = (typeof first === 'function') ? [first()] : arglist;
      const out = format(lvl, args);
      const fn = lvl === 'danger' ? console.error : (lvl === 'warning' ? console.warn : console.info);
      try { fn.apply(console, out); } catch { console.log.apply(console, out); }
    };

    L.log = {
      configure(opts = {}) {
        if (opts.level) {
          const l = String(opts.level).toLowerCase();
          if (l in LEVELS) state.level = LEVELS[l];
        }
        if (opts.prefix !== undefined) state.prefix = String(opts.prefix || '');
      },
      level: () => Object.entries(LEVELS).find(([k,v]) => v === state.level)?.[0] || 'off',
      isEnabled(lvl) { return enabled(lvl); },
      info(...args) { call('info', args); },
      warn(...args) { call('warning', args); },
      danger(...args) { call('danger', args); }
    };

    L.log.LEVELS = LEVELS;
  })();

  // Assertions
  L.assert = function(cond, code, dataOrMessage) {
    if (cond) return;
    let tpl = '';
    if (code && typeof code === 'string' && code.includes('.')) {
      const ns = code.split('.')[0];
      const c = code.slice(ns.length + 1);
      tpl = (L._errorsByNs && L._errorsByNs[ns] && L._errorsByNs[ns][c]) || '';
    }
    if (!tpl) tpl = (L.errors && L.errors[code]) || '{{message}}';
    const data = (typeof dataOrMessage === 'object' && dataOrMessage !== null)
      ? dataOrMessage
      : { message: String(dataOrMessage || code || 'Assertion failed') };
    const msg = L.interpolate(tpl, data);
    const err = new Error(msg);
    err.code = code || 'E_ASSERT_FAILED';
    err.info = data;
    throw err;
  };

  // DOM helpers
  L.dom = {
    hasParent(el) { return !!(el && el.parentNode); },
    inDocument(el) { return !!(el && el.ownerDocument && el.ownerDocument.contains(el)); },
    clear(el) {
      if (!el) return;
      while (el.firstChild) el.removeChild(el.firstChild);
    }
  };

  // Viewport helper
  L.viewport = () => ({
    width: window.innerWidth || document.documentElement.clientWidth,
    height: window.innerHeight || document.documentElement.clientHeight
  });

  // Z-index generator for overlays
  L.z = (() => {
    let current = 1000;
    return {
      next(step = 1) { current += (typeof step === 'number' ? step : 1); return current; },
      peek() { return current; },
      set(v) { const n = Number(v); if (!isNaN(n)) current = n; return current; }
    };
  })();

  // DOM statics
  L.q = (sel, ctx) => {
    const ctxEl = ctx ? (isStr(ctx) ? document.querySelector(ctx) : ctx) : document;
    if (!ctxEl) return [];
    try { return toArray(ctxEl.querySelectorAll(sel)); } catch (_) { return []; }
  };
  L.exists = (sel, ctx) => L.q(sel, ctx).length > 0;
  L.el = (tag, attrs, children) => {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) (k === 'style' && isObj(attrs[k])) ? Object.assign(el.style, attrs[k]) : el.setAttribute(k, attrs[k]);
    if (children) L(el).append(children);
    return el;
  };
  L.frag = (...nodes) => {
    const f = document.createDocumentFragment();
    nodes.flat(Infinity).forEach(n => f.appendChild(isEl(n) ? n : document.createTextNode(String(n))));
    return f;
  };
  L.mount = (node, container) => { L(container).append(node); return node; };
  L.portal = (node, newContainer) => { L(newContainer).append(node); return node; };

  // Render
  L.render = (templateOrFn, data, target, mode = 'replace') => {
    let html = '';
    if (isFn(templateOrFn)) {
      html = String(templateOrFn(data || {}));
    } else if (isStr(templateOrFn)) {
      const isId = templateOrFn.trim().startsWith('#');
      const tpl = isId ? (document.querySelector(templateOrFn)?.innerHTML || '') : templateOrFn;
      html = L.interpolate(tpl, data || {});
    } else {
      throw new Error('L.render: invalid template');
    }
    const nodes = parseHTMLInContext(html, target || document.body);
    const $t = L(target);
    if (!$t.length) return nodes;
    if (mode === 'append') $t.append(nodes);
    else if (mode === 'prepend') $t.prepend(nodes);
    else if (mode === 'before') $t.before(nodes);
    else if (mode === 'after') $t.after(nodes);
    else { $t.empty().append(nodes); }
    return $t;
  };

  // Events statics
  L.on = on;
  L.off = off;
  L.once = once;
  L.emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  L.debounce = debounce;
  L.throttle = throttle;

  // Listeners
  L.listenResize = (handler) => {
    const wrapped = throttle(handler, 100);
    window.addEventListener('resize', wrapped, { passive: true });
    return () => window.removeEventListener('resize', wrapped);
  };
  L.listenScroll = (handler, root) => {
    const el = root ? (isStr(root) ? document.querySelector(root) : root) : window;
    const wrapped = throttle(handler, 50);
    el.addEventListener('scroll', wrapped, { passive: true });
    return () => el.removeEventListener('scroll', wrapped);
  };

  // Observers
  L.observe = {
    resize(el, handler) {
      const ro = new ResizeObserver(entries => entries.forEach(e => handler(e)));
      ro.observe(el);
      return () => ro.disconnect();
    },
    intersection(el, opts, handler) {
      if (isFn(opts)) { handler = opts; opts = {}; }
      const io = new IntersectionObserver(entries => entries.forEach(e => handler(e)), opts || {});
      io.observe(el);
      return () => io.disconnect();
    },
    mutation(el, opts, handler) {
      const mo = new MutationObserver(list => handler(list));
      mo.observe(el, opts || { childList: true, subtree: true });
      return () => mo.disconnect();
    }
  };

  // AJAX / HTTP
  const toFormData = (obj) => {
    if (obj instanceof FormData) return obj;
    const fd = new FormData();
    const append = (k, v) => {
      if (v === undefined || v === null) return;
      if (isArr(v)) v.forEach((vv) => append(`${k}[]`, vv));
      else if (isObj(v) && !(v instanceof Blob) && !(v instanceof File)) {
        for (const kk in v) append(`${k}[${kk}]`, v[kk]);
      } else fd.append(k, v);
    };
    for (const k in obj) append(k, obj[k]);
    return fd;
  };

  const serializeQuery = (obj) => {
    const p = new URLSearchParams();
    const add = (k, v) => {
      if (v === undefined || v === null) return;
      if (isArr(v)) v.forEach(vv => add(k, vv));
      else if (isObj(v)) for (const kk in v) add(`${k}[${kk}]`, v[kk]);
      else p.append(k, v);
    };
    for (const k in obj) add(k, obj[k]);
    return p.toString();
  };

  const fetchWithTimeout = async (url, options) => {
    const { timeout } = options || {};
    if (!timeout) return fetch(url, options);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const resp = await fetch(url, extend({}, options, { signal: ac.signal }));
      clearTimeout(t);
      return resp;
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  };

  L.ajax = async function (opts) {
    const o = extend({
      url: '',
      method: 'GET',
      data: null,
      headers: {},
      timeout: 0,
      responseType: 'json', // 'json' | 'text' | 'blob' | 'arrayBuffer' | 'auto'
      withCredentials: false,
      retries: 0,
      cacheBust: false,
      onProgress: null, // triggers XHR path
      signal: undefined
    }, opts || {});
    if (!o.url) throw new Error('L.ajax: url required');

    // cache bust
    let url = o.url;
    if (o.cacheBust) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}_=${Date.now()}`;
    }

    // serialize
    const upper = String(o.method).toUpperCase();
    let body = null;
    const headers = extend({}, o.headers);

    if (o.data) {
      if (upper === 'GET' || upper === 'HEAD') {
        const qs = isObj(o.data) ? serializeQuery(o.data) : String(o.data);
        if (qs) url += (url.includes('?') ? '&' : '?') + qs;
      } else {
        // pick best body
        if (o.data instanceof FormData || o.data instanceof Blob) {
          body = o.data;
        } else if (headers['Content-Type'] && headers['Content-Type'].includes('application/x-www-form-urlencoded')) {
          body = serializeQuery(o.data);
        } else if (headers['Content-Type'] && headers['Content-Type'].includes('application/json')) {
          body = JSON.stringify(o.data);
        } else {
          body = toFormData(o.data);
        }
      }
    }

    // XHR path if onProgress provided
    const attemptXHR = !!o.onProgress;
    const attempt = async () => {
      if (attemptXHR) {
        const xhr = new XMLHttpRequest();
        const p = new Promise((resolve, reject) => {
          xhr.open(upper, url, true);
          if (o.withCredentials) xhr.withCredentials = true;
          for (const k in headers) xhr.setRequestHeader(k, headers[k]);
          const rt = o.responseType;
          if (rt && rt !== 'auto' && rt !== 'json' && rt !== 'text') xhr.responseType = rt;
          const to = o.timeout ? setTimeout(() => { xhr.abort(); reject(new Error('L.ajax: timeout')); }, o.timeout) : null;

          xhr.onload = () => {
            if (to) clearTimeout(to);
            const status = xhr.status;
            if (status >= 200 && status < 300) {
              let data = xhr.response;
              if (o.responseType === 'json' || (o.responseType === 'auto' && xhr.getResponseHeader('Content-Type')?.includes('application/json'))) {
                try { data = JSON.parse(xhr.responseText); } catch (_) {}
              } else if (o.responseType === 'text') {
                data = xhr.responseText;
              }
              resolve({ status, ok: true, headers: xhr.getAllResponseHeaders(), data, xhr });
            } else {
              reject(new Error(`HTTP ${status}`));
            }
          };
          xhr.onerror = () => { if (to) clearTimeout(to); reject(new Error('Network error')); };
          if (isFn(o.onProgress)) {
            xhr.upload && xhr.upload.addEventListener('progress', o.onProgress);
            xhr.addEventListener('progress', o.onProgress);
          }
          xhr.send(body);
          if (o.signal) o.signal.addEventListener('abort', () => xhr.abort(), { once: true });
        });
        return p;
      }

      // fetch path
      const resp = await fetchWithTimeout(url, {
        method: upper,
        headers,
        body,
        credentials: o.withCredentials ? 'include' : 'same-origin',
        signal: o.signal
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      let data;
      const ct = resp.headers.get('Content-Type') || '';
      const rt = o.responseType;
      if (rt === 'json' || (rt === 'auto' && ct.includes('application/json'))) data = await resp.json();
      else if (rt === 'text') data = await resp.text();
      else if (rt === 'blob') data = await resp.blob();
      else if (rt === 'arrayBuffer') data = await resp.arrayBuffer();
      else data = await resp.text();
      return { status: resp.status, ok: resp.ok, headers: resp.headers, data, resp };
    };

    let attemptNo = 0;
    while (true) {
      try {
        return await attempt();
      } catch (e) {
        if (attemptNo++ < o.retries) continue;
        throw e;
      }
    }
  };

  L.get = (url, data, opts) => L.ajax(extend({ url, method: 'GET', data }, opts || {}));
  L.post = (url, data, opts) => L.ajax(extend({ url, method: 'POST', data }, opts || {}));
  L.json = (url, data, opts) => L.ajax(extend({ url, method: 'POST', data, headers: { 'Content-Type': 'application/json' }, responseType: 'json' }, opts || {}));

  L.serialize = (v) => {
    if (v instanceof FormData) {
      const o = {};
      for (const [k, val] of v.entries()) setByPath(o, k, val);
      return o;
    }
    if (isObj(v)) return serializeQuery(v);
    return String(v);
  };
  L.toFormData = toFormData;

  // Forms
  L.form = {
    serialize(form, mode = 'object') {
      if (!form) return mode === 'FormData' ? new FormData() : (mode === 'query' ? '' : {});
      const fd = new FormData(form);
      if (mode === 'FormData') return fd;

      const outObj = {};
      for (const [k, v] of fd.entries()) {
        const existing = getByPath(outObj, k);
        if (existing === undefined) {
          setByPath(outObj, k, v);
        } else if (Array.isArray(existing)) {
          existing.push(v);
        } else {
          setByPath(outObj, k, [existing, v]);
        }
      }
      if (mode === 'object') return outObj;
      if (mode === 'query') return serializeQuery(outObj);
      return outObj;
    },
    deserialize(form, data) {
      if (!form || !data) return;
      const elements = form.elements;
      for (const name of Object.keys(elements).filter(k => !isNaN(k))) {} // noop
      Array.from(elements).forEach(el => {
        if (!el.name) return;
        const val = getByPath(data, el.name);
        if (val == null) return;
        if (el.type === 'checkbox') {
          if (isArr(val)) el.checked = val.includes(el.value);
          else el.checked = !!val && (val === true || val === 'on' || String(val) === el.value);
        } else if (el.type === 'radio') {
          el.checked = String(val) === el.value;
        } else if (el.tagName === 'SELECT' && el.multiple && isArr(val)) {
          Array.from(el.options).forEach(opt => opt.selected = val.includes(opt.value));
        } else {
          el.value = String(val);
        }
      });
    },
    reset(form) { form && form.reset && form.reset(); },
    validate(form, rules = {}) {
      const errors = {};
      let valid = true;
      Object.keys(rules).forEach(name => {
        const fns = isArr(rules[name]) ? rules[name] : [rules[name]];
        const el = form.elements[name];
        const value = el ? (el.type === 'checkbox' ? (el.checked ? el.value : '') : el.value) : undefined;
        for (const fn of fns) {
          const res = fn(value, el, form);
          if (res !== true) {
            valid = false;
            if (!errors[name]) errors[name] = [];
            errors[name].push(res || 'Invalid');
          }
        }
      });
      return { valid, errors };
    }
  };

  // Objects / Arrays
  L.extend = extend;
  L.clone = (value, deep = true) => deep ? deepClone(value) : (isArr(value) ? value.slice() : (isObj(value) ? Object.assign({}, value) : value));
  L.merge = (...arrays) => arrays.reduce((acc, a) => (acc.push(...a), acc), []);
  L.unique = (array) => Array.from(new Set(array));
  L.uniqueBy = (array, keyFn) => {
    const map = new Map();
    array.forEach(item => map.set(keyFn(item), item));
    return Array.from(map.values());
  };
  L.compact = (array) => array.filter(Boolean);
  L.chunk = (array, size) => {
    size = Math.max(1, size|0);
    const out = [];
    for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
    return out;
  };
  L.flatten = (array, depth = 1) => array.flat ? array.flat(depth) : array.reduce((a, v) => a.concat(isArr(v) && depth > 1 ? L.flatten(v, depth - 1) : v), []);
  L.groupBy = (array, keyFn) => array.reduce((acc, it) => { const k = keyFn(it); (acc[k] || (acc[k] = [])).push(it); return acc; }, {});
  L.keyBy = (array, keyFn) => array.reduce((acc, it) => (acc[keyFn(it)] = it, acc), {});
  L.sortBy = (array, keyFn, dir = 'asc') => array.slice().sort((a, b) => {
    const ka = keyFn(a), kb = keyFn(b);
    return dir === 'desc' ? (kb > ka ? 1 : kb < ka ? -1 : 0) : (ka > kb ? 1 : ka < kb ? -1 : 0);
  });
  L.pick = (obj, keys) => keys.reduce((acc, k) => (obj && k in obj ? (acc[k] = obj[k]) : 0, acc), {});
  L.omit = (obj, keys) => Object.keys(obj).reduce((acc, k) => (!keys.includes(k) ? (acc[k] = obj[k]) : 0, acc), {});
  L.assign = Object.assign;
  L.get = getByPath;
  L.set = setByPath;
  L.has = hasByPath;
  L.equals = (a, b, deep = true) => {
    if (a === b) return true;
    if (!deep || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  };
  L.isEmpty = (v) => v == null || (isStr(v) && v.trim() === '') || (isArr(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

  // Types & helpers
  L.typeOf = (x) => Object.prototype.toString.call(x).slice(8, -1);
  L.isFunction = isFn;
  L.isArray = isArr;
  L.isString = isStr;
  L.isNumber = v => typeof v === 'number' && !isNaN(v);
  L.isBoolean = v => typeof v === 'boolean';
  L.isPlainObject = v => Object.prototype.toString.call(v) === '[object Object]';
  L.isElement = isEl;
  L.isNil = v => v == null;

  L.uuid = uid;
  L.randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  L.clamp = clamp;
  L.roundTo = (n, step) => Math.round(n / step) * step;

  // Strings
  L.trim = (s) => String(s).trim();
  L.slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  L.escapeHTML = escapeHTML;
  L.unescapeHTML = unescapeHTML;
  L.interpolate = (tpl, data) => tpl.replace(/\{\{\s*([\w.[\]0-9]+)\s*\}\}/g, (_, p) => {
    const v = getByPath(data, p);
    return v == null ? '' : String(v);
  });
  L.template = (tplOrId, data) => {
    const tpl = tplOrId && tplOrId[0] === '#' ? (document.querySelector(tplOrId)?.innerHTML || '') : String(tplOrId || '');
    return L.interpolate(tpl, data || {});
  };

  // Safe HTML channel
  L.htmlSafe = (html, { sanitize } = {}) => {
    const safe = isFn(sanitize) ? sanitize(String(html)) : String(html);
    const template = document.createElement('template');
    template.innerHTML = safe;
    return template.content.cloneNode(true);
  };

  // Time & async
  L.now = now;
  L.sleep = (ms) => new Promise(res => setTimeout(res, ms));
  L.defer = (fn) => setTimeout(fn, 0);
  L.nextTick = (fn) => Promise.resolve().then(fn);
  L.queue = (name => {
    const queues = new Map();
    return (name) => {
      if (!queues.has(name)) queues.set(name, Promise.resolve());
      return {
        push(task) {
          const q = queues.get(name);
          const next = q.then(() => task());
          queues.set(name, next.catch(() => {}));
          return next;
        }
      };
    };
  })();

  // Storage with TTL (ms)
  L.store = {
    set(key, val, { ttl, scope } = {}) {
      const raw = { v: val, e: ttl ? Date.now() + ttl : 0 };
      const str = JSON.stringify(raw);
      (scope === 'session' ? sessionStorage : localStorage).setItem(key, str);
    },
    get(key, { scope } = {}) {
      const str = (scope === 'session' ? sessionStorage : localStorage).getItem(key);
      if (!str) return null;
      try {
        const raw = JSON.parse(str);
        if (raw.e && Date.now() > raw.e) {
          (scope === 'session' ? sessionStorage : localStorage).removeItem(key);
          return null;
        }
        return raw.v;
      } catch (_) { return null; }
    },
    remove(key, { scope } = {}) { (scope === 'session' ? sessionStorage : localStorage).removeItem(key); },
    clear({ scope } = {}) { (scope === 'session' ? sessionStorage : localStorage).clear(); }
  };

  // Cookies
  L.cookie = {
    get(name) {
      const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    },
    set(name, value, opts = {}) {
      let s = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
      if (opts.expires) s += `; Expires=${opts.expires.toUTCString ? opts.expires.toUTCString() : opts.expires}`;
      if (opts.maxAge) s += `; Max-Age=${opts.maxAge}`;
      if (opts.path) s += `; Path=${opts.path}`;
      if (opts.domain) s += `; Domain=${opts.domain}`;
      if (opts.secure) s += `; Secure`;
      if (opts.sameSite) s += `; SameSite=${opts.sameSite}`;
      document.cookie = s;
    },
    remove(name, opts = {}) { this.set(name, '', extend({}, opts, { expires: new Date(0) })); }
  };

  // CSS vars / theme
  L.cssVar = (name, value, { el } = {}) => {
    const target = el || document.documentElement;
    if (value === undefined) return getComputedStyle(target).getPropertyValue(name).trim();
    target.style.setProperty(name, value);
  };
  L.toggleTheme = (name) => {
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme') || 'light';
    const next = name || (cur === 'light' ? 'dark' : 'light');
    root.setAttribute('data-theme', next);
    return next;
  };

  // Plugin API
  L.fn = LSet.prototype;
  L.plugin = (name, factory) => { if (L[name]) throw new Error(`L.plugin: ${name} exists`); L[name] = factory(L); return L[name]; };
  L.use = (moduleFn) => moduleFn && moduleFn(L);

  // expose
  global.L = L;

})(typeof window !== 'undefined' ? window : this);

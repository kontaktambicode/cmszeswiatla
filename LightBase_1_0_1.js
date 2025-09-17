/*!
 * LightBase — base class for L-powered components
 * Version: 1.0.1 (aligned with L 1.1.2 runtime)
 * Requires global L (>= 1.1.2) and global t_lightinstances registry (created here if absent)
 */
(function (global) {
  'use strict';

  // Global instances registry
  const REG_NAME = 't_lightinstances';
  const REG = global[REG_NAME] || (global[REG_NAME] = Object.create(null));

  // Register LightBase-specific error messages (namespaced)
  if (global.L && typeof global.L.registerErrors === 'function') {
    global.L.registerErrors('LightBase', {
      CONFLICT_OWNER: 'Element #{{id}} is already owned by "{{owner}}"',
      INVALID_CONSTRUCTOR_ID: 'Constructor requires a non-empty string id without "#"',
      ALREADY_DESTRUCTED: 'Instance "{{cls}}" for #{{id}} already destructed',
      DESTRUCT_IN_PROGRESS: 'Destruction already in progress for "{{cls}}" #{{id}}'
    }, { override: false });
  }

  function getClassName(cls) {
    return (cls && cls.name) ? cls.name : 'UnnamedClass';
  }

  function ensureClassBucket(className) {
    if (!REG[className]) REG[className] = Object.create(null);
    return REG[className];
  }

  class LightBase {
    static version = '1.0.1';

    /**
     * @param {string} id - element id (without #)
     * @param {object} [options] - optional options bag (kept for future)
     */
    constructor(id, options = {}) {
      const L = global.L;
      const cls = getClassName(this.constructor);

      // Invariants: id is a non-empty string without '#'
      L.assert(!!id && typeof id === 'string' && !id.includes('#'),
        'LightBase.INVALID_CONSTRUCTOR_ID',
        { id, cls });

      const bucket = ensureClassBucket(cls);

      // Single instance per class+id
      L.assert(!bucket[id], 'E_INSTANCE_EXISTS', { id, cls });

      const el = document.getElementById(id);
      L.assert(!!el, 'E_NO_ELEMENT', { id, cls });

      // If element already owned by another class → conflict
      const owner = el.getAttribute('data-light-name');
      L.assert(!owner || owner === cls, 'LightBase.CONFLICT_OWNER', { id, owner });

      // Set attributes and basic metadata
      el.setAttribute('data-light-name', cls);

      // Properties
      this.id = id;
      this.root = el;
      this.className = cls;
      this.version = this.constructor.version || '0.0.0';
      // Language: read once at construction
      this.locale = (typeof global.LNG !== 'undefined' && global.LNG) ? String(global.LNG)
                   : (L && L.env && L.env.get('LNG')) || 'pl';

      // Internal flags
      this.isDestructing = false;
      this.isDestructed = false;

      // Resource tracking
      this._listeners = [];    // { target, type, selector, handler, opts }
      this._disposers = [];    // [fn, ...] generic cleanup callbacks (observers etc.)
      this._timeouts = new Set();
      this._intervals = new Set();
      this._rafs = new Set();
      this._aborts = new Set(); // AbortController

      // Register instance
      bucket[id] = this;

      // Per-instance scoped logger that does not touch global prefix
      const makeScoped = (lvl) => (...args) => {
        if (!L || !L.log || !L.log.isEnabled(lvl)) return;
        const prefix = `[${cls}#${id}]`;
        const first = args[0];
        if (typeof first === 'function') {
          L.log[lvl](() => `${prefix} ${first()}`);
        } else {
          L.log[lvl](prefix, ...args);
        }
      };
      this.log = {
        isEnabled: (lvl) => L && L.log && L.log.isEnabled(lvl),
        info: makeScoped('info'),
        warn: makeScoped('warning'),
        danger: makeScoped('danger')
      };

      // Startup log
      this.log.info(() => `init v${this.version} locale=${this.locale}`);

      // Placeholder for optional options usage
      this.options = options;
    }

    /**
     * Return array of descendant elements that have data-light-name (deepest first)
     */
    _collectOwnedDescendantsDeepFirst() {
      const L = global.L;
      // All descendants with data-light-name
      const nodes = L(this.root).find('[data-light-name]').toArray();
      // Sort by depth (deepest first)
      const depth = (el) => {
        let d = 0, p = el;
        while (p && p !== this.root) { p = p.parentElement; d++; }
        return d;
      };
      nodes.sort((a, b) => depth(b) - depth(a));
      return nodes;
    }

    /**
     * Track an event listener registered via L.on/off (auto-cleanup on destruct)
     */
    addEvent(target, type, selectorOrFn, fnOrOpts, maybeOpts) {
      const L = global.L;
      const t = (typeof target === 'string') ? document.querySelector(target) : target;
      if (!t) return () => {};
      let selector = null, handler = null, opts = null;
      if (typeof selectorOrFn === 'function') {
        handler = selectorOrFn;
        opts = fnOrOpts || false;
        L.on(t, type, handler, opts);
      } else {
        selector = selectorOrFn;
        handler = fnOrOpts;
        opts = maybeOpts || false;
        L.on(t, type, selector, handler, opts);
      }
      const rec = { target: t, type, selector, handler, opts };
      this._listeners.push(rec);
      return () => this._removeEvent(rec);
    }

    _removeEvent(rec) {
      const L = global.L;
      if (!rec) return;
      if (rec.selector) L.off(rec.target, rec.type, rec.selector, rec.handler);
      else L.off(rec.target, rec.type, rec.handler);
    }

    /**
     * Add a generic disposer callback to run on destruct (observers etc.)
     */
    addDisposer(fn) {
      if (typeof fn === 'function') this._disposers.push(fn);
      return fn;
    }

    /**
     * Helpers to add observers with auto-cleanup
     */
    observeResize(el, handler) {
      const dispose = global.L.observe.resize(el, handler);
      this.addDisposer(dispose);
      return dispose;
    }
    observeIntersection(el, opts, handler) {
      if (typeof opts === 'function') { handler = opts; opts = {}; }
      const dispose = global.L.observe.intersection(el, opts || {}, handler);
      this.addDisposer(dispose);
      return dispose;
    }
    observeMutation(el, opts, handler) {
      const dispose = global.L.observe.mutation(el, opts || { childList: true, subtree: true }, handler);
      this.addDisposer(dispose);
      return dispose;
    }

    /**
     * Timers and animation frames with auto-cleanup
     */
    setT(fn, ms) {
      const id = setTimeout(fn, ms);
      this._timeouts.add(id);
      return id;
    }
    clearT(id) {
      clearTimeout(id);
      this._timeouts.delete(id);
    }
    setI(fn, ms) {
      const id = setInterval(fn, ms);
      this._intervals.add(id);
      return id;
    }
    clearI(id) {
      clearInterval(id);
      this._intervals.delete(id);
    }
    requestFrame(fn) {
      const id = requestAnimationFrame(fn);
      this._rafs.add(id);
      return id;
    }
    cancelFrame(id) {
      cancelAnimationFrame(id);
      this._rafs.delete(id);
    }

    /**
     * Track an AbortController to abort it on destruct
     */
    addAbortController(ac) {
      if (ac && typeof ac.abort === 'function') this._aborts.add(ac);
      return ac;
    }

    /**
     * Destruction with cascade:
     *  - run child destructs first (deepest-first) if instances still exist & not destructing/destructed
     *  - cleanup resources
     *  - clear own DOM
     *  - remove data-light-name
     *  - remove from registry
     *  - mark flags
     */
    destruct() {
      const L = global.L;
      const cls = this.className;
      const id = this.id;
      const bucket = ensureClassBucket(cls);

      // Guard: already destructed or in progress
      if (this.isDestructed) {
        L.assert(false, 'LightBase.ALREADY_DESTRUCTED', { cls, id });
        return;
      }
      if (this.isDestructing) {
        L.assert(false, 'LightBase.DESTRUCT_IN_PROGRESS', { cls, id });
        return;
      }

      this.isDestructing = true;
      try {
        // 1) Cascade to children (deepest-first)
        const nodes = this._collectOwnedDescendantsDeepFirst();
        for (const el of nodes) {
          const cname = el.getAttribute('data-light-name');
          const cid = el.id;
          if (!cname || !cid) continue;
          const group = REG[cname];
          const inst = group && group[cid];
          if (inst && !inst.isDestructing && !inst.isDestructed) {
            try { inst.destruct(); } catch (e) {
              if (L && L.log) L.log.danger('child destruct error', e);
            }
          }
        }

        // 2) Cleanup resources
        // listeners
        for (const rec of this._listeners) this._removeEvent(rec);
        this._listeners = [];
        // disposers
        for (const d of this._disposers) { try { d(); } catch(_){} }
        this._disposers = [];
        // timers
        for (const id of Array.from(this._timeouts)) clearTimeout(id);
        this._timeouts.clear();
        for (const id of Array.from(this._intervals)) clearInterval(id);
        this._intervals.clear();
        // RAF
        for (const id of Array.from(this._rafs)) cancelAnimationFrame(id);
        this._rafs.clear();
        // aborts
        for (const ac of Array.from(this._aborts)) { try { ac.abort(); } catch(_){} }
        this._aborts.clear();

        // 3) Clear own DOM
        if (this.root) global.L.dom.clear(this.root);

        // 4) Remove attribute
        if (this.root) this.root.removeAttribute('data-light-name');

        // 5) Remove from registry
        if (bucket[id] === this) delete bucket[id];

        if (L && L.log && L.log.isEnabled('info')) {
          L.log.info(() => `destructed v${this.version}`);
        }

      } finally {
        this.isDestructing = false;
        this.isDestructed = true;
      }
    }
  }

  // Expose
  global.LightBase = LightBase;

})(typeof window !== 'undefined' ? window : this);

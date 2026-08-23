import { checkIcon as e, chevronDownIcon as t, circleIcon as n, closeIcon as r, editIcon as i, externalLinkIcon as a, fitIcon as o, focusIcon as s, lockIcon as c, minusIcon as l, playIcon as u, plusIcon as d, userIcon as f, warningIcon as p } from "/js/icons.js";
import { fetchChildren as m } from "/js/tree.js";
import { app as h, state as g, titleFromId as _ } from "/js/app-shell.js";
import { adminUser as v, auth as y, changePassword as b, groupColor as x, groupLabel as S, listUsers as C, onAuthChange as w, register as T, signIn as ee } from "/js/auth.js";
import { index as te, onStatusChange as ne, statusOf as re, testIndex as ie } from "/js/requirements/store.js";
import { cssSafe as ae, resolveReqRef as oe } from "/js/requirements/parse.js";
import { blockMarkdown as se, inlineMarkdown as ce } from "/js/requirements/render.js";
import { requirementList as le, setCoverageStatus as ue, testList as de } from "/js/requirements.js";
import { combinedStatus as fe, computeTestStatus as pe, connectAutomated as me, disconnectAutomated as he, fetchXUnitCatalog as ge, loadResults as _e, manualTests as ve, rememberAutoUrl as ye, saveManual as be, testsFor as xe } from "/js/coverage.js";
import { sanitizeToFragment as Se } from "/js/sanitize.js";
//#region node_modules/svelte/src/internal/shared/utils.js
var Ce = Array.isArray, we = Array.prototype.indexOf, Te = Array.prototype.includes, Ee = Array.from, De = Object.defineProperty, Oe = Object.getOwnPropertyDescriptor, ke = Object.getOwnPropertyDescriptors, Ae = Object.prototype, je = Array.prototype, Me = Object.getPrototypeOf, Ne = Object.isExtensible, Pe = () => {};
function Fe(e) {
	for (var t = 0; t < e.length; t++) e[t]();
}
function Ie() {
	var e, t;
	return {
		promise: new Promise((n, r) => {
			e = n, t = r;
		}),
		resolve: e,
		reject: t
	};
}
function Le(e, t) {
	if (Array.isArray(e)) return e;
	if (t === void 0 || !(Symbol.iterator in e)) return Array.from(e);
	let n = [];
	for (let r of e) if (n.push(r), n.length === t) break;
	return n;
}
var Re = 1024, ze = 2048, Be = 4096, Ve = 8192, He = 16384, Ue = 32768, We = 1 << 25, Ge = 65536, Ke = 1 << 19, qe = 1 << 20, Je = 1 << 25, Ye = 65536, Xe = 1 << 21, Ze = 1 << 22, Qe = 1 << 23, $e = Symbol("$state"), et = Symbol("legacy props"), tt = Symbol(""), nt = Symbol("attributes"), rt = Symbol("class"), it = Symbol("style"), at = Symbol("text"), ot = Symbol("form reset"), st = new class extends Error {
	name = "StaleReactionError";
	message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}(), ct = !!globalThis.document?.contentType && /* @__PURE__ */ globalThis.document.contentType.includes("xml");
//#endregion
//#region node_modules/svelte/src/internal/client/errors.js
function lt() {
	throw Error("https://svelte.dev/e/async_derived_orphan");
}
function ut(e, t, n) {
	throw Error("https://svelte.dev/e/each_key_duplicate");
}
function dt(e) {
	throw Error("https://svelte.dev/e/effect_in_teardown");
}
function ft() {
	throw Error("https://svelte.dev/e/effect_in_unowned_derived");
}
function pt(e) {
	throw Error("https://svelte.dev/e/effect_orphan");
}
function mt() {
	throw Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function ht(e) {
	throw Error("https://svelte.dev/e/props_invalid_value");
}
function gt() {
	throw Error("https://svelte.dev/e/state_descriptors_fixed");
}
function _t() {
	throw Error("https://svelte.dev/e/state_prototype_fixed");
}
function vt() {
	throw Error("https://svelte.dev/e/state_unsafe_mutation");
}
function yt() {
	throw Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
//#endregion
//#region node_modules/svelte/src/constants.js
var bt = {}, xt = Symbol("uninitialized"), St = "http://www.w3.org/1999/xhtml";
function Ct() {
	console.warn("https://svelte.dev/e/derived_inert");
}
function wt(e) {
	console.warn("https://svelte.dev/e/hydration_mismatch");
}
function Tt() {
	console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/hydration.js
var E = !1;
function Et(e) {
	E = e;
}
var D;
function Dt(e) {
	if (e === null) throw wt(), bt;
	return D = e;
}
function Ot() {
	return Dt(/* @__PURE__ */ nr(D));
}
function O(e) {
	if (E) {
		if (/* @__PURE__ */ nr(D) !== null) throw wt(), bt;
		D = e;
	}
}
function kt(e = 1) {
	if (E) {
		for (var t = e, n = D; t--;) n = /* @__PURE__ */ nr(n);
		D = n;
	}
}
function At(e = !0) {
	for (var t = 0, n = D;;) {
		if (n.nodeType === 8) {
			var r = n.data;
			if (r === "]") {
				if (t === 0) return n;
				--t;
			} else (r === "[" || r === "[!" || r[0] === "[" && !isNaN(Number(r.slice(1)))) && (t += 1);
		}
		var i = /* @__PURE__ */ nr(n);
		e && n.remove(), n = i;
	}
}
function jt(e) {
	if (!e || e.nodeType !== 8) throw wt(), bt;
	return e.data;
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/equality.js
function Mt(e) {
	return e === this.v;
}
function Nt(e, t) {
	return e == e ? e !== t || typeof e == "object" && !!e || typeof e == "function" : t == t;
}
function Pt(e) {
	return !Nt(e, this.v);
}
//#endregion
//#region node_modules/svelte/src/internal/client/context.js
var Ft = null;
function It(e) {
	Ft = e;
}
function k(e, t = !1, n) {
	Ft = {
		p: Ft,
		i: !1,
		c: null,
		e: null,
		s: e,
		x: null,
		r: B,
		l: null
	};
}
function A(e) {
	var t = Ft, n = t.e;
	if (n !== null) {
		t.e = null;
		for (var r of n) pr(r);
	}
	return e !== void 0 && (t.x = e), t.i = !0, Ft = t.p, e ?? {};
}
function Lt() {
	return !0;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/task.js
var Rt = [];
function zt() {
	var e = Rt;
	Rt = [], Fe(e);
}
function Bt(e) {
	if (Rt.length === 0 && !Cn) {
		var t = Rt;
		queueMicrotask(() => {
			t === Rt && zt();
		});
	}
	Rt.push(e);
}
function Vt() {
	for (; Rt.length > 0;) zt();
}
function Ht(e) {
	var t = B;
	if (t === null) return z.f |= Qe, e;
	if (!(t.f & 32768) && !(t.f & 4)) throw e;
	Ut(e, t);
}
function Ut(e, t) {
	if (!(t !== null && t.f & 16384)) {
		for (; t !== null;) {
			if (t.f & 128) {
				if (!(t.f & 32768)) throw e;
				try {
					t.b.error(e);
					return;
				} catch (t) {
					e = t;
				}
			}
			t = t.parent;
		}
		throw e;
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/status.js
var Wt = ~(ze | Be | Re);
function Gt(e, t) {
	e.f = e.f & Wt | t;
}
function Kt(e) {
	e.f & 512 || e.deps === null ? Gt(e, Re) : Gt(e, Be);
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/utils.js
function qt(e) {
	if (e !== null) for (let t of e) !(t.f & 2) || !(t.f & 65536) || (t.f ^= Ye, qt(t.deps));
}
function Jt(e, t, n) {
	e.f & 2048 ? t.add(e) : e.f & 4096 && n.add(e), qt(e.deps), Gt(e, Re);
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/store.js
var Yt = !1;
function Xt(e) {
	var t = Yt;
	try {
		return Yt = !1, [e(), Yt];
	} finally {
		Yt = t;
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/misc.js
var Zt = !1;
function Qt() {
	Zt || (Zt = !0, document.addEventListener("reset", (e) => {
		Promise.resolve().then(() => {
			if (!e.defaultPrevented) for (let t of e.target.elements) t[ot]?.();
		});
	}, { capture: !0 }));
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/bindings/shared.js
function $t(e) {
	var t = z, n = B;
	Ir(null), Lr(null);
	try {
		return e();
	} finally {
		Ir(t), Lr(n);
	}
}
function en(e, t, n, r = n) {
	e.addEventListener(t, () => $t(n));
	let i = e[ot];
	e[ot] = i ? () => {
		i(), r(!0);
	} : () => r(!0), Qt();
}
//#endregion
//#region node_modules/svelte/src/reactivity/create-subscriber.js
function tn(e) {
	let t = 0, n = Bn(0), r;
	return () => {
		ur() && (V(n), _r(() => (t === 0 && (r = ii(() => e(() => Gn(n)))), t += 1, () => {
			Bt(() => {
				--t, t === 0 && (r?.(), r = void 0, Gn(n));
			});
		})));
	};
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/boundary.js
var nn = Ge | Ke;
function rn(e, t, n, r) {
	new an(e, t, n, r);
}
var an = class {
	parent;
	is_pending = !1;
	transform_error;
	#e;
	#t = E ? D : null;
	#n;
	#r;
	#i;
	#a = null;
	#o = null;
	#s = null;
	#c = null;
	#l = 0;
	#u = 0;
	#d = !1;
	#f = /* @__PURE__ */ new Set();
	#p = /* @__PURE__ */ new Set();
	#m = null;
	#h = tn(() => (this.#m = Bn(this.#l), () => {
		this.#m = null;
	}));
	constructor(e, t, n, r) {
		this.#e = e, this.#n = t, this.#r = (e) => {
			var t = B;
			t.b = this, t.f |= 128, n(e);
		}, this.parent = B.b, this.transform_error = r ?? this.parent?.transform_error ?? ((e) => e), this.#i = vr(() => {
			if (E) {
				let e = this.#t;
				Ot();
				let t = e.data === "[!";
				if (e.data.startsWith("[?")) {
					let t = JSON.parse(e.data.slice(2));
					this.#_(t);
				} else t ? this.#y() : this.#g();
			} else this.#b();
		}, nn), E && (this.#e = D);
	}
	#g() {
		try {
			this.#a = yr(() => this.#r(this.#e));
		} catch (e) {
			this.error(e);
		}
	}
	#_(e) {
		let t = this.#n.failed, { reset: n, invoke_onerror: r } = this.#v(e);
		Bt(r), t && (this.#s = yr(() => {
			t(this.#e, () => e, () => n);
		}));
	}
	#v(e) {
		var t = !1, n = !1;
		let r = () => {
			if (t) {
				Tt();
				return;
			}
			t = !0, n && yt(), this.#s !== null && Er(this.#s, () => {
				this.#s = null;
			}), this.#S(() => {
				this.#b();
			});
		};
		return {
			reset: r,
			invoke_onerror: () => {
				try {
					n = !0, this.#n.onerror?.(e, r), n = !1;
				} catch (e) {
					Ut(e, this.#i && this.#i.parent);
				}
			}
		};
	}
	#y() {
		let e = this.#n.pending;
		e && (this.is_pending = !0, this.#o = yr(() => e(this.#e)), Bt(() => {
			var e = this.#c = document.createDocumentFragment(), t = er();
			e.append(t), this.#a = this.#S(() => yr(() => this.#r(t))), this.#u === 0 && (this.#e.before(e), this.#c = null, Er(this.#o, () => {
				this.#o = null;
			}), this.#x(M));
		}));
	}
	#b() {
		try {
			if (this.is_pending = this.has_pending_snippet(), this.#u = 0, this.#l = 0, this.#a = yr(() => {
				this.#r(this.#e);
			}), this.#u > 0) {
				var e = this.#c = document.createDocumentFragment();
				Ar(this.#a, e);
				let t = this.#n.pending;
				this.#o = yr(() => t(this.#e));
			} else this.#x(M);
		} catch (e) {
			this.error(e);
		}
	}
	#x(e) {
		this.is_pending = !1, e.transfer_effects(this.#f, this.#p);
	}
	defer_effect(e) {
		Jt(e, this.#f, this.#p);
	}
	is_rendered() {
		return !this.is_pending && (!this.parent || this.parent.is_rendered());
	}
	has_pending_snippet() {
		return !!this.#n.pending;
	}
	#S(e) {
		var t = B, n = z, r = Ft;
		Lr(this.#i), Ir(this.#i), It(this.#i.ctx);
		try {
			return kn.ensure(), e();
		} catch (e) {
			return Ht(e), null;
		} finally {
			Lr(t), Ir(n), It(r);
		}
	}
	#C(e, t) {
		if (!this.has_pending_snippet()) {
			this.parent && this.parent.#C(e, t);
			return;
		}
		this.#u += e, this.#u === 0 && (this.#x(t), this.#o && Er(this.#o, () => {
			this.#o = null;
		}), this.#c &&= (this.#e.before(this.#c), null));
	}
	update_pending_count(e, t) {
		this.#C(e, t), this.#l += e, !(!this.#m || this.#d) && (this.#d = !0, Bt(() => {
			this.#d = !1, this.#m && Hn(this.#m, this.#l);
		}));
	}
	get_effect_pending() {
		return this.#h(), V(this.#m);
	}
	error(e) {
		if (!this.#n.onerror && !this.#n.failed) throw e;
		M?.is_fork ? (this.#a && M.skip_effect(this.#a), this.#o && M.skip_effect(this.#o), this.#s && M.skip_effect(this.#s), M.oncommit(() => {
			this.#w(e);
		})) : this.#w(e);
	}
	#w(e) {
		this.#a &&= (Cr(this.#a), null), this.#o &&= (Cr(this.#o), null), this.#s &&= (Cr(this.#s), null), E && (Dt(this.#t), kt(), Dt(At()));
		let t = this.#n.failed, n = (e) => {
			let { reset: n, invoke_onerror: r } = this.#v(e);
			r(), t && (this.#s = this.#S(() => {
				try {
					return yr(() => {
						var r = B;
						r.b = this, r.f |= 128, t(this.#e, () => e, () => n);
					});
				} catch (e) {
					return Ut(e, this.#i.parent), null;
				}
			}));
		};
		Bt(() => {
			var t;
			try {
				t = this.transform_error(e);
			} catch (e) {
				Ut(e, this.#i && this.#i.parent);
				return;
			}
			typeof t == "object" && t && typeof t.then == "function" ? t.then(n, (e) => Ut(e, this.#i && this.#i.parent)) : n(t);
		});
	}
};
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/async.js
function on(e, t, n, r) {
	let i = Lt() ? un : pn;
	var a = e.filter((e) => !e.settled), o = t.map(i);
	if (n.length === 0 && a.length === 0) {
		r(o);
		return;
	}
	var s = B, c = sn(), l = a.length === 1 ? a[0].promise : a.length > 1 ? Promise.all(a.map((e) => e.promise)) : null;
	function u(e) {
		if (!(s.f & 16384)) {
			c();
			try {
				r([...o, ...e]);
			} catch (e) {
				Ut(e, s);
			}
			cn();
		}
	}
	var d = ln();
	if (n.length === 0) {
		l.then(() => u([])).finally(d);
		return;
	}
	function f() {
		Promise.all(n.map((e) => /* @__PURE__ */ fn(e))).then(u).catch((e) => Ut(e, s)).finally(d);
	}
	l ? l.then(() => {
		c(), f(), cn();
	}) : f();
}
function sn() {
	var e = B, t = z, n = Ft, r = M;
	return function(i = !0) {
		Lr(e), Ir(t), It(n), i && !(e.f & 16384) && (r?.activate(), r?.apply());
	};
}
function cn(e = !0) {
	Lr(null), Ir(null), It(null), e && M?.deactivate();
}
function ln() {
	var e = B, t = e.b, n = M, r = !!t?.is_rendered();
	return t?.update_pending_count(1, n), n.increment(r, e), () => {
		t?.update_pending_count(-1, n), n.decrement(r, e);
	};
}
/*#__NO_SIDE_EFFECTS__*/
function un(e) {
	var t = 2 | ze;
	return B !== null && (B.f |= Ke), {
		ctx: Ft,
		deps: null,
		effects: null,
		equals: Mt,
		f: t,
		fn: e,
		reactions: null,
		rv: 0,
		v: xt,
		wv: 0,
		parent: B,
		ac: null
	};
}
var dn = Symbol("obsolete");
/*#__NO_SIDE_EFFECTS__*/
function fn(e, t, n) {
	let r = B;
	r === null && lt();
	var i = void 0, a = Bn(xt), o = !z, s = /* @__PURE__ */ new Set();
	return gr(() => {
		var t = B, n = Ie();
		i = n.promise;
		try {
			Promise.resolve(e()).then(n.resolve, (e) => {
				e !== st && n.reject(e);
			}).finally(cn);
		} catch (e) {
			n.reject(e), cn();
		}
		var c = M;
		if (o) {
			if (t.f & 32768) var l = ln();
			if (r.b?.is_rendered()) c.async_deriveds.get(t)?.reject(dn);
			else for (let e of s.values()) e.reject(dn);
			s.add(n), c.async_deriveds.set(t, n);
		}
		let u = (e, t = void 0) => {
			l?.(), s.delete(n), t !== dn && (c.activate(), t ? (a.f |= Qe, Hn(a, t)) : (a.f & 8388608 && (a.f ^= Qe), Hn(a, e)), c.deactivate());
		};
		n.promise.then(u, (e) => u(null, e || "unknown"));
	}), dr(() => {
		for (let e of s) e.reject(dn);
	}), new Promise((e) => {
		function t(n) {
			function r() {
				n === i ? e(a) : t(i);
			}
			n.then(r, r);
		}
		t(i);
	});
}
/*#__NO_SIDE_EFFECTS__*/
function j(e) {
	let t = /* @__PURE__ */ un(e);
	return zr(t), t;
}
/*#__NO_SIDE_EFFECTS__*/
function pn(e) {
	let t = /* @__PURE__ */ un(e);
	return t.equals = Pt, t;
}
function mn(e) {
	var t = e.effects;
	if (t !== null) {
		e.effects = null;
		for (var n = 0; n < t.length; n += 1) Cr(t[n]);
	}
}
function hn(e) {
	var t, n = B, r = e.parent;
	if (!Nr && r !== null && e.v !== xt && r.f & 24576) return Ct(), e.v;
	Lr(r);
	try {
		e.f &= ~Ye, mn(e), t = Zr(e);
	} finally {
		Lr(n);
	}
	return t;
}
function gn(e) {
	var t = hn(e);
	if (!e.equals(t) && (e.wv = Jr(), (!M?.is_fork || e.deps === null) && (M === null ? e.v = t : (M.capture(e, t, !0), bn?.capture(e, t, !0)), e.deps === null))) {
		Gt(e, Re);
		return;
	}
	Nr || (xn === null ? Kt(e) : (ur() || M?.is_fork) && xn.set(e, t));
}
function _n(e) {
	if (e.effects !== null) for (let t of e.effects) (t.teardown || t.ac) && (t.teardown?.(), t.ac !== null && $t(() => {
		t.ac.abort(st), t.ac = null;
	}), t.fn !== null && (t.teardown = Pe), $r(t, 0), xr(t));
}
function vn(e) {
	if (e.effects !== null) for (let t of e.effects) t.teardown && t.fn !== null && ei(t);
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/batch.js
var yn = null, M = null, bn = null, xn = null, Sn = null, Cn = !1, wn = !1, Tn = null, En = null, Dn = 0, On = 1, kn = class e {
	id = On++;
	#e = !1;
	linked = !0;
	#t = null;
	#n = null;
	async_deriveds = /* @__PURE__ */ new Map();
	current = /* @__PURE__ */ new Map();
	previous = /* @__PURE__ */ new Map();
	#r = /* @__PURE__ */ new Set();
	#i = /* @__PURE__ */ new Set();
	#a = 0;
	#o = /* @__PURE__ */ new Map();
	#s = null;
	#c = [];
	#l = [];
	#u = /* @__PURE__ */ new Set();
	#d = /* @__PURE__ */ new Set();
	#f = /* @__PURE__ */ new Map();
	#p = /* @__PURE__ */ new Set();
	is_fork = !1;
	#m = !1;
	constructor() {
		yn === null ? yn = this : (yn.#n = this, this.#t = yn), yn = this;
	}
	#h() {
		if (this.is_fork) return !0;
		for (let n of this.#o.keys()) {
			for (var e = n, t = !1; e.parent !== null;) {
				if (this.#f.has(e)) {
					t = !0;
					break;
				}
				e = e.parent;
			}
			if (!t) return !0;
		}
		return !1;
	}
	skip_effect(e) {
		this.#f.has(e) || this.#f.set(e, {
			d: [],
			m: []
		}), this.#p.delete(e);
	}
	unskip_effect(e, t = (e) => this.schedule(e)) {
		var n = this.#f.get(e);
		if (n) {
			this.#f.delete(e);
			for (var r of n.d) Gt(r, ze), t(r);
			for (r of n.m) Gt(r, Be), t(r);
		}
		this.#p.add(e);
	}
	#g() {
		this.#e = !0, Dn++ > 1e3 && (this.#x(), jn());
		for (let e of this.#u) this.#d.delete(e), Gt(e, ze), this.schedule(e);
		for (let e of this.#d) Gt(e, Be), this.schedule(e);
		let t = this.#c;
		this.#c = [], this.apply();
		var n = Tn = [], r = [], i = En = [];
		for (let e of t) try {
			this.#_(e, n, r);
		} catch (t) {
			throw In(e), this.#h() || this.discard(), t;
		}
		if (M = null, i.length > 0) {
			var a = e.ensure();
			for (let e of i) a.schedule(e);
		}
		if (Tn = null, En = null, this.#h()) {
			this.#b(r), this.#b(n);
			for (let [e, t] of this.#f) Fn(e, t);
			i.length > 0 && M.#g();
			return;
		}
		let o = this.#v();
		if (o) {
			this.#b(r), this.#b(n), o.#y(this);
			return;
		}
		this.#u.clear(), this.#d.clear();
		for (let e of this.#r) e(this);
		this.#r.clear(), bn = this, Nn(r), Nn(n), bn = null, this.#s?.resolve();
		var s = M;
		if (this.#a === 0 && (this.#c.length === 0 || s !== null) && this.#x(), this.#c.length > 0) {
			if (s !== null) {
				let e = s;
				e.#c.push(...this.#c.filter((t) => !e.#c.includes(t)));
			} else s = this;
		}
		s !== null && (Rn.clear(), s.#g());
	}
	#_(e, t, n) {
		e.f ^= Re;
		for (var r = e.first; r !== null;) {
			var i = r.f, a = !!(i & 96);
			if (!(a && i & 1024 || i & 8192 || this.#f.has(r)) && r.fn !== null) {
				a ? r.f ^= Re : i & 4 ? t.push(r) : Yr(r) && (i & 16 && this.#d.add(r), ei(r));
				var o = r.first;
				if (o !== null) {
					r = o;
					continue;
				}
			}
			for (; r !== null;) {
				var s = r.next;
				if (s !== null) {
					r = s;
					break;
				}
				r = r.parent;
			}
		}
	}
	#v() {
		for (var e = this.#t; e !== null;) {
			if (!e.is_fork) {
				for (let [t, [, n]] of this.current) if (e.current.has(t) && !n) return e;
			}
			e = e.#t;
		}
		return null;
	}
	#y(e) {
		for (let [t, n] of e.current) !this.previous.has(t) && e.previous.has(t) && this.previous.set(t, e.previous.get(t)), this.current.set(t, n);
		for (let [t, n] of e.async_deriveds) {
			let e = this.async_deriveds.get(t);
			e && n.promise.then(e.resolve).catch(e.reject);
		}
		e.async_deriveds.clear(), this.transfer_effects(e.#u, e.#d);
		let t = (e) => {
			var n = e.reactions;
			if (n !== null && !(e.f & 2 && !(e.f & 6144))) for (let e of n) {
				var r = e.f;
				if (r & 2) t(e);
				else {
					var i = e;
					r & 4194320 && !this.async_deriveds.has(i) && (this.#d.delete(i), Gt(i, ze), this.schedule(i));
				}
			}
		};
		for (let e of this.current.keys()) t(e);
		this.oncommit(() => e.discard()), e.#x(), M = this, this.#g();
	}
	#b(e) {
		for (var t = 0; t < e.length; t += 1) Jt(e[t], this.#u, this.#d);
	}
	capture(e, t, n = !1) {
		e.v !== xt && !this.previous.has(e) && this.previous.set(e, e.v), e.f & 8388608 || (this.current.set(e, [t, n]), xn?.set(e, t)), this.is_fork || (e.v = t);
	}
	activate() {
		M = this;
	}
	deactivate() {
		M = null, xn = null;
	}
	flush() {
		try {
			wn = !0, M = this, this.#g();
		} finally {
			Dn = 0, Sn = null, Tn = null, En = null, wn = !1, M = null, xn = null, Rn.clear();
		}
	}
	discard() {
		for (let e of this.#i) e(this);
		this.#i.clear();
		for (let e of this.async_deriveds.values()) e.reject(dn);
		this.#x(), this.#s?.resolve();
	}
	register_created_effect(e) {
		this.#l.push(e);
	}
	increment(e, t) {
		if (this.#a += 1, e) {
			let e = this.#o.get(t) ?? 0;
			this.#o.set(t, e + 1);
		}
	}
	decrement(e, t) {
		if (--this.#a, e) {
			let e = this.#o.get(t) ?? 0;
			e === 1 ? this.#o.delete(t) : this.#o.set(t, e - 1);
		}
		this.#m || (this.#m = !0, Bt(() => {
			this.#m = !1, this.linked && this.flush();
		}));
	}
	transfer_effects(e, t) {
		for (let t of e) this.#u.add(t);
		for (let e of t) this.#d.add(e);
		e.clear(), t.clear();
	}
	oncommit(e) {
		this.#r.add(e);
	}
	ondiscard(e) {
		this.#i.add(e);
	}
	settled() {
		return (this.#s ??= Ie()).promise;
	}
	static ensure() {
		if (M === null) {
			let t = M = new e();
			!wn && !Cn && Bt(() => {
				t.#e || t.flush();
			});
		}
		return M;
	}
	apply() {
		xn = null;
	}
	schedule(e) {
		if (Sn = e, e.b?.is_pending && e.f & 16777228 && !(e.f & 32768)) {
			e.b.defer_effect(e);
			return;
		}
		for (var t = e; t.parent !== null;) {
			t = t.parent;
			var n = t.f;
			if (Tn !== null && t === B && (z === null || !(z.f & 2))) return;
			if (n & 96) {
				if (!(n & 1024)) return;
				t.f ^= Re;
			}
		}
		this.#c.push(t);
	}
	#x() {
		if (this.linked) {
			var e = this.#t, t = this.#n;
			e === null || (e.#n = t), t === null ? yn = e : t.#t = e, this.linked = !1;
		}
	}
};
function An(e) {
	var t = Cn;
	Cn = !0;
	try {
		var n;
		for (e && (M !== null && !M.is_fork && M.flush(), n = e());;) {
			if (Vt(), M === null) return n;
			M.flush();
		}
	} finally {
		Cn = t;
	}
}
function jn() {
	try {
		mt();
	} catch (e) {
		Ut(e, Sn);
	}
}
var Mn = null;
function Nn(e) {
	var t = e.length;
	if (t !== 0) {
		for (var n = 0; n < t;) {
			var r = e[n++];
			if (!(r.f & 24576) && Yr(r) && (Mn = /* @__PURE__ */ new Set(), ei(r), r.deps === null && r.first === null && r.nodes === null && r.teardown === null && r.ac === null && Tr(r), Mn?.size > 0)) {
				Rn.clear();
				for (let e of Mn) {
					if (e.f & 24576) continue;
					let t = [e], n = e.parent;
					for (; n !== null;) Mn.has(n) && (Mn.delete(n), t.push(n)), n = n.parent;
					for (let e = t.length - 1; e >= 0; e--) {
						let n = t[e];
						n.f & 24576 || ei(n);
					}
				}
				Mn.clear();
			}
		}
		Mn = null;
	}
}
function Pn(e) {
	M.schedule(e);
}
function Fn(e, t) {
	if (!(e.f & 32 && e.f & 1024)) {
		e.f & 2048 ? t.d.push(e) : e.f & 4096 && t.m.push(e), Gt(e, Re);
		for (var n = e.first; n !== null;) Fn(n, t), n = n.next;
	}
}
function In(e) {
	Gt(e, Re);
	for (var t = e.first; t !== null;) In(t), t = t.next;
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/sources.js
var Ln = /* @__PURE__ */ new Set(), Rn = /* @__PURE__ */ new Map(), zn = !1;
function Bn(e, t) {
	return {
		f: 0,
		v: e,
		reactions: null,
		equals: Mt,
		rv: 0,
		wv: 0
	};
}
/*#__NO_SIDE_EFFECTS__*/
function N(e, t) {
	let n = Bn(e, t);
	return zr(n), n;
}
/*#__NO_SIDE_EFFECTS__*/
function Vn(e, t = !1, n = !0) {
	let r = Bn(e);
	return t || (r.equals = Pt), r;
}
function P(e, t, n = !1) {
	return z !== null && (!Fr || z.f & 131072) && Lt() && z.f & 4325394 && (Rr === null || !Rr.has(e)) && vt(), Hn(e, n ? qn(t) : t, En);
}
function Hn(e, t, n = null) {
	if (!e.equals(t)) {
		Nr ? Rn.set(e, t) : Rn.has(e) || Rn.set(e, e.v);
		var r = kn.ensure();
		if (r.capture(e, t), e.f & 2) {
			let t = e;
			e.f & 2048 && hn(t), xn === null && Kt(t);
		}
		e.wv = Jr(), Kn(e, ze, n), Lt() && B !== null && B.f & 1024 && !(B.f & 96) && (Hr === null ? Ur([e]) : Hr.push(e)), !r.is_fork && Ln.size > 0 && !zn && Un();
	}
	return t;
}
function Un() {
	zn = !1;
	for (let e of Ln) {
		e.f & 1024 && Gt(e, Be);
		let t;
		try {
			t = Yr(e);
		} catch {
			t = !0;
		}
		t && ei(e);
	}
	Ln.clear();
}
function Wn(e, t = 1) {
	var n = V(e), r = t === 1 ? n++ : n--;
	return P(e, n), r;
}
function Gn(e) {
	P(e, e.v + 1);
}
function Kn(e, t, n) {
	var r = e.reactions;
	if (r !== null) for (var i = Lt(), a = r.length, o = 0; o < a; o++) {
		var s = r[o], c = s.f;
		if (!(!i && s === B)) {
			var l = (c & ze) === 0;
			if (l && Gt(s, t), c & 131072) Ln.add(s);
			else if (c & 2) {
				var u = s;
				xn?.delete(u), c & 65536 || (c & 512 && (B === null || !(B.f & 2097152)) && (s.f |= Ye), Kn(u, Be, n));
			} else if (l) {
				var d = s;
				c & 16 && Mn !== null && Mn.add(d), n === null ? Pn(d) : n.push(d);
			}
		}
	}
}
function qn(e) {
	if (typeof e != "object" || !e || $e in e) return e;
	let t = Me(e);
	if (t !== Ae && t !== je) return e;
	var n = /* @__PURE__ */ new Map(), r = Ce(e), i = /* @__PURE__ */ N(0), a = null, o = Kr, s = (e) => {
		if (Kr === o) return e();
		var t = z, n = Kr;
		Ir(null), qr(o);
		var r = e();
		return Ir(t), qr(n), r;
	};
	return r && n.set("length", /* @__PURE__ */ N(e.length, a)), new Proxy(e, {
		defineProperty(e, t, r) {
			(!("value" in r) || r.configurable === !1 || r.enumerable === !1 || r.writable === !1) && gt();
			var i = n.get(t);
			return i === void 0 ? s(() => {
				var e = /* @__PURE__ */ N(r.value, a);
				return n.set(t, e), e;
			}) : P(i, r.value, !0), !0;
		},
		deleteProperty(e, t) {
			var r = n.get(t);
			if (r === void 0) {
				if (t in e) {
					let e = s(() => /* @__PURE__ */ N(xt, a));
					n.set(t, e), Gn(i);
				}
			} else P(r, xt), Gn(i);
			return !0;
		},
		get(t, r, i) {
			if (r === $e) return e;
			var o = n.get(r), c = r in t;
			if (o === void 0 && (!c || Oe(t, r)?.writable) && (o = s(() => /* @__PURE__ */ N(qn(c ? t[r] : xt), a)), n.set(r, o)), o !== void 0) {
				var l = V(o);
				return l === xt ? void 0 : l;
			}
			return Reflect.get(t, r, i);
		},
		getOwnPropertyDescriptor(e, t) {
			var r = Reflect.getOwnPropertyDescriptor(e, t);
			if (r && "value" in r) {
				var i = n.get(t);
				i && (r.value = V(i));
			} else if (r === void 0) {
				var a = n.get(t), o = a?.v;
				if (a !== void 0 && o !== xt) return {
					enumerable: !0,
					configurable: !0,
					value: o,
					writable: !0
				};
			}
			return r;
		},
		has(e, t) {
			if (t === $e) return !0;
			var r = n.get(t), i = r !== void 0 && r.v !== xt || Reflect.has(e, t);
			return (r !== void 0 || B !== null && (!i || Oe(e, t)?.writable)) && (r === void 0 && (r = s(() => /* @__PURE__ */ N(i ? qn(e[t]) : xt, a)), n.set(t, r)), V(r) === xt) ? !1 : i;
		},
		set(e, t, o, c) {
			var l = n.get(t), u = t in e;
			if (r && t === "length") for (var d = o; d < l.v; d += 1) {
				var f = n.get(d + "");
				f === void 0 ? d in e && (f = s(() => /* @__PURE__ */ N(xt, a)), n.set(d + "", f)) : P(f, xt);
			}
			if (l === void 0) (!u || Oe(e, t)?.writable) && (l = s(() => /* @__PURE__ */ N(void 0, a)), P(l, qn(o)), n.set(t, l));
			else {
				u = l.v !== xt;
				var p = s(() => qn(o));
				P(l, p);
			}
			var m = Reflect.getOwnPropertyDescriptor(e, t);
			if (m?.set && m.set.call(c, o), !u) {
				if (r && typeof t == "string") {
					var h = n.get("length"), g = Number(t);
					Number.isInteger(g) && g >= h.v && P(h, g + 1);
				}
				Gn(i);
			}
			return !0;
		},
		ownKeys(e) {
			V(i);
			var t = Reflect.ownKeys(e).filter((e) => {
				var t = n.get(e);
				return t === void 0 || t.v !== xt;
			});
			for (var [r, a] of n) a.v !== xt && !(r in e) && t.push(r);
			return t;
		},
		setPrototypeOf() {
			_t();
		}
	});
}
var Jn, Yn, Xn, Zn, Qn;
function $n() {
	if (Jn === void 0) {
		Jn = window, Yn = document, Xn = /Firefox/.test(navigator.userAgent);
		var e = Element.prototype, t = Node.prototype, n = Text.prototype;
		Zn = Oe(t, "firstChild").get, Qn = Oe(t, "nextSibling").get, Ne(e) && (e[rt] = void 0, e[nt] = null, e[it] = void 0, e.__e = void 0), Ne(n) && (n[at] = void 0);
	}
}
function er(e = "") {
	return document.createTextNode(e);
}
/*@__NO_SIDE_EFFECTS__*/
function tr(e) {
	return Zn.call(e);
}
/*@__NO_SIDE_EFFECTS__*/
function nr(e) {
	return Qn.call(e);
}
function F(e, t) {
	if (!E) return /* @__PURE__ */ tr(e);
	var n = /* @__PURE__ */ tr(D);
	if (n === null) n = D.appendChild(er());
	else if (t && n.nodeType !== 3) {
		var r = er();
		return n?.before(r), Dt(r), r;
	}
	return t && or(n), Dt(n), n;
}
function I(e, t = !1) {
	if (!E) {
		var n = /* @__PURE__ */ tr(e);
		return n instanceof Comment && n.data === "" ? /* @__PURE__ */ nr(n) : n;
	}
	if (t) {
		if (D?.nodeType !== 3) {
			var r = er();
			return D?.before(r), Dt(r), r;
		}
		or(D);
	}
	return D;
}
function L(e, t = 1, n = !1) {
	let r = E ? D : e;
	for (var i; t--;) i = r, r = /* @__PURE__ */ nr(r);
	if (!E) return r;
	if (n) {
		if (r?.nodeType !== 3) {
			var a = er();
			return r === null ? i?.after(a) : r.before(a), Dt(a), a;
		}
		or(r);
	}
	return Dt(r), r;
}
function rr(e) {
	e.textContent = "";
}
function ir() {
	return !1;
}
function ar(e, t, n) {
	return t == null || t === "http://www.w3.org/1999/xhtml" ? n ? document.createElement(e, { is: n }) : document.createElement(e) : n ? document.createElementNS(t, e, { is: n }) : document.createElementNS(t, e);
}
function or(e) {
	if (e.nodeValue.length < 65536) return;
	let t = e.nextSibling;
	for (; t !== null && t.nodeType === 3;) t.remove(), e.nodeValue += t.nodeValue, t = e.nextSibling;
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/effects.js
function sr(e) {
	B === null && (z === null && pt(e), ft()), Nr && dt(e);
}
function cr(e, t) {
	var n = t.last;
	n === null ? t.last = t.first = e : (n.next = e, e.prev = n, t.last = e);
}
function lr(e, t) {
	var n = B;
	n !== null && n.f & 8192 && (e |= Ve);
	var r = {
		ctx: Ft,
		deps: null,
		nodes: null,
		f: e | ze | 512,
		first: null,
		fn: t,
		last: null,
		next: null,
		parent: n,
		b: n && n.b,
		prev: null,
		teardown: null,
		wv: 0,
		ac: null
	};
	M?.register_created_effect(r);
	var i = r;
	if (e & 4) Tn === null ? kn.ensure().schedule(r) : Tn.push(r);
	else if (t !== null) {
		try {
			ei(r);
		} catch (e) {
			throw Cr(r), e;
		}
		i.deps === null && i.teardown === null && i.nodes === null && i.first === i.last && !(i.f & 524288) && (i = i.first, e & 16 && e & 65536 && i !== null && (i.f |= Ge));
	}
	if (i !== null && (i.parent = n, n !== null && cr(i, n), z !== null && z.f & 2 && !(e & 64))) {
		var a = z;
		(a.effects ??= []).push(i);
	}
	return r;
}
function ur() {
	return z !== null && !Fr;
}
function dr(e) {
	let t = lr(8, null);
	return Gt(t, Re), t.teardown = e, t;
}
function fr(e) {
	sr("$effect");
	var t = B.f;
	if (!z && t & 32 && Ft !== null && !Ft.i) {
		var n = Ft;
		(n.e ??= []).push(e);
	} else return pr(e);
}
function pr(e) {
	return lr(4 | qe, e);
}
function mr(e) {
	kn.ensure();
	let t = lr(64 | Ke, e);
	return (e = {}) => new Promise((n) => {
		e.outro ? Er(t, () => {
			Cr(t), n(void 0);
		}) : (Cr(t), n(void 0));
	});
}
function hr(e) {
	return lr(4, e);
}
function gr(e) {
	return lr(Ze | Ke, e);
}
function _r(e, t = 0) {
	return lr(8 | t, e);
}
function R(e, t = [], n = [], r = []) {
	on(r, t, n, (t) => {
		lr(8, () => {
			e(...t.map(V));
		});
	});
}
function vr(e, t = 0) {
	return lr(16 | t, e);
}
function yr(e) {
	return lr(32 | Ke, e);
}
function br(e) {
	var t = e.teardown;
	if (t !== null) {
		let e = Nr, n = z;
		Pr(!0), Ir(null);
		try {
			t.call(null);
		} finally {
			Pr(e), Ir(n);
		}
	}
}
function xr(e, t = !1) {
	var n = e.first;
	for (e.first = e.last = null; n !== null;) {
		let e = n.ac;
		e !== null && $t(() => {
			e.abort(st);
		});
		var r = n.next;
		n.f & 64 ? n.parent = null : Cr(n, t), n = r;
	}
}
function Sr(e) {
	for (var t = e.first; t !== null;) {
		var n = t.next;
		t.f & 32 || Cr(t), t = n;
	}
}
function Cr(e, t = !0) {
	var n = !1;
	(t || e.f & 262144) && e.nodes !== null && e.nodes.end !== null && (wr(e.nodes.start, e.nodes.end), n = !0), e.f |= We, xr(e, t && !n), $r(e, 0);
	var r = e.nodes && e.nodes.t;
	if (r !== null) for (let e of r) e.stop();
	br(e), e.f ^= We, e.f |= He;
	var i = e.parent;
	i !== null && i.first !== null && Tr(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = e.b = null;
}
function wr(e, t) {
	for (; e !== null;) {
		var n = e === t ? null : /* @__PURE__ */ nr(e);
		e.remove(), e = n;
	}
}
function Tr(e) {
	var t = e.parent, n = e.prev, r = e.next;
	n !== null && (n.next = r), r !== null && (r.prev = n), t !== null && (t.first === e && (t.first = r), t.last === e && (t.last = n));
}
function Er(e, t, n = !0) {
	var r = [];
	Dr(e, r, !0);
	var i = () => {
		n && Cr(e), t && t();
	}, a = r.length;
	if (a > 0) {
		var o = () => --a || i();
		for (var s of r) s.out(o);
	} else i();
}
function Dr(e, t, n) {
	if (!(e.f & 8192)) {
		e.f ^= Ve;
		var r = e.nodes && e.nodes.t;
		if (r !== null) for (let e of r) (e.is_global || n) && t.push(e);
		for (var i = e.first; i !== null;) {
			var a = i.next;
			if (!(i.f & 64)) {
				var o = !!(i.f & 65536) || !!(i.f & 32) && !!(e.f & 16);
				Dr(i, t, o ? n : !1);
			}
			i = a;
		}
	}
}
function Or(e) {
	kr(e, !0);
}
function kr(e, t) {
	if (e.f & 8192) {
		e.f ^= Ve, e.f & 1024 || (Gt(e, ze), kn.ensure().schedule(e));
		for (var n = e.first; n !== null;) {
			var r = n.next, i = !!(n.f & 65536) || !!(n.f & 32);
			kr(n, i ? t : !1), n = r;
		}
		var a = e.nodes && e.nodes.t;
		if (a !== null) for (let e of a) (e.is_global || t) && e.in();
	}
}
function Ar(e, t) {
	if (e.nodes) for (var n = e.nodes.start, r = e.nodes.end; n !== null;) {
		var i = n === r ? null : /* @__PURE__ */ nr(n);
		t.append(n), n = i;
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/legacy.js
var jr = null, Mr = !1, Nr = !1;
function Pr(e) {
	Nr = e;
}
var z = null, Fr = !1;
function Ir(e) {
	z = e;
}
var B = null;
function Lr(e) {
	B = e;
}
var Rr = null;
function zr(e) {
	z !== null && (Rr ??= /* @__PURE__ */ new Set()).add(e);
}
var Br = null, Vr = 0, Hr = null;
function Ur(e) {
	Hr = e;
}
var Wr = 1, Gr = 0, Kr = Gr;
function qr(e) {
	Kr = e;
}
function Jr() {
	return ++Wr;
}
function Yr(e) {
	var t = e.f;
	if (t & 2048) return !0;
	if (t & 2 && (e.f &= ~Ye), t & 4096) {
		for (var n = e.deps, r = n.length, i = 0; i < r; i++) {
			var a = n[i];
			if (Yr(a) && gn(a), a.wv > e.wv) return !0;
		}
		t & 512 && xn === null && Gt(e, Re);
	}
	return !1;
}
function Xr(e, t, n = !0) {
	var r = e.reactions;
	if (r !== null && !(Rr !== null && Rr.has(e))) for (var i = 0; i < r.length; i++) {
		var a = r[i];
		a.f & 2 ? Xr(a, t, !1) : t === a && (n ? Gt(a, ze) : a.f & 1024 && Gt(a, Be), Pn(a));
	}
}
function Zr(e) {
	var t = Br, n = Vr, r = Hr, i = z, a = Rr, o = Ft, s = Fr, c = Kr, l = e.f;
	Br = null, Vr = 0, Hr = null, z = l & 96 ? null : e, Rr = null, It(e.ctx), Fr = !1, Kr = ++Gr, e.ac !== null && ($t(() => {
		e.ac.abort(st);
	}), e.ac = null);
	try {
		e.f |= Xe;
		var u = e.fn, d = u();
		e.f |= Ue;
		var f = e.deps, p = M?.is_fork;
		if (Br !== null) {
			var m;
			if (p || $r(e, Vr), f !== null && Vr > 0) for (f.length = Vr + Br.length, m = 0; m < Br.length; m++) f[Vr + m] = Br[m];
			else e.deps = f = Br;
			if (ur() && e.f & 512) for (m = Vr; m < f.length; m++) (f[m].reactions ??= []).push(e);
		} else !p && f !== null && Vr < f.length && ($r(e, Vr), f.length = Vr);
		if (Lt() && Hr !== null && !Fr && f !== null && !(e.f & 6146)) for (m = 0; m < Hr.length; m++) Xr(Hr[m], e);
		if (i !== null && i !== e) {
			if (Gr++, i.deps !== null) for (let e = 0; e < n; e += 1) i.deps[e].rv = Gr;
			if (t !== null) for (let e of t) e.rv = Gr;
			Hr !== null && (r === null ? r = Hr : r.push(...Hr));
		}
		return e.f & 8388608 && (e.f ^= Qe), d;
	} catch (e) {
		return Ht(e);
	} finally {
		e.f ^= Xe, Br = t, Vr = n, Hr = r, z = i, Rr = a, It(o), Fr = s, Kr = c;
	}
}
function Qr(e, t) {
	let n = t.reactions;
	if (n !== null) {
		var r = we.call(n, e);
		if (r !== -1) {
			var i = n.length - 1;
			i === 0 ? n = t.reactions = null : (n[r] = n[i], n.pop());
		}
	}
	if (n === null && t.f & 2 && (Br === null || !Te.call(Br, t))) {
		var a = t;
		a.f & 512 && (a.f ^= 512, a.f &= ~Ye), a.v !== xt && Kt(a), a.ac !== null && $t(() => {
			a.ac.abort(st), a.ac = null, Gt(a, ze);
		}), _n(a), $r(a, 0);
	}
}
function $r(e, t) {
	var n = e.deps;
	if (n !== null) for (var r = t; r < n.length; r++) Qr(e, n[r]);
}
function ei(e) {
	var t = e.f;
	if (!(t & 16384)) {
		Gt(e, Re);
		var n = B, r = Mr;
		B = e, Mr = !(t & 96);
		try {
			t & 16777232 ? Sr(e) : xr(e), br(e);
			var i = Zr(e);
			e.teardown = typeof i == "function" ? i : null, e.wv = Wr;
		} finally {
			Mr = r, B = n;
		}
	}
}
async function ti() {
	await Promise.resolve(), An();
}
function V(e) {
	var t = !!(e.f & 2);
	if (jr?.add(e), z !== null && !Fr && !(B !== null && B.f & 16384) && (Rr === null || !Rr.has(e))) {
		var n = z.deps;
		if (z.f & 2097152) e.rv < Gr && (e.rv = Gr, Br === null && n !== null && n[Vr] === e ? Vr++ : Br === null ? Br = [e] : Br.push(e));
		else {
			z.deps ??= [], Te.call(z.deps, e) || z.deps.push(e);
			var r = e.reactions;
			r === null ? e.reactions = [z] : Te.call(r, z) || r.push(z);
		}
	}
	if (Nr && Rn.has(e)) return Rn.get(e);
	if (t) {
		var i = e;
		if (Nr) {
			var a = i.v;
			return (!(i.f & 1024) && i.reactions !== null || ri(i)) && (a = hn(i)), Rn.set(i, a), a;
		}
		var o = !(i.f & 512) && !Fr && z !== null && (Mr || !!(z.f & 512)), s = (i.f & Ue) === 0;
		Yr(i) && (o && (i.f |= 512), gn(i)), o && !s && (vn(i), ni(i));
	}
	if (xn?.has(e)) return xn.get(e);
	if (e.f & 8388608) throw e.v;
	return e.v;
}
function ni(e) {
	if (e.f |= 512, e.deps !== null) for (let t of e.deps) (t.reactions ??= []).push(e), t.f & 2 && !(t.f & 512) && (vn(t), ni(t));
}
function ri(e) {
	if (e.v === xt) return !0;
	if (e.deps === null) return !1;
	for (let t of e.deps) if (Rn.has(t) || t.f & 2 && ri(t)) return !0;
	return !1;
}
function ii(e) {
	var t = Fr;
	try {
		return Fr = !0, e();
	} finally {
		Fr = t;
	}
}
function ai(e) {
	if (!(typeof e != "object" || !e || e instanceof EventTarget)) {
		if ($e in e) oi(e);
		else if (!Array.isArray(e)) for (let t in e) {
			let n = e[t];
			typeof n == "object" && n && $e in n && oi(n);
		}
	}
}
function oi(e, t = /* @__PURE__ */ new Set()) {
	if (typeof e == "object" && e && !(e instanceof EventTarget) && !t.has(e)) {
		t.add(e), e instanceof Date && e.getTime();
		for (let n in e) try {
			oi(e[n], t);
		} catch {}
		let n = Me(e);
		if (n !== Object.prototype && n !== Array.prototype && n !== Map.prototype && n !== Set.prototype && n !== Date.prototype) {
			let t = ke(n);
			for (let n in t) {
				let r = t[n].get;
				if (r) try {
					r.call(e);
				} catch {}
			}
		}
	}
}
[.../* @__PURE__ */ "allowfullscreen.async.autofocus.autoplay.checked.controls.default.disabled.formnovalidate.indeterminate.inert.ismap.loop.multiple.muted.nomodule.novalidate.open.playsinline.readonly.required.reversed.seamless.selected.webkitdirectory.defer.disablepictureinpicture.disableremoteplayback".split(".")];
var si = ["touchstart", "touchmove"];
function ci(e) {
	return si.includes(e);
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/events.js
var li = Symbol("events"), ui = /* @__PURE__ */ new Set(), di = /* @__PURE__ */ new Set();
function fi(e, t, n, r = {}) {
	function i(e) {
		if (r.capture || gi.call(t, e), !e.cancelBubble) return $t(() => n?.call(this, e));
	}
	return e.startsWith("pointer") || e.startsWith("touch") || e === "wheel" ? Bt(() => {
		t.addEventListener(e, i, r);
	}) : t.addEventListener(e, i, r), i;
}
function pi(e, t, n, r, i) {
	var a = {
		capture: r,
		passive: i
	}, o = fi(e, t, n, a);
	(t === document.body || t === window || t === document || t instanceof HTMLMediaElement) && dr(() => {
		t.removeEventListener(e, o, a);
	});
}
function H(e, t, n) {
	(t[li] ??= {})[e] = n;
}
function U(e) {
	for (var t = 0; t < e.length; t++) ui.add(e[t]);
	for (var n of di) n(e);
}
var mi = null, hi = !1;
function gi(e) {
	var t = this, n = t.ownerDocument, r = e.type, i = e.composedPath?.() || [], a = i[0] || e.target;
	mi = e, hi || (hi = !0, setTimeout(() => {
		hi = !1, mi = null;
	}));
	var o = 0, s = mi === e && e[li];
	if (s) {
		var c = i.indexOf(s);
		if (c !== -1 && (t === document || t === window)) {
			e[li] = t;
			return;
		}
		var l = i.indexOf(t);
		if (l === -1) return;
		c <= l && (o = c);
	}
	if (a = i[o] || e.target, a !== t) {
		De(e, "currentTarget", {
			configurable: !0,
			get() {
				return a || n;
			}
		});
		var u = z, d = B;
		Ir(null), Lr(null);
		try {
			for (var f, p = []; a !== null && a !== t;) {
				try {
					var m = a[li]?.[r];
					m != null && (!a.disabled || e.target === a) && m.call(a, e);
				} catch (e) {
					f ? p.push(e) : f = e;
				}
				if (e.cancelBubble) break;
				o++, a = o < i.length ? i[o] : null;
			}
			if (f) {
				for (let e of p) queueMicrotask(() => {
					throw e;
				});
				throw f;
			}
		} finally {
			e[li] = t, delete e.currentTarget, Ir(u), Lr(d);
		}
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/reconciler.js
var _i = globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", { createHTML: (e) => e });
function vi(e) {
	return _i?.createHTML(e) ?? e;
}
function yi(e) {
	var t = ar("template");
	return t.innerHTML = vi(e.replaceAll("<!>", "<!---->")), t.content;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/template.js
function bi(e, t) {
	var n = B;
	n.nodes === null && (n.nodes = {
		start: e,
		end: t,
		a: null,
		t: null
	});
}
/*#__NO_SIDE_EFFECTS__*/
function W(e, t) {
	var n = !!(t & 1), r = !!(t & 2), i, a = !e.startsWith("<!>");
	return () => {
		if (E) return bi(D, null), D;
		i === void 0 && (i = yi(a ? e : "<!>" + e), n || (i = /* @__PURE__ */ tr(i)));
		var t = r || Xn ? document.importNode(i, !0) : i.cloneNode(!0);
		if (n) {
			var o = /* @__PURE__ */ tr(t), s = t.lastChild;
			bi(o, s);
		} else bi(t, t);
		return t;
	};
}
function xi(e = "") {
	if (!E) {
		var t = er(e + "");
		return bi(t, t), t;
	}
	var n = D;
	return n.nodeType === 3 ? or(n) : (n.before(n = er()), Dt(n)), bi(n, n), n;
}
function Si() {
	if (E) return bi(D, null), D;
	var e = document.createDocumentFragment(), t = document.createComment(""), n = er();
	return e.append(t, n), bi(t, n), e;
}
function G(e, t) {
	if (E) {
		var n = B;
		(!(n.f & 32768) || n.nodes.end === null) && (n.nodes.end = D), Ot();
		return;
	}
	e !== null && e.before(t);
}
function Ci() {
	if (E && D && D.nodeType === 8 && D.textContent?.startsWith("$")) {
		let e = D.textContent.substring(1);
		return Ot(), e;
	}
	return (window.__svelte ??= {}).uid ??= 1, `c${window.__svelte.uid++}`;
}
function K(e, t) {
	var n = t == null ? "" : typeof t == "object" ? `${t}` : t;
	n !== (e[at] ??= e.nodeValue) && (e[at] = n, e.nodeValue = `${n}`);
}
function wi(e, t) {
	return Ei(e, t);
}
var Ti = /* @__PURE__ */ new Map();
function Ei(e, { target: t, anchor: n, props: r = {}, events: i, context: a, intro: o = !0, transformError: s }) {
	$n();
	var c = void 0, l = mr(() => {
		var o = n ?? t.appendChild(er());
		rn(o, { pending: () => {} }, (t) => {
			k({});
			var n = Ft;
			if (a && (n.c = a), i && (r.$$events = i), E && bi(t, null), c = e(t, r) || {}, E && (B.nodes.end = D, D === null || D.nodeType !== 8 || D.data !== "]")) throw wt(), bt;
			A();
		}, s);
		var l = /* @__PURE__ */ new Set(), u = (e) => {
			for (var n = 0; n < e.length; n++) {
				var r = e[n];
				if (!l.has(r)) {
					l.add(r);
					var i = ci(r);
					for (let e of [t, document]) {
						var a = Ti.get(e);
						a === void 0 && (a = /* @__PURE__ */ new Map(), Ti.set(e, a));
						var o = a.get(r);
						o === void 0 ? (e.addEventListener(r, gi, { passive: i }), a.set(r, 1)) : a.set(r, o + 1);
					}
				}
			}
		};
		return u(Ee(ui)), di.add(u), () => {
			for (var e of l) for (let n of [t, document]) {
				var r = Ti.get(n), i = r.get(e);
				--i == 0 ? (n.removeEventListener(e, gi), r.delete(e), r.size === 0 && Ti.delete(n)) : r.set(e, i);
			}
			di.delete(u), o !== n && o.parentNode?.removeChild(o);
		};
	});
	return Di.set(c, l), c;
}
var Di = /* @__PURE__ */ new WeakMap();
function Oi(e, t) {
	let n = Di.get(e);
	return n ? (Di.delete(e), n(t)) : Promise.resolve();
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/branches.js
var ki = class {
	anchor;
	#e = /* @__PURE__ */ new Map();
	#t = /* @__PURE__ */ new Map();
	#n = /* @__PURE__ */ new Map();
	#r = /* @__PURE__ */ new Set();
	#i = !0;
	constructor(e, t = !0) {
		this.anchor = e, this.#i = t;
	}
	#a = (e) => {
		if (this.#e.has(e)) {
			var t = this.#e.get(e), n = this.#t.get(t);
			if (n) Or(n), this.#r.delete(t);
			else {
				var r = this.#n.get(t);
				r && (Or(r.effect), this.#t.set(t, r.effect), this.#n.delete(t), r.fragment.lastChild.remove(), this.anchor.before(r.fragment), n = r.effect);
			}
			for (let [t, n] of this.#e) {
				if (this.#e.delete(t), t === e) break;
				let r = this.#n.get(n);
				r && (Cr(r.effect), this.#n.delete(n));
			}
			for (let [e, r] of this.#t) {
				if (e === t || this.#r.has(e)) continue;
				let i = () => {
					if (Array.from(this.#e.values()).includes(e)) {
						var t = document.createDocumentFragment();
						Ar(r, t), t.append(er()), this.#n.set(e, {
							effect: r,
							fragment: t
						});
					} else Cr(r);
					this.#r.delete(e), this.#t.delete(e);
				};
				this.#i || !n ? (this.#r.add(e), Er(r, i, !1)) : i();
			}
		}
	};
	#o = (e) => {
		this.#e.delete(e);
		let t = Array.from(this.#e.values());
		for (let [e, n] of this.#n) t.includes(e) || (Cr(n.effect), this.#n.delete(e));
	};
	ensure(e, t) {
		var n = M, r = ir();
		if (t && !this.#t.has(e) && !this.#n.has(e)) {
			if (r) {
				var i = document.createDocumentFragment(), a = er();
				i.append(a), this.#n.set(e, {
					effect: yr(() => t(a)),
					fragment: i
				});
			} else this.#t.set(e, yr(() => t(this.anchor)));
		}
		if (this.#e.set(n, e), r) {
			for (let [t, r] of this.#t) t === e ? n.unskip_effect(r) : n.skip_effect(r);
			for (let [t, r] of this.#n) t === e ? n.unskip_effect(r.effect) : n.skip_effect(r.effect);
			n.oncommit(this.#a), n.ondiscard(this.#o);
		} else E && (this.anchor = D), this.#a(n);
	}
};
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/if.js
function q(e, t, n = !1) {
	var r;
	E && (r = D, Ot());
	var i = new ki(e), a = n ? Ge : 0;
	function o(e, t) {
		if (E) {
			var n = jt(r);
			if (e !== parseInt(n.substring(1))) {
				var a = At();
				Dt(a), i.anchor = a, Et(!1), i.ensure(e, t), Et(!0);
				return;
			}
		}
		i.ensure(e, t);
	}
	vr(() => {
		var e = !1;
		t((t, n = 0) => {
			e = !0, o(n, t);
		}), e || o(-1, null);
	}, a);
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/key.js
var Ai = Symbol("NaN");
function ji(e, t, n) {
	E && Ot();
	var r = new ki(e), i = !Lt();
	vr(() => {
		var e = t();
		e !== e && (e = Ai), i && typeof e == "object" && e && (e = {}), r.ensure(e, n);
	});
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/each.js
function Mi(e, t) {
	return t;
}
function Ni(e, t, n) {
	for (var r = [], i = t.length, a, o = t.length, s = 0; s < i; s++) {
		let n = t[s];
		Er(n, () => {
			if (a) {
				if (a.pending.delete(n), a.done.add(n), a.pending.size === 0) {
					var t = e.outrogroups;
					Pi(e, Ee(a.done)), t.delete(a), t.size === 0 && (e.outrogroups = null);
				}
			} else --o;
		}, !1);
	}
	if (o === 0) {
		var c = r.length === 0 && n !== null && e.pending.size === 0;
		if (c) {
			var l = n, u = l.parentNode;
			rr(u), u.append(l), e.items.clear();
		}
		Pi(e, t, !c);
	} else a = {
		pending: new Set(t),
		done: /* @__PURE__ */ new Set()
	}, (e.outrogroups ??= /* @__PURE__ */ new Set()).add(a);
}
function Pi(e, t, n = !0) {
	var r;
	if (e.pending.size > 0) {
		r = /* @__PURE__ */ new Set();
		for (let t of e.pending.values()) for (let n of t) r.add(e.items.get(n).e);
	}
	for (var i = 0; i < t.length; i++) {
		var a = t[i];
		r?.has(a) ? (a.f |= Je, Ar(a, document.createDocumentFragment())) : Cr(t[i], n);
	}
}
var Fi;
function J(e, t, n, r, i, a = null) {
	var o = e, s = /* @__PURE__ */ new Map();
	if (t & 4) {
		var c = e;
		o = E ? Dt(/* @__PURE__ */ tr(c)) : c.appendChild(er());
	}
	E && Ot();
	var l = null, u = /* @__PURE__ */ pn(() => {
		var e = n();
		return Ce(e) ? e : e == null ? [] : Ee(e);
	}), d, f = /* @__PURE__ */ new Map(), p = !0;
	function m(e) {
		g.effect.f & 16384 || (g.pending.delete(e), g.fallback = l, Li(g, d, o, t, r), l !== null && (d.length === 0 ? l.f & 33554432 ? (l.f ^= Je, zi(l, null, o)) : Or(l) : Er(l, () => {
			l = null;
		})));
	}
	function h(e) {
		g.pending.delete(e);
	}
	var g = {
		effect: vr(() => {
			d = V(u);
			var e = d.length;
			let c = !1;
			E && jt(o) === "[!" != (e === 0) && (o = At(), Dt(o), Et(!1), c = !0);
			for (var g = /* @__PURE__ */ new Set(), _ = M, v = ir(), y = 0; y < e; y += 1) {
				E && D.nodeType === 8 && D.data === "]" && (o = D, c = !0, Et(!1));
				var b = d[y], x = r(b, y), S = p ? null : s.get(x);
				S ? (S.v && Hn(S.v, b), S.i && Hn(S.i, y), v && _.unskip_effect(S.e)) : (S = Ri(s, p ? o : Fi ??= er(), b, x, y, i, t, n), p || (S.e.f |= Je), s.set(x, S)), g.add(x);
			}
			if (e === 0 && a && !l && (p ? l = yr(() => a(o)) : (l = yr(() => a(Fi ??= er())), l.f |= Je)), e > g.size && ut("", "", ""), E && e > 0 && Dt(At()), !p) {
				if (f.set(_, g), v) {
					for (let [e, t] of s) g.has(e) || _.skip_effect(t.e);
					_.oncommit(m), _.ondiscard(h);
				} else m(_);
			}
			c && Et(!0), V(u);
		}),
		flags: t,
		items: s,
		pending: f,
		outrogroups: null,
		fallback: l
	};
	p = !1, E && (o = D);
}
function Ii(e) {
	for (; e !== null && !(e.f & 32);) e = e.next;
	return e;
}
function Li(e, t, n, r, i) {
	var a = !!(r & 8), o = t.length, s = e.items, c = Ii(e.effect.first), l, u = null, d, f = [], p = [], m, h, g, _;
	if (a) for (_ = 0; _ < o; _ += 1) m = t[_], h = i(m, _), g = s.get(h).e, g.f & 33554432 || (g.nodes?.a?.measure(), (d ??= /* @__PURE__ */ new Set()).add(g));
	for (_ = 0; _ < o; _ += 1) {
		if (m = t[_], h = i(m, _), g = s.get(h).e, e.outrogroups !== null) for (let t of e.outrogroups) t.pending.delete(g), t.done.delete(g);
		if (g.f & 8192 && (Or(g), a && (g.nodes?.a?.unfix(), (d ??= /* @__PURE__ */ new Set()).delete(g))), g.f & 33554432) {
			if (g.f ^= Je, g === c) zi(g, null, n);
			else {
				var v = u ? u.next : c;
				g === e.effect.last && (e.effect.last = g.prev), g.prev && (g.prev.next = g.next), g.next && (g.next.prev = g.prev), Bi(e, u, g), Bi(e, g, v), zi(g, v, n), u = g, f = [], p = [], c = Ii(u.next);
				continue;
			}
		}
		if (g !== c) {
			if (l !== void 0 && l.has(g)) {
				if (f.length < p.length) {
					var y = p[0], b;
					u = y.prev;
					var x = f[0], S = f[f.length - 1];
					for (b = 0; b < f.length; b += 1) zi(f[b], y, n);
					for (b = 0; b < p.length; b += 1) l.delete(p[b]);
					Bi(e, x.prev, S.next), Bi(e, u, x), Bi(e, S, y), c = y, u = S, --_, f = [], p = [];
				} else l.delete(g), zi(g, c, n), Bi(e, g.prev, g.next), Bi(e, g, u === null ? e.effect.first : u.next), Bi(e, u, g), u = g;
				continue;
			}
			for (f = [], p = []; c !== null && c !== g;) (l ??= /* @__PURE__ */ new Set()).add(c), p.push(c), c = Ii(c.next);
			if (c === null) continue;
		}
		g.f & 33554432 || f.push(g), u = g, c = Ii(g.next);
	}
	if (e.outrogroups !== null) {
		for (let t of e.outrogroups) t.pending.size === 0 && (Pi(e, Ee(t.done)), e.outrogroups?.delete(t));
		e.outrogroups.size === 0 && (e.outrogroups = null);
	}
	if (c !== null || l !== void 0) {
		var C = [];
		if (l !== void 0) for (g of l) g.f & 8192 || C.push(g);
		for (; c !== null;) !(c.f & 8192) && c !== e.fallback && C.push(c), c = Ii(c.next);
		var w = C.length;
		if (w > 0) {
			var T = r & 4 && o === 0 ? n : null;
			if (a) {
				for (_ = 0; _ < w; _ += 1) C[_].nodes?.a?.measure();
				for (_ = 0; _ < w; _ += 1) C[_].nodes?.a?.fix();
			}
			Ni(e, C, T);
		}
	}
	a && Bt(() => {
		if (d !== void 0) for (g of d) g.nodes?.a?.apply();
	});
}
function Ri(e, t, n, r, i, a, o, s) {
	var c = o & 1 ? o & 16 ? Bn(n) : /* @__PURE__ */ Vn(n, !1, !1) : null, l = o & 2 ? Bn(i) : null;
	return {
		v: c,
		i: l,
		e: yr(() => (a(t, c ?? n, l ?? i, s), () => {
			e.delete(r);
		}))
	};
}
function zi(e, t, n) {
	if (e.nodes) for (var r = e.nodes.start, i = e.nodes.end, a = t && !(t.f & 33554432) ? t.nodes.start : n; r !== null;) {
		var o = /* @__PURE__ */ nr(r);
		if (a.before(r), r === i) return;
		r = o;
	}
}
function Bi(e, t, n) {
	t === null ? e.effect.first = n : t.next = n, n === null ? e.effect.last = t : n.prev = t;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/snippet.js
function Vi(e, t, ...n) {
	var r = new ki(e);
	vr(() => {
		let e = t() ?? null;
		r.ensure(e, e && ((t) => e(t, ...n)));
	}, Ge);
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/actions.js
function Y(e, t, n) {
	hr(() => {
		var r = ii(() => t(e, n?.()) || {});
		if (n && r?.update) {
			var i = !1, a = {};
			_r(() => {
				var e = n();
				ai(e), i && Nt(a, e) && (a = e, r.update(e));
			}), i = !0;
		}
		if (r?.destroy) return () => r.destroy();
	});
}
//#endregion
//#region node_modules/clsx/dist/clsx.mjs
function Hi(e) {
	var t, n, r = "";
	if (typeof e == "string" || typeof e == "number") r += e;
	else if (typeof e == "object") {
		if (Array.isArray(e)) {
			var i = e.length;
			for (t = 0; t < i; t++) e[t] && (n = Hi(e[t])) && (r && (r += " "), r += n);
		} else for (n in e) e[n] && (r && (r += " "), r += n);
	}
	return r;
}
function Ui() {
	for (var e, t, n = 0, r = "", i = arguments.length; n < i; n++) (e = arguments[n]) && (t = Hi(e)) && (r && (r += " "), r += t);
	return r;
}
//#endregion
//#region node_modules/svelte/src/internal/shared/attributes.js
function Wi(e) {
	return typeof e == "object" ? Ui(e) : e ?? "";
}
var Gi = [..." 	\n\r\f\xA0\v﻿"];
function Ki(e, t, n) {
	var r = e == null ? "" : "" + e;
	if (t && (r = r ? r + " " + t : t), n) {
		for (var i of Object.keys(n)) if (n[i]) r = r ? r + " " + i : i;
		else if (r.length) for (var a = i.length, o = 0; (o = r.indexOf(i, o)) >= 0;) {
			var s = o + a;
			(o === 0 || Gi.includes(r[o - 1])) && (s === r.length || Gi.includes(r[s])) ? r = (o === 0 ? "" : r.substring(0, o)) + r.substring(s + 1) : o = s;
		}
	}
	return r === "" ? null : r;
}
function qi(e, t = !1) {
	var n = t ? " !important;" : ";", r = "";
	for (var i of Object.keys(e)) {
		var a = e[i];
		a != null && a !== "" && (r += " " + i + ": " + a + n);
	}
	return r;
}
function Ji(e) {
	return e[0] !== "-" || e[1] !== "-" ? e.toLowerCase() : e;
}
function Yi(e, t) {
	if (t) {
		var n = "", r, i;
		if (Array.isArray(t) ? (r = t[0], i = t[1]) : r = t, e) {
			e = String(e).replaceAll(/\/\*.*?\*\//g, "").trim();
			var a = !1, o = 0, s = !1, c = [];
			r && c.push(...Object.keys(r).map(Ji)), i && c.push(...Object.keys(i).map(Ji));
			var l = 0, u = -1;
			let t = e.length;
			for (var d = 0; d < t; d++) {
				var f = e[d];
				if (s ? f === "/" && e[d - 1] === "*" && (s = !1) : a ? a === f && (a = !1) : f === "/" && e[d + 1] === "*" ? s = !0 : f === "\"" || f === "'" ? a = f : f === "(" ? o++ : f === ")" && o--, !s && a === !1 && o === 0) {
					if (f === ":" && u === -1) u = d;
					else if (f === ";" || d === t - 1) {
						if (u !== -1) {
							var p = Ji(e.substring(l, u).trim());
							if (!c.includes(p)) {
								f !== ";" && d++;
								var m = e.substring(l, d).trim();
								n += " " + m + ";";
							}
						}
						l = d + 1, u = -1;
					}
				}
			}
		}
		return r && (n += qi(r)), i && (n += qi(i, !0)), n = n.trim(), n === "" ? null : n;
	}
	return e == null ? null : String(e);
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/class.js
function X(e, t, n, r, i, a) {
	var o = e[rt];
	if (E || o !== n || o === void 0) {
		var s = Ki(n, r, a);
		(!E || s !== e.getAttribute("class")) && (s == null ? e.removeAttribute("class") : t ? e.className = s : e.setAttribute("class", s)), e[rt] = n;
	} else if (a && i !== a) for (var c in a) {
		var l = !!a[c];
		(i == null || l !== !!i[c]) && e.classList.toggle(c, l);
	}
	return a;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/style.js
function Xi(e, t = {}, n, r) {
	for (var i in n) {
		var a = n[i];
		t[i] !== a && (n[i] == null ? e.style.removeProperty(i) : e.style.setProperty(i, a, r));
	}
}
function Zi(e, t, n, r) {
	var i = e[it];
	if (E || i !== t) {
		var a = Yi(t, r);
		(!E || a !== e.getAttribute("style")) && (a == null ? e.removeAttribute("style") : e.style.cssText = a), e[it] = t;
	} else r && (Array.isArray(r) ? (Xi(e, n?.[0], r[0]), Xi(e, n?.[1], r[1], "important")) : Xi(e, n, r));
	return r;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/attributes.js
var Qi = Symbol("is custom element"), $i = Symbol("is html"), ea = ct ? "link" : "LINK";
function ta(e) {
	if (E) {
		var t = !1, n = () => {
			if (!t) {
				if (t = !0, e.hasAttribute("value")) {
					var n = e.value;
					Z(e, "value", null), e.value = n;
				}
				if (e.hasAttribute("checked")) {
					var r = e.checked;
					Z(e, "checked", null), e.checked = r;
				}
			}
		};
		e[ot] = n, Bt(n), Qt();
	}
}
function na(e, t) {
	var n = ra(e);
	n.checked !== (n.checked = t ?? void 0) && (e.checked = t);
}
function Z(e, t, n, r) {
	var i = ra(e);
	E && (i[t] = e.getAttribute(t), t === "src" || t === "srcset" || t === "href" && e.nodeName === ea) || i[t] !== (i[t] = n) && (t === "loading" && (e[tt] = n), n == null ? e.removeAttribute(t) : typeof n != "string" && aa(e).includes(t) ? e[t] = n : e.setAttribute(t, n));
}
function ra(e) {
	return e[nt] ??= {
		[Qi]: e.nodeName.includes("-"),
		[$i]: e.namespaceURI === St
	};
}
var ia = /* @__PURE__ */ new Map();
function aa(e) {
	var t = e.getAttribute("is") || e.nodeName, n = ia.get(t);
	if (n) return n;
	ia.set(t, n = []);
	for (var r, i = e, a = Element.prototype; a !== i;) {
		for (var o in r = ke(i), r) r[o].set && o !== "innerHTML" && o !== "textContent" && o !== "innerText" && n.push(o);
		i = Me(i);
	}
	return n;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/bindings/input.js
function oa(e, t, n = t) {
	var r = /* @__PURE__ */ new WeakSet();
	en(e, "input", async (i) => {
		var a = i ? e.defaultValue : e.value;
		if (a = sa(e) ? ca(a) : a, n(a), M !== null && r.add(M), await ti(), a !== (a = t())) {
			var o = e.selectionStart, s = e.selectionEnd, c = e.value.length;
			if (e.value = a ?? "", s !== null) {
				var l = e.value.length;
				o === s && s === c && l > c ? (e.selectionStart = l, e.selectionEnd = l) : (e.selectionStart = o, e.selectionEnd = Math.min(s, l));
			}
		}
	}), (E && e.defaultValue !== e.value || ii(t) == null && e.value) && (n(sa(e) ? ca(e.value) : e.value), M !== null && r.add(M)), _r(() => {
		var n = t();
		if (e === document.activeElement) {
			var i = M;
			if (r.has(i)) return;
		}
		sa(e) && n === ca(e.value) || e.type === "date" && !n && !e.value || n !== e.value && (e.value = n ?? "");
	});
}
function sa(e) {
	var t = e.type;
	return t === "number" || t === "range";
}
function ca(e) {
	return e === "" ? null : +e;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/bindings/this.js
function la(e, t) {
	return e === t || e?.[$e] === t;
}
function ua(e = {}, t, n, r) {
	var i = Ft.r, a = B;
	return hr(() => {
		var o, s;
		return _r(() => {
			o = s, s = r?.() || [], ii(() => {
				la(n(...s), e) || (t(e, ...s), o && la(n(...o), e) && t(null, ...o));
			});
		}), () => {
			let r = a;
			for (; r !== i && r.parent !== null && r.parent.f & 33554432;) r = r.parent;
			let o = () => {
				s && la(n(...s), e) && t(null, ...s);
			}, c = r.teardown;
			r.teardown = () => {
				o(), c?.();
			};
		};
	}), e;
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/props.js
function da(e, t, n, r) {
	var i = !0, a = !!(n & 8), o = !!(n & 16), s = r, c = !0, l = void 0, u = () => o && i ? (l ??= /* @__PURE__ */ un(r), V(l)) : (c && (c = !1, s = o ? ii(r) : r), s);
	let d;
	if (a) {
		var f = $e in e || et in e;
		d = Oe(e, t)?.set ?? (f && t in e ? (n) => e[t] = n : void 0);
	}
	var p, m = !1;
	a ? [p, m] = Xt(() => e[t]) : p = e[t], p === void 0 && r !== void 0 && (p = u(), d && (i && ht(t), d(p)));
	var h = i ? () => {
		var n = e[t];
		return n === void 0 ? u() : (c = !0, n);
	} : () => {
		var n = e[t];
		return n !== void 0 && (s = void 0), n === void 0 ? s : n;
	};
	if (i && !(n & 4)) return h;
	if (d) {
		var g = e.$$legacy;
		return (function(e, t) {
			return arguments.length > 0 ? ((!i || !t || g || m) && d(t ? h() : e), e) : h();
		});
	}
	var _ = !1, v = (n & 1 ? un : pn)(() => (_ = !1, h()));
	a && V(v);
	var y = B;
	return (function(e, t) {
		if (arguments.length > 0) {
			let n = t ? V(v) : i && a ? qn(e) : e;
			return P(v, n), _ = !0, s !== void 0 && (s = n), e;
		}
		return Nr && _ || y.f & 16384 ? v.v : V(v);
	});
}
//#endregion
//#region node_modules/svelte/src/internal/disclose-version.js
typeof window < "u" && ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add("5");
//#endregion
//#region app/svelte/NoOp.svelte
var fa = /* @__PURE__ */ W("<span class=\"wd-island-noop\" hidden=\"\"> </span>");
function pa(e, t) {
	k(t, !0);
	let n = da(t, "label", 3, "no-op"), i = /* @__PURE__ */ N(void 0);
	fr(() => {
		V(i) && (V(i).dataset.mounted = "true");
	});
	let a = r()?.tagName ?? "";
	var o = fa(), s = F(o);
	O(o), ua(o, (e) => P(i, e), () => V(i)), R(() => K(s, `${n() ?? ""} ${a ?? ""}`)), G(e, o), A();
}
//#endregion
//#region app/svelte/stores/tree.svelte.ts
var ma = qn({
	activeId: null,
	expanded: {},
	generation: 0
});
function ha(e) {
	if (ma.activeId = e, !e) return;
	let t = e.split("/"), n = "";
	for (let e = 0; e < t.length - 1; e++) n = n ? n + "/" + t[e] : t[e], ma.expanded[n] = !0;
}
function ga() {
	ma.generation++;
}
function _a(e) {
	ma.expanded[e] = !ma.expanded[e];
}
//#endregion
//#region app/svelte/actions/icon.ts
function Q(e, t) {
	let n = null;
	function r(t) {
		n &&= (n.remove(), null), t && (n = t(), n && e.appendChild(n));
	}
	return r(t), {
		update: r,
		destroy: () => {
			n && n.remove();
		}
	};
}
//#endregion
//#region app/svelte/DocLink.svelte
var va = /* @__PURE__ */ W("<span class=\"doc-lock\" aria-label=\"Restricted\"></span>"), ya = /* @__PURE__ */ W("<a> <!></a>");
function ba(e, t) {
	k(t, !0);
	let n = /* @__PURE__ */ j(() => ma.activeId === t.doc.id), r = /* @__PURE__ */ j(() => t.doc.title || t.doc.id.split("/").pop()), i = /* @__PURE__ */ N(void 0);
	fr(() => {
		V(n) && V(i) && V(i).scrollIntoView({ block: "nearest" });
	});
	function a(e) {
		e.metaKey || e.ctrlKey || e.shiftKey || (e.preventDefault(), t.onSelect(t.doc.id));
	}
	var o = ya();
	let s;
	var l = F(o, !0), u = L(l), d = (e) => {
		var t = va();
		Y(t, (e, t) => Q?.(e, t), () => c), G(e, t);
	};
	q(u, (e) => {
		t.doc.locked && e(d);
	}), O(o), ua(o, (e) => P(i, e), () => V(i)), R(() => {
		s = X(o, 1, "doc-link", null, s, { "is-locked": t.doc.locked }), Z(o, "href", `#/${t.doc.id ?? ""}`), Z(o, "data-id", t.doc.id), Z(o, "aria-current", V(n) ? "page" : void 0), Z(o, "title", t.doc.locked ? "Restricted - your account cannot open this page" : void 0), K(l, V(r));
	}), H("click", o, a), G(e, o), A();
}
U(["click"]);
//#endregion
//#region app/svelte/TreeFolder.svelte
var xa = /* @__PURE__ */ W("<!> <!>", 1), Sa = /* @__PURE__ */ W("<details><summary> </summary> <div class=\"group-children\"><!></div></details>");
function Ca(e, t) {
	k(t, !0);
	let n = /* @__PURE__ */ N(qn({
		folders: [],
		docs: []
	})), r = /* @__PURE__ */ N(!1), i = /* @__PURE__ */ j(() => !!ma.expanded[t.path]);
	fr(() => {
		if (ma.generation, !V(i)) return;
		let e = !1;
		return m(t.path).then((t) => {
			e || (P(n, t, !0), P(r, !0));
		}), () => {
			e = !0;
		};
	});
	function a(e) {
		e.currentTarget.open !== V(i) && _a(t.path);
	}
	var o = Sa(), s = F(o), c = F(s, !0);
	O(s);
	var l = L(s, 2), u = F(l), d = (e) => {
		var r = xa(), i = I(r);
		J(i, 16, () => V(n).folders, (e) => e, (e, n) => {
			{
				let r = /* @__PURE__ */ j(() => t.path + "/" + n);
				Ca(e, {
					get name() {
						return n;
					},
					get path() {
						return V(r);
					},
					get onSelect() {
						return t.onSelect;
					}
				});
			}
		}), J(L(i, 2), 17, () => V(n).docs, (e) => e.id, (e, n) => {
			ba(e, {
				get doc() {
					return V(n);
				},
				get onSelect() {
					return t.onSelect;
				}
			});
		}), G(e, r);
	};
	q(u, (e) => {
		V(r) && e(d);
	}), O(l), O(o), R(() => {
		Z(o, "data-path", t.path), o.open = V(i), K(c, t.name);
	}), pi("toggle", o, a), G(e, o), A();
}
//#endregion
//#region app/svelte/DocTree.svelte
var wa = /* @__PURE__ */ W("<!> <!>", 1);
function Ta(e, t) {
	k(t, !0);
	let n = /* @__PURE__ */ N(qn({
		folders: [],
		docs: []
	})), r = /* @__PURE__ */ N(!1);
	fr(() => {
		ma.generation;
		let e = !1;
		return m("").then((t) => {
			if (e) return;
			P(n, t, !0), P(r, !0);
			let i = t.folders[0];
			i && ma.expanded[i] === void 0 && (ma.expanded[i] = !0);
		}), () => {
			e = !0;
		};
	});
	var i = Si(), a = I(i), o = (e) => {
		var r = wa(), i = I(r);
		J(i, 16, () => V(n).folders, (e) => e, (e, n) => {
			Ca(e, {
				get name() {
					return n;
				},
				get path() {
					return n;
				},
				get onSelect() {
					return t.onSelect;
				}
			});
		}), J(L(i, 2), 17, () => V(n).docs, (e) => e.id, (e, n) => {
			ba(e, {
				get doc() {
					return V(n);
				},
				get onSelect() {
					return t.onSelect;
				}
			});
		}), G(e, r);
	};
	q(a, (e) => {
		V(r) && e(o);
	}), G(e, i), A();
}
//#endregion
//#region app/svelte/stores/search.svelte.ts
var Ea = qn({
	query: "",
	hits: [],
	searching: !1
});
function Da(e) {
	Ea.query = e, Ea.searching = !0;
}
function Oa(e) {
	Ea.hits = e, Ea.searching = !1;
}
//#endregion
//#region app/svelte/SearchHit.svelte
var ka = /* @__PURE__ */ W("<span class=\"search-hit-sub\"> </span>"), Aa = /* @__PURE__ */ W("<a><span class=\"search-hit-title\"> </span> <!></a>");
function ja(e, t) {
	k(t, !0);
	function n(e) {
		e.metaKey || e.ctrlKey || e.shiftKey || (e.preventDefault(), t.onSelect(t.hit.docId));
	}
	var r = Aa();
	let i;
	var a = F(r), o = F(a, !0);
	O(a);
	var s = L(a, 2), c = (e) => {
		var n = ka(), r = F(n, !0);
		O(n), R(() => K(r, t.hit.snippet)), G(e, n);
	};
	q(s, (e) => {
		t.hit.snippet && e(c);
	}), O(r), R(() => {
		i = X(r, 1, "search-hit", null, i, { "is-locked": t.hit.locked }), Z(r, "href", `#/${t.hit.docId ?? ""}`), K(o, t.hit.title);
	}), H("click", r, n), G(e, r), A();
}
U(["click"]);
//#endregion
//#region app/svelte/SearchHitList.svelte
var Ma = /* @__PURE__ */ W("<p class=\"search-empty\">Searching…</p>"), Na = /* @__PURE__ */ W("<p class=\"search-empty\"> </p>");
function Pa(e, t) {
	k(t, !0);
	var n = Si(), r = I(n), i = (e) => {
		G(e, Ma());
	}, a = (e) => {
		var t = Na(), n = F(t);
		O(t), R(() => K(n, `No documents match “${Ea.query ?? ""}”.`)), G(e, t);
	}, o = (e) => {
		var n = Si();
		J(I(n), 17, () => Ea.hits, (e) => e.docId, (e, n) => {
			ja(e, {
				get hit() {
					return V(n);
				},
				get onSelect() {
					return t.onSelect;
				}
			});
		}), G(e, n);
	};
	q(r, (e) => {
		Ea.searching ? e(i) : Ea.hits.length ? e(o, -1) : e(a, 1);
	}), G(e, n), A();
}
//#endregion
//#region app/svelte/islands/tree.ts
function Fa(e, t) {
	wi(Ta, {
		target: e,
		props: { onSelect: t }
	});
}
function Ia(e, t) {
	wi(Pa, {
		target: e,
		props: { onSelect: t }
	});
}
//#endregion
//#region app/svelte/Toc.svelte
var La = /* @__PURE__ */ W("<li><a><span class=\"n\"> </span> </a></li>"), Ra = /* @__PURE__ */ W("<ol></ol>");
function za(e, t) {
	k(t, !0);
	let n = da(t, "entries", 19, () => []);
	function r(e, n) {
		e.preventDefault();
		let r = t.contentEl.querySelector("#" + i(n.id));
		r && (r.scrollIntoView({
			block: "start",
			behavior: "smooth"
		}), r.setAttribute("tabindex", "-1"), r.focus({ preventScroll: !0 }));
	}
	function i(e) {
		return window.CSS && window.CSS.escape ? window.CSS.escape(e) : e.replace(/([^\w-])/g, "\\$1");
	}
	var a = Ra();
	J(a, 21, n, (e) => e.id, (e, t) => {
		var n = La(), i = F(n), a = F(i), o = F(a, !0);
		O(a);
		var s = L(a, 1, !0);
		O(i), O(n), R(() => {
			X(n, 1, `lvl-${V(t).level ?? ""}`), Z(i, "href", `#${V(t).id ?? ""}`), Z(i, "data-target", V(t).id), K(o, V(t).number), K(s, V(t).text);
		}), H("click", i, (e) => r(e, V(t))), G(e, n);
	}), O(a), G(e, a), A();
}
U(["click"]);
//#endregion
//#region app/svelte/Crumbs.svelte
function Ba(e, t) {
	k(t, !0);
	let n = da(t, "docId", 3, ""), r = /* @__PURE__ */ j(() => n() ? n().split("/").join(" › ") : "");
	kt();
	var i = xi();
	R(() => K(i, V(r))), G(e, i), A();
}
//#endregion
//#region app/svelte/FootGroup.svelte
var Va = /* @__PURE__ */ W("<li><a> </a></li>"), Ha = /* @__PURE__ */ W("<span class=\"foot-cap\"> </span><ul class=\"foot-links\"></ul>", 1);
function Ua(e, t) {
	k(t, !0);
	let n = da(t, "ids", 19, () => []);
	function r(e) {
		let t = g.byId.get(e);
		return t && t.title || _(e);
	}
	var i = Si(), a = I(i), o = (e) => {
		var i = Ha(), a = I(i), o = F(a, !0);
		O(a);
		var s = L(a);
		J(s, 20, n, (e) => e, (e, t) => {
			var n = Va(), i = F(n), a = F(i, !0);
			O(i), O(n), R((e) => {
				Z(i, "href", `#/${t ?? ""}`), K(a, e);
			}, [() => r(t)]), G(e, n);
		}), O(s), R(() => K(o, t.caption)), G(e, i);
	};
	q(a, (e) => {
		n().length && e(o);
	}), G(e, i), A();
}
//#endregion
//#region app/svelte/stores/shell.svelte.ts
var Wa = qn({
	docId: "",
	toc: [],
	assumes: [],
	next: []
});
function Ga(e) {
	Wa.docId = e;
}
function Ka(e) {
	Wa.toc = e;
}
function qa(e, t) {
	Wa.assumes = e || [], Wa.next = t || [];
}
//#endregion
//#region app/svelte/islands/reader.ts
function Ja(e, t) {
	wi(za, {
		target: e,
		props: {
			get entries() {
				return Wa.toc;
			},
			contentEl: t
		}
	});
}
function Ya(e) {
	wi(Ba, {
		target: e,
		props: { get docId() {
			return Wa.docId;
		} }
	});
}
var Xa = "‹ Assumed knowledge", Za = "Recommended next ›";
function Qa(e, t) {
	wi(Ua, {
		target: e,
		props: {
			caption: Xa,
			get ids() {
				return Wa.assumes;
			}
		}
	}), wi(Ua, {
		target: t,
		props: {
			caption: Za,
			get ids() {
				return Wa.next;
			}
		}
	});
}
//#endregion
//#region app/svelte/stores/auth.svelte.ts
var $a = qn({
	enabled: !1,
	user: null,
	needsBootstrap: !1,
	allowRegistration: !1,
	requireApproval: !1,
	passwordMinLength: 10
});
function eo() {
	let e = y.policy || {};
	$a.enabled = y.enabled, $a.user = y.user ? { ...y.user } : null, $a.needsBootstrap = y.needsBootstrap, $a.allowRegistration = !!e.allowRegistration, $a.requireApproval = !!e.requireApproval, $a.passwordMinLength = e.passwordMinLength || 10;
}
var to = !1;
function no() {
	eo(), !to && (to = !0, w(eo));
}
//#endregion
//#region app/svelte/SignInWall.svelte
var ro = /* @__PURE__ */ W("<div class=\"auth-wall\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Sign in\"><div class=\"auth-card\"><div class=\"auth-brand\"> </div> <h1 class=\"auth-title\">Sign in to continue</h1> <p class=\"auth-sub\">This library is private. Sign in to read and edit documents.</p> <form class=\"auth-form\"><div class=\"modal-field\"><label>Username</label> <input type=\"text\" autocomplete=\"username\" required=\"\"/></div> <div class=\"modal-field\"><label>Password</label> <input type=\"password\" required=\"\"/></div> <div class=\"modal-field\"><label>Display name (optional)</label> <input type=\"text\" autocomplete=\"name\"/></div> <p> </p> <div class=\"auth-actions\"><button class=\"btn btn-primary\" type=\"submit\"> </button></div> <p class=\"auth-switch\"><button class=\"auth-link\" type=\"button\"> </button></p> <p class=\"auth-hint\"> </p></form></div></div>");
function io(e, t) {
	let n = Ci();
	k(t, !0);
	let r = /* @__PURE__ */ N(qn($a.needsBootstrap ? "register" : "sign-in")), i = /* @__PURE__ */ N(""), a = /* @__PURE__ */ N(""), o = /* @__PURE__ */ N(""), s = /* @__PURE__ */ N(!1), c = /* @__PURE__ */ N(""), l = /* @__PURE__ */ N(""), u = /* @__PURE__ */ N(void 0), d = /* @__PURE__ */ N(void 0), f = /* @__PURE__ */ j(() => V(r) === "register"), p = /* @__PURE__ */ j(() => !$a.allowRegistration || $a.needsBootstrap), m = /* @__PURE__ */ j(() => $a.needsBootstrap ? "This server has no accounts yet. The first account created becomes the administrator." : V(f) ? $a.requireApproval ? "New accounts must be approved by an administrator before they can sign in." : "Passwords must be at least " + $a.passwordMinLength + " characters." : "");
	fr(() => {
		let e = window.setTimeout(() => {
			V(u) && V(u).focus();
		}, 30);
		return () => window.clearTimeout(e);
	});
	function h() {
		P(r, V(f) ? "sign-in" : "register", !0), P(c, ""), P(l, "");
	}
	async function _(e) {
		if (e.preventDefault(), V(s)) return;
		P(s, !0), P(l, ""), P(c, V(f) ? "Creating your account…" : "Signing in…", !0);
		let n = V(f) ? await T(V(i).trim(), V(a), V(o).trim()) : await ee(V(i).trim(), V(a));
		if (P(s, !1), !n.ok) {
			P(l, "is-error"), P(c, n.error || "That did not work.", !0), P(a, ""), V(d) && V(d).focus();
			return;
		}
		if (n.pendingApproval) {
			P(l, "is-ok"), P(c, n.message || "Your account is waiting for approval.", !0), P(r, "sign-in"), P(a, "");
			return;
		}
		t.onSignedIn();
	}
	var v = ro(), y = F(v), b = F(y), x = F(b, !0);
	O(b);
	var S = L(b, 6), C = F(S), w = F(C), te = L(w, 2);
	ta(te), ua(te, (e) => P(u, e), () => V(u)), O(C);
	var ne = L(C, 2), re = F(ne), ie = L(re, 2);
	ta(ie), ua(ie, (e) => P(d, e), () => V(d)), O(ne);
	var ae = L(ne, 2), oe = F(ae), se = L(oe, 2);
	ta(se), O(ae);
	var ce = L(ae, 2);
	let le;
	var ue = F(ce, !0);
	O(ce);
	var de = L(ce, 2), fe = F(de), pe = F(fe, !0);
	O(fe), O(de);
	var me = L(de, 2), he = F(me), ge = F(he, !0);
	O(he), O(me);
	var _e = L(me, 2), ve = F(_e, !0);
	O(_e), O(S), O(y), O(v), R(() => {
		K(x, g.site && g.site.siteTitle || "Documentation"), Z(w, "for", `${n}-user`), Z(te, "id", `${n}-user`), Z(re, "for", `${n}-pass`), Z(ie, "id", `${n}-pass`), Z(ie, "autocomplete", V(f) ? "new-password" : "current-password"), Z(ae, "hidden", !V(f)), Z(oe, "for", `${n}-name`), Z(se, "id", `${n}-name`), le = X(ce, 1, "auth-status", null, le, {
			"is-error": V(l) === "is-error",
			"is-ok": V(l) === "is-ok"
		}), K(ue, V(c)), fe.disabled = V(s), K(pe, V(f) ? "Create account" : "Sign in"), Z(me, "hidden", V(p)), K(ge, V(f) ? "I already have an account" : "Create an account"), K(ve, V(m));
	}), pi("submit", S, _), oa(te, () => V(i), (e) => P(i, e)), oa(ie, () => V(a), (e) => P(a, e)), oa(se, () => V(o), (e) => P(o, e)), H("click", he, h), G(e, v), A();
}
U(["click"]);
//#endregion
//#region app/svelte/AccountButton.svelte
var ao = /* @__PURE__ */ W("<span class=\"account-initial\"> </span>"), oo = /* @__PURE__ */ W("<span class=\"wd-mounted\"></span>");
function so(e, t) {
	k(t, !0);
	let n = /* @__PURE__ */ j(() => $a.user), r = /* @__PURE__ */ j(() => V(n) ? i(V(n).displayName || V(n).username) : "");
	function i(e) {
		return String(e || "?").trim().split(/\s+/).slice(0, 2).map((e) => e[0] || "").join("").toUpperCase() || "?";
	}
	var a = Si(), o = I(a), s = (e) => {
		var t = ao(), n = F(t, !0);
		O(t), R(() => K(n, V(r))), G(e, t);
	}, c = (e) => {
		var t = oo();
		Y(t, (e, t) => Q?.(e, t), () => f), G(e, t);
	};
	q(o, (e) => {
		V(n) ? e(s) : e(c, -1);
	}), G(e, a), A();
}
//#endregion
//#region app/svelte/Modal.svelte
var co = /* @__PURE__ */ W("<div class=\"modal-scrim\"><div><h2> </h2> <!> <div class=\"modal-bar\"><!></div></div></div>");
function lo(e, t) {
	k(t, !0);
	let n = da(t, "wide", 3, !1);
	function r(e) {
		e.target === e.currentTarget && t.onClose();
	}
	function i(e) {
		e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), t.onClose());
	}
	var a = co();
	pi("keydown", Yn, i, !0);
	var o = F(a);
	let s;
	var c = F(o), l = F(c, !0);
	O(c);
	var u = L(c, 2);
	Vi(u, () => t.body);
	var d = L(u, 2);
	Vi(F(d), () => t.bar), O(d), O(o), O(a), R(() => {
		s = X(o, 1, "modal", null, s, { "modal-wide": n() }), K(l, t.title);
	}), H("click", a, r), G(e, a), A();
}
U(["click"]);
//#endregion
//#region app/svelte/GroupChip.svelte
var uo = /* @__PURE__ */ W("<span><span class=\"group-dot\"></span> </span>");
function fo(e, t) {
	k(t, !0);
	let n = da(t, "small", 3, !1), r = da(t, "title", 3, void 0), i = /* @__PURE__ */ j(() => x(t.name)), a = /* @__PURE__ */ j(() => S(t.name));
	var o = uo();
	let s;
	var c = F(o), l = L(c, 1, !0);
	O(o), R(() => {
		s = X(o, 1, "group-chip", null, s, { "is-small": n() }), Z(o, "title", r()), Zi(c, `background: ${V(i) ?? ""}`), K(l, V(a));
	}), G(e, o), A();
}
//#endregion
//#region app/svelte/AccountPanel.svelte
var po = /* @__PURE__ */ W("<span class=\"auth-badge\">Administrator</span>"), mo = /* @__PURE__ */ W("<span class=\"auth-muted\">No groups</span>"), ho = /* @__PURE__ */ W("<button class=\"btn\">Manage accounts…</button>"), go = /* @__PURE__ */ W("<div class=\"auth-panel-body\"><div class=\"auth-who\"><div class=\"auth-who-name\"> </div> <div class=\"auth-who-id\"> </div> <!></div> <p class=\"auth-label\">Your access groups</p> <div class=\"group-chips\"></div> <!> <hr class=\"auth-rule\"/> <p class=\"auth-label\">Password</p> <form class=\"auth-pw\"><div class=\"modal-field\"><label>Current password</label> <input type=\"password\" autocomplete=\"current-password\"/></div> <div class=\"modal-field\"><label>New password</label> <input type=\"password\" autocomplete=\"new-password\"/></div> <div class=\"auth-actions\"><button class=\"btn\" type=\"submit\">Change password</button></div></form> <p> </p></div>"), _o = /* @__PURE__ */ W("<button class=\"btn\">Sign out</button> <button class=\"btn btn-primary\">Done</button>", 1);
function vo(e, t) {
	let n = Ci();
	k(t, !0);
	let r = /* @__PURE__ */ j(() => $a.user), i = /* @__PURE__ */ j(() => V(r) ? V(r).displayName : ""), a = /* @__PURE__ */ j(() => V(r) ? V(r).username : ""), o = /* @__PURE__ */ j(() => !!(V(r) && V(r).admin)), s = /* @__PURE__ */ j(() => V(r) && V(r).groups || []), c = /* @__PURE__ */ N(""), l = /* @__PURE__ */ N(""), u = /* @__PURE__ */ N(!1), d = /* @__PURE__ */ N(""), f = /* @__PURE__ */ N("");
	async function p(e) {
		e.preventDefault(), P(u, !0), P(f, ""), P(d, "Changing…");
		let t = await b(V(c), V(l));
		P(u, !1), P(f, t.ok ? "is-ok" : "is-error", !0), P(d, t.ok ? "Password changed." : t.error || "That did not work.", !0), t.ok && (P(c, ""), P(l, ""));
	}
	lo(e, {
		title: "Your account",
		get onClose() {
			return t.onClose;
		},
		body: (e) => {
			var r = go(), m = F(r), h = F(m), g = F(h, !0);
			O(h);
			var _ = L(h, 2), v = F(_);
			O(_);
			var y = L(_, 2), b = (e) => {
				G(e, po());
			};
			q(y, (e) => {
				V(o) && e(b);
			}), O(m);
			var x = L(m, 4);
			J(x, 20, () => V(s), (e) => e, (e, t) => {
				fo(e, { get name() {
					return t;
				} });
			}, (e) => {
				G(e, mo());
			}), O(x);
			var S = L(x, 2), C = (e) => {
				var n = ho();
				H("click", n, function(...e) {
					t.onManage?.apply(this, e);
				}), G(e, n);
			};
			q(S, (e) => {
				V(o) && e(C);
			});
			var w = L(S, 6), T = F(w), ee = F(T), te = L(ee, 2);
			ta(te), O(T);
			var ne = L(T, 2), re = F(ne), ie = L(re, 2);
			ta(ie), O(ne);
			var ae = L(ne, 2), oe = F(ae);
			O(ae), O(w);
			var se = L(w, 2);
			let ce;
			var le = F(se, !0);
			O(se), O(r), R(() => {
				K(g, V(i)), K(v, `@${V(a) ?? ""}`), Z(ee, "for", `${n}-current`), Z(te, "id", `${n}-current`), Z(re, "for", `${n}-next`), Z(ie, "id", `${n}-next`), oe.disabled = V(u), ce = X(se, 1, "auth-status", null, ce, {
					"is-error": V(f) === "is-error",
					"is-ok": V(f) === "is-ok"
				}), K(le, V(d));
			}), pi("submit", w, p), oa(te, () => V(c), (e) => P(c, e)), oa(ie, () => V(l), (e) => P(l, e)), G(e, r);
		},
		bar: (e) => {
			var n = _o(), r = I(n), i = L(r, 2);
			H("click", r, function(...e) {
				t.onSignOut?.apply(this, e);
			}), H("click", i, function(...e) {
				t.onClose?.apply(this, e);
			}), G(e, n);
		},
		$$slots: {
			body: !0,
			bar: !0
		}
	}), A();
}
U(["click"]);
//#endregion
//#region app/svelte/UserRow.svelte
var yo = /* @__PURE__ */ W("<span class=\"auth-badge is-warn\">Disabled</span>"), bo = /* @__PURE__ */ W("<label class=\"admin-group\"><input type=\"checkbox\"/><!></label>"), xo = /* @__PURE__ */ W("<div><div class=\"admin-who\"><span class=\"admin-name\"> </span> <span class=\"admin-id\"> </span> <!></div> <div class=\"admin-groups\"></div> <div class=\"admin-flags\"><label class=\"admin-flag\"><input type=\"checkbox\"/>Administrator</label> <label class=\"admin-flag\"><input type=\"checkbox\"/>Disabled</label> <button class=\"btn btn-danger btn-sm\">Delete</button></div></div>");
function So(e, t) {
	k(t, !0);
	let n = /* @__PURE__ */ N(null), r = /* @__PURE__ */ j(() => V(n) || t.user.groups || []);
	fr(() => {
		t.user.groups, P(n, null);
	});
	function i(e, i) {
		let a = i ? [...V(r), e] : V(r).filter((t) => t !== e);
		P(n, a, !0), t.onUpdate({ groups: a });
	}
	function a() {
		window.confirm("Delete the account \"" + t.user.username + "\"? This cannot be undone.") && t.onDelete();
	}
	var o = xo();
	let s;
	var c = F(o), l = F(c), u = F(l, !0);
	O(l);
	var d = L(l, 2), f = F(d);
	O(d);
	var p = L(d, 2), m = (e) => {
		G(e, yo());
	};
	q(p, (e) => {
		t.user.disabled && e(m);
	}), O(c);
	var h = L(c, 2);
	J(h, 21, () => t.groups, (e) => e.name, (e, t) => {
		var n = bo(), a = F(n);
		ta(a), fo(L(a), {
			get name() {
				return V(t).name;
			},
			small: !0
		}), O(n), R((e) => na(a, e), [() => V(r).indexOf(V(t).name) !== -1]), H("change", a, (e) => i(V(t).name, e.currentTarget.checked)), G(e, n);
	}), O(h);
	var g = L(h, 2), _ = F(g), v = F(_);
	ta(v), kt(), O(_);
	var y = L(_, 2), b = F(y);
	ta(b), kt(), O(y);
	var x = L(y, 2);
	O(g), O(o), R(() => {
		s = X(o, 1, "admin-row", null, s, { "is-disabled": t.user.disabled }), K(u, t.user.displayName || t.user.username), K(f, `@${t.user.username ?? ""}`), na(v, !!t.user.admin), na(b, !!t.user.disabled);
	}), H("change", v, (e) => t.onUpdate({ admin: e.currentTarget.checked })), H("change", b, (e) => t.onUpdate({ disabled: e.currentTarget.checked })), H("click", x, a), G(e, o), A();
}
U(["change", "click"]);
//#endregion
//#region app/svelte/AdminPanel.svelte
var Co = /* @__PURE__ */ W("<p class=\"auth-status is-error\">Could not load the account list.</p>"), wo = /* @__PURE__ */ W("<p class=\"auth-muted\">Loading…</p>"), To = /* @__PURE__ */ W("<div class=\"auth-panel-body\"><p class=\"auth-sub\">Groups are declared in config.json; here you choose who is in them. Changing a group or disabling an account signs that person out immediately.</p> <div class=\"admin-list\"><!></div> <p> </p> <div class=\"auth-actions\"><button class=\"btn\">Add an account…</button></div></div>"), Eo = /* @__PURE__ */ W("<button class=\"btn btn-primary\">Done</button>");
function Do(e, t) {
	k(t, !0);
	let n = /* @__PURE__ */ N(null), r = /* @__PURE__ */ N(qn([])), i = /* @__PURE__ */ N(!1), a = /* @__PURE__ */ N(""), o = /* @__PURE__ */ N("");
	async function s() {
		let e = await C();
		if (!e) {
			P(i, !0);
			return;
		}
		P(i, !1), P(n, e.users, !0), P(r, e.groups, !0);
	}
	async function c(e) {
		let t = await e;
		P(o, t.ok ? "is-ok" : "is-error", !0), P(a, t.ok ? "Saved." : t.error || "That did not work.", !0), s();
	}
	s(), lo(e, {
		title: "Accounts",
		wide: !0,
		get onClose() {
			return t.onClose;
		},
		body: (e) => {
			var l = To(), u = L(F(l), 2), d = F(u), f = (e) => {
				G(e, Co());
			}, p = (e) => {
				G(e, wo());
			}, m = (e) => {
				var t = Si();
				J(I(t), 17, () => V(n), (e) => e.username, (e, t) => {
					So(e, {
						get user() {
							return V(t);
						},
						get groups() {
							return V(r);
						},
						onUpdate: (e) => c(v("update", {
							username: V(t).username,
							...e
						})),
						onDelete: () => c(v("delete", { username: V(t).username }))
					});
				}), G(e, t);
			};
			q(d, (e) => {
				V(i) ? e(f) : V(n) === null ? e(p, 1) : e(m, -1);
			}), O(u);
			var h = L(u, 2);
			let g;
			var _ = F(h, !0);
			O(h);
			var y = L(h, 2), b = F(y);
			O(y), O(l), R(() => {
				g = X(h, 1, "auth-status", null, g, {
					"is-error": V(o) === "is-error",
					"is-ok": V(o) === "is-ok"
				}), K(_, V(a));
			}), H("click", b, () => t.onAddAccount(s)), G(e, l);
		},
		bar: (e) => {
			var n = Eo();
			H("click", n, function(...e) {
				t.onClose?.apply(this, e);
			}), G(e, n);
		},
		$$slots: {
			body: !0,
			bar: !0
		}
	}), A();
}
U(["click"]);
//#endregion
//#region app/svelte/CreateUserDialog.svelte
var Oo = /* @__PURE__ */ W("<div class=\"auth-panel-body\"><div class=\"modal-field\"><label>Username</label> <input type=\"text\" autocomplete=\"off\"/></div> <div class=\"modal-field\"><label>Password</label> <input type=\"password\" autocomplete=\"new-password\"/></div> <div class=\"modal-field\"><label>Display name (optional)</label> <input type=\"text\" autocomplete=\"off\"/></div> <p class=\"auth-hint\">The account starts with no groups. Assign them from the account list.</p> <p> </p></div>"), ko = /* @__PURE__ */ W("<button class=\"btn\">Cancel</button> <button class=\"btn btn-primary\">Create</button>", 1);
function Ao(e, t) {
	let n = Ci();
	k(t, !0);
	let r = /* @__PURE__ */ N(""), i = /* @__PURE__ */ N(""), a = /* @__PURE__ */ N(""), o = /* @__PURE__ */ N(!1), s = /* @__PURE__ */ N(""), c = /* @__PURE__ */ N(void 0);
	fr(() => {
		let e = window.setTimeout(() => {
			V(c) && V(c).focus();
		}, 30);
		return () => window.clearTimeout(e);
	});
	async function l() {
		P(o, !0);
		let e = await v("create", {
			username: V(r).trim(),
			password: V(i),
			displayName: V(a).trim()
		});
		if (P(o, !1), !e.ok) {
			P(s, e.error || "That did not work.", !0);
			return;
		}
		t.onCreated(), t.onClose();
	}
	lo(e, {
		title: "Add an account",
		get onClose() {
			return t.onClose;
		},
		body: (e) => {
			var t = Oo(), o = F(t), l = F(o), u = L(l, 2);
			ta(u), ua(u, (e) => P(c, e), () => V(c)), O(o);
			var d = L(o, 2), f = F(d), p = L(f, 2);
			ta(p), O(d);
			var m = L(d, 2), h = F(m), g = L(h, 2);
			ta(g), O(m);
			var _ = L(m, 4);
			let v;
			var y = F(_, !0);
			O(_), O(t), R(() => {
				Z(l, "for", `${n}-user`), Z(u, "id", `${n}-user`), Z(f, "for", `${n}-pass`), Z(p, "id", `${n}-pass`), Z(h, "for", `${n}-name`), Z(g, "id", `${n}-name`), v = X(_, 1, "auth-status", null, v, { "is-error": !!V(s) }), K(y, V(s));
			}), oa(u, () => V(r), (e) => P(r, e)), oa(p, () => V(i), (e) => P(i, e)), oa(g, () => V(a), (e) => P(a, e)), G(e, t);
		},
		bar: (e) => {
			var n = ko(), r = I(n), i = L(r, 2);
			R(() => i.disabled = V(o)), H("click", r, function(...e) {
				t.onClose?.apply(this, e);
			}), H("click", i, l), G(e, n);
		},
		$$slots: {
			body: !0,
			bar: !0
		}
	}), A();
}
U(["click"]);
//#endregion
//#region app/svelte/RestrictedPage.svelte
var jo = /* @__PURE__ */ W("<div class=\"restricted-groups\"><p class=\"auth-label\">Readable by</p> <div class=\"group-chips\"></div></div>"), Mo = /* @__PURE__ */ W("<button class=\"btn btn-primary\">Sign in</button>"), No = /* @__PURE__ */ W("<div class=\"restricted-page\"><div class=\"restricted-icon\"></div> <h1 class=\"restricted-title\">This page is restricted</h1> <p class=\"restricted-sub\"> </p> <!> <p class=\"restricted-id\"> </p> <div class=\"auth-actions\"><!></div></div>");
function Po(e, t) {
	k(t, !0);
	let n = da(t, "detail", 19, () => ({})), r = /* @__PURE__ */ j(() => n().requiresGroups || []), i = /* @__PURE__ */ j(() => !!n().signInRequired), a = /* @__PURE__ */ j(() => V(i) ? "Sign in to see whether you have access to this page." : "Your account does not have read access to this page.");
	var o = No(), s = F(o);
	Y(s, (e, t) => Q?.(e, t), () => c);
	var l = L(s, 4), u = F(l, !0);
	O(l);
	var d = L(l, 2), f = (e) => {
		var t = jo(), n = L(F(t), 2);
		J(n, 20, () => V(r), (e) => e, (e, t) => {
			fo(e, { get name() {
				return t;
			} });
		}), O(n), O(t), G(e, t);
	};
	q(d, (e) => {
		V(r).length && e(f);
	});
	var p = L(d, 2), m = F(p, !0);
	O(p);
	var h = L(p, 2), g = F(h), _ = (e) => {
		var n = Mo();
		H("click", n, function(...e) {
			t.onSignIn?.apply(this, e);
		}), G(e, n);
	};
	q(g, (e) => {
		V(i) && e(_);
	}), O(h), O(o), R(() => {
		K(u, V(a)), K(m, t.docId);
	}), G(e, o), A();
}
U(["click"]);
//#endregion
//#region app/svelte/RestrictedSection.svelte
var Fo = /* @__PURE__ */ W("<div class=\"group-chips\"></div>"), Io = /* @__PURE__ */ W("<aside class=\"restricted-section\" role=\"note\"><span class=\"restricted-section-icon\"></span> <div class=\"restricted-section-body\"><p class=\"restricted-section-title\"> </p> <p class=\"restricted-section-sub\"> </p> <!></div></aside>");
function Lo(e, t) {
	k(t, !0);
	let n = da(t, "spec", 19, () => ({})), r = /* @__PURE__ */ j(() => n().read || []), i = /* @__PURE__ */ j(() => n().malformed ? "This section has an access rule that could not be read, so it is hidden from everyone but an administrator." : V(r).length ? "Part of this page is only visible to members of:" : "Part of this page is hidden from your account.");
	var a = Io(), o = F(a);
	Y(o, (e, t) => Q?.(e, t), () => c);
	var s = L(o, 2), l = F(s), u = F(l, !0);
	O(l);
	var d = L(l, 2), f = F(d, !0);
	O(d);
	var p = L(d, 2), m = (e) => {
		var t = Fo();
		J(t, 20, () => V(r), (e) => e, (e, t) => {
			fo(e, {
				get name() {
					return t;
				},
				small: !0
			});
		}), O(t), G(e, t);
	};
	q(p, (e) => {
		V(r).length && e(m);
	}), O(s), O(a), R(() => {
		K(u, n().label || "Restricted section"), K(f, V(i));
	}), G(e, a), A();
}
//#endregion
//#region app/svelte/islands/auth.ts
function Ro(e) {
	let t = document.createElement(e);
	return t.className = "wd-mounted", t;
}
function zo(e, t) {
	no();
	let n = Ro("div");
	document.body.appendChild(n);
	let r = !1, i = () => {
		r || (r = !0, Oi(a), n.remove());
	}, a = wi(e, {
		target: n,
		props: t(i)
	});
	return i;
}
function Bo(e, t) {
	no();
	let n = Ro("div");
	e.appendChild(n);
	let r = !1, i = wi(io, {
		target: n,
		props: { onSignedIn: () => {
			r || (r = !0, Oi(i), n.remove(), t.onSignedIn());
		} }
	});
}
function Vo(e) {
	no(), wi(so, { target: e });
}
function Ho(e) {
	zo(vo, (t) => ({
		onClose: t,
		onManage: () => {
			t(), Uo();
		},
		onSignOut: () => {
			t(), e.onSignOut();
		}
	}));
}
function Uo() {
	zo(Do, (e) => ({
		onClose: e,
		onAddAccount: (e) => {
			zo(Ao, (t) => ({
				onClose: t,
				onCreated: e
			}));
		}
	}));
}
function Wo(e, t, n, r) {
	no();
	let i = wi(Po, {
		target: e,
		props: {
			docId: t,
			detail: n,
			onSignIn: r.onSignIn
		}
	});
	return { destroy: () => Oi(i) };
}
function Go(e, t) {
	let n = wi(Lo, {
		target: e,
		props: { spec: t }
	});
	return { destroy: () => Oi(n) };
}
function Ko(e, t, n) {
	let r = wi(fo, {
		target: e,
		props: {
			name: t,
			small: !!(n && n.small),
			title: n && n.title
		}
	});
	return { destroy: () => Oi(r) };
}
//#endregion
//#region app/svelte/actions/fragment.ts
function qo(e, t) {
	let n = [], r = null;
	function i(t) {
		let i = String(t && t.text || ""), a = !!(t && t.inline);
		if (r && r.text === i && r.inline === a) return;
		n.forEach((e) => e.remove());
		let o = a ? ce(i) : se(i);
		n = [...o.childNodes], e.appendChild(o), r = {
			text: i,
			inline: a
		};
	}
	return i(t), {
		update: i,
		destroy: () => {
			n.forEach((e) => e.remove()), n = [], r = null;
		}
	};
}
//#endregion
//#region app/svelte/stores/coverage.svelte.ts
var Jo = qn({ version: 0 }), Yo = !1;
function Xo() {
	Yo || (Yo = !0, ne(() => {
		Jo.version++;
	}));
}
//#endregion
//#region app/svelte/ReqTable.svelte
var Zo = (e, t = Pe) => {
	var n = Si(), r = I(n), i = (e) => {
		var n = Si();
		J(I(n), 17, t, Mi, (e, t, n) => {
			var r = es(), i = I(r), a = (e) => {
				G(e, xi(","));
			};
			q(i, (e) => {
				n && e(a);
			});
			var o = L(i), s = (e) => {
				var n = Qo(), r = F(n, !0);
				O(n), R(() => {
					X(n, 1, Wi(V(t).cls)), Z(n, "href", V(t).href), K(r, V(t).id);
				}), G(e, n);
			}, c = (e) => {
				var n = $o(), r = F(n);
				Y(r, (e, t) => Q?.(e, t), () => p);
				var i = L(r);
				O(n), R(() => {
					Z(n, "title", `Not found: ${V(t).raw ?? ""}`), K(i, ` ${V(t).raw ?? ""}`);
				}), G(e, n);
			};
			q(o, (e) => {
				V(t).id ? e(s) : e(c, -1);
			}), G(e, r);
		}), G(e, n);
	}, a = (e) => {
		G(e, ts());
	};
	q(r, (e) => {
		t().length ? e(i) : e(a, -1);
	}), G(e, n);
}, Qo = /* @__PURE__ */ W("<a> </a>"), $o = /* @__PURE__ */ W("<span class=\"req-missing\"><span class=\"wd-mounted\"></span> </span>"), es = /* @__PURE__ */ W("<!><!>", 1), ts = /* @__PURE__ */ W("<span class=\"req-none\">—</span>"), ns = /* @__PURE__ */ W("<p class=\"req-error\"><span class=\"wd-mounted\"></span> </p>"), rs = /* @__PURE__ */ W("<th> </th>"), is = /* @__PURE__ */ W("<tr><td class=\"req-idcell\"><span> </span></td><td></td><td><!></td><td><!></td><td><!></td></tr>"), as = /* @__PURE__ */ W("<figure class=\"req-group\"><figcaption class=\"req-cap\"> </figcaption> <!> <div class=\"req-scroll\"><table class=\"req-tbl\"><thead><tr></tr></thead><tbody></tbody></table></div></figure>");
function os(e, t) {
	k(t, !0);
	let n = [
		"Requirement",
		"Description",
		"Trace To",
		"Trace From",
		"Verified By"
	];
	function r(e) {
		let t = te.get(e);
		return t ? "#/" + t.docId + "?req=" + encodeURIComponent(e) : "#";
	}
	function i(e) {
		let t = ie.get(e);
		return t ? "#/" + t.docId + "?test=" + encodeURIComponent(e) : "#";
	}
	function a(e) {
		return e.traceTo.map((t) => {
			let n = oe(t, e);
			return {
				id: n,
				raw: t,
				href: n ? r(n) : "",
				cls: "req-link"
			};
		});
	}
	function o(e) {
		return (e || []).map((e) => ({
			id: e,
			raw: e,
			href: r(e),
			cls: "req-link"
		}));
	}
	function s(e) {
		return (e || []).map((e) => ({
			id: e,
			raw: e,
			href: i(e),
			cls: "req-link tc-link"
		}));
	}
	function c(e) {
		Jo.version;
		let t = re(e);
		return t ? " req-badge-st-" + t.status : "";
	}
	function l(e) {
		return e.component && e.group ? "req-" + ae(e.id) : void 0;
	}
	var u = as(), d = F(u), f = F(d);
	O(d);
	var m = L(d, 2), h = (e) => {
		var n = ns(), r = F(n);
		Y(r, (e, t) => Q?.(e, t), () => p);
		var i = L(r);
		O(n), R(() => K(i, ` ${t.block.error ?? ""}`)), G(e, n);
	};
	q(m, (e) => {
		t.block.error && e(h);
	});
	var g = L(m, 2), _ = F(g), v = F(_), y = F(v);
	J(y, 20, () => n, (e) => e, (e, t) => {
		var n = rs(), r = F(n, !0);
		O(n), R(() => K(r, t)), G(e, n);
	}), O(y), O(v);
	var b = L(v);
	J(b, 21, () => t.block.rows, Mi, (e, t) => {
		var n = is(), r = F(n), i = F(r), u = F(i, !0);
		O(i), O(r);
		var d = L(r);
		Y(d, (e, t) => qo?.(e, t), () => ({
			text: V(t).description,
			inline: !0
		}));
		var f = L(d), p = F(f);
		{
			let e = /* @__PURE__ */ j(() => a(V(t)));
			Zo(p, () => V(e));
		}
		O(f);
		var m = L(f), h = F(m);
		{
			let e = /* @__PURE__ */ j(() => o(V(t).traceFrom));
			Zo(h, () => V(e));
		}
		O(m);
		var g = L(m), _ = F(g);
		{
			let e = /* @__PURE__ */ j(() => s(V(t).verifiedBy));
			Zo(_, () => V(e));
		}
		O(g), O(n), R((e, r) => {
			Z(n, "id", e), X(i, 1, `req-badge${r ?? ""}`), K(u, V(t).id);
		}, [() => l(V(t)), () => c(V(t).id)]), G(e, n);
	}), O(b), O(_), O(g), O(u), R(() => K(f, `Requirements — ${t.block.group ?? ""}`)), G(e, u), A();
}
//#endregion
//#region app/svelte/TestCase.svelte
var ss = /* @__PURE__ */ W("<button type=\"button\" class=\"tc-run\" title=\"Run this test case\"><span class=\"wd-mounted\"></span>Run</button>"), cs = /* @__PURE__ */ W("<p class=\"req-error\"><span class=\"wd-mounted\"></span> </p>"), ls = /* @__PURE__ */ W("<!><a class=\"req-link\"> </a>", 1), us = /* @__PURE__ */ W("<span class=\"req-none\">—</span>"), ds = /* @__PURE__ */ W("<th> </th>"), fs = /* @__PURE__ */ W("<tr><td class=\"tc-stepno\"></td><td class=\"tc-md\"></td><td class=\"tc-steps tc-md\"></td></tr>"), ps = /* @__PURE__ */ W("<figure class=\"req-group test-case\"><figcaption class=\"req-cap tc-cap\"> <span class=\"tc-id\"> </span><span> </span><!></figcaption> <!> <p class=\"tc-verifies\">Verifies: <!></p> <div class=\"req-scroll\"><table class=\"req-tbl test-steps-tbl\"><thead><tr></tr></thead><tbody></tbody></table></div></figure>");
function ms(e, t) {
	k(t, !0);
	let n = [
		"#",
		"Action",
		"Expected response"
	], r = /* @__PURE__ */ j(() => t.block.rec), i = /* @__PURE__ */ j(() => (Jo.version, re(V(r).id))), a = /* @__PURE__ */ j(() => V(i) ? V(i).status : "untested"), o = /* @__PURE__ */ j(() => V(a) === "pass" ? "Pass" : V(a) === "fail" ? "Fail" : V(a) === "partial" ? "Partial" : "Untested"), s = /* @__PURE__ */ j(() => !!(V(r).component && V(r).key)), c = /* @__PURE__ */ j(() => V(s) ? "test-" + ae(V(r).id) : void 0);
	function l(e) {
		let t = te.get(e);
		return t ? "#/" + t.docId + "?req=" + encodeURIComponent(e) : "#";
	}
	function d() {
		document.dispatchEvent(new window.CustomEvent("webdoc:run-test", { detail: { testId: V(r).id } }));
	}
	var f = ps(), m = F(f), h = F(m), g = L(h), _ = F(g, !0);
	O(g);
	var v = L(g), y = F(v, !0);
	O(v);
	var b = L(v), x = (e) => {
		var t = ss();
		Y(F(t), (e, t) => Q?.(e, t), () => u), kt(), O(t), H("click", t, d), G(e, t);
	};
	q(b, (e) => {
		V(s) && e(x);
	}), O(m);
	var S = L(m, 2), C = (e) => {
		var n = cs(), r = F(n);
		Y(r, (e, t) => Q?.(e, t), () => p);
		var i = L(r);
		O(n), R(() => K(i, ` ${t.block.error ?? ""}`)), G(e, n);
	};
	q(S, (e) => {
		t.block.error && e(C);
	});
	var w = L(S, 2), T = L(F(w)), ee = (e) => {
		var t = Si();
		J(I(t), 17, () => V(r).verifies, Mi, (e, t, n) => {
			var r = ls(), i = I(r), a = (e) => {
				G(e, xi(","));
			};
			q(i, (e) => {
				n && e(a);
			});
			var o = L(i), s = F(o, !0);
			O(o), R((e) => {
				Z(o, "href", e), K(s, V(t));
			}, [() => l(V(t))]), G(e, r);
		}), G(e, t);
	}, ne = (e) => {
		G(e, us());
	};
	q(T, (e) => {
		V(r).verifies.length ? e(ee) : e(ne, -1);
	}), O(w);
	var ie = L(w, 2), oe = F(ie), se = F(oe), ce = F(se);
	J(ce, 20, () => n, (e) => e, (e, t) => {
		var n = ds(), r = F(n, !0);
		O(n), R(() => K(r, t)), G(e, n);
	}), O(ce), O(se);
	var le = L(se);
	J(le, 21, () => V(r).steps, Mi, (e, t, n) => {
		var r = fs(), i = F(r);
		i.textContent = n + 1;
		var a = L(i);
		Y(a, (e, t) => qo?.(e, t), () => ({ text: V(t).action })), Y(L(a), (e, t) => qo?.(e, t), () => ({ text: V(t).expected })), O(r), G(e, r);
	}), O(le), O(oe), O(ie), O(f), R(() => {
		Z(f, "id", V(c)), K(h, `Test case — ${V(r).name ?? ""} `), K(_, V(r).id), X(v, 1, `tc-result tc-result-${V(a) ?? ""}`), K(y, V(o));
	}), G(e, f), A();
}
U(["click"]);
//#endregion
//#region app/svelte/islands/requirements.ts
function hs(e, t) {
	Xo();
	let n = wi(os, {
		target: e,
		props: { block: t }
	});
	return { destroy: () => Oi(n) };
}
function gs(e, t) {
	Xo();
	let n = wi(ms, {
		target: e,
		props: { block: t }
	});
	return { destroy: () => Oi(n) };
}
//#endregion
//#region app/svelte/actions/graph.ts
var _s = null;
function vs(e, t, n, r, i) {
	let a = null, o = !0;
	return import("/js/graph.js").then((i) => {
		o && (a = n(i)(e, t.docs, r), t.onReady(a));
	}), { destroy() {
		o = !1, a &&= (i(a), t.onReady(null), a.destroy(), null);
	} };
}
function ys(e, t) {
	return vs(e, t, (e) => e.createGraph, Object.assign({}, t.options, { initialTransform: _s }), (e) => {
		_s = e.getTransform();
	});
}
function bs(e, t) {
	return vs(e, t, (e) => e.createGraphController, t.options, (e) => t.onTeardown({
		transform: e.getTransform(),
		positions: e.getNodePositions(),
		editState: e.getEditState()
	}));
}
//#endregion
//#region app/svelte/CovLegend.svelte
var xs = /* @__PURE__ */ W("<button type=\"button\"><span></span> </button>"), Ss = /* @__PURE__ */ W("<div class=\"cov-legend\"></div>");
function Cs(e, t) {
	k(t, !0);
	let n = [
		["pass", "Passing"],
		["fail", "Failing"],
		["partial", "Partial"],
		["untested", "Untested"]
	];
	var r = Ss();
	J(r, 21, () => n, ([e, t]) => e, (e, n) => {
		var r = /* @__PURE__ */ j(() => Le(V(n), 2));
		let i = () => V(r)[0], a = () => V(r)[1];
		var o = xs();
		let s;
		var c = F(o), l = L(c, 1, !0);
		O(o), R((e, t) => {
			s = X(o, 1, "cov-legend-item", null, s, e), Z(o, "aria-pressed", t), Z(o, "title", `Toggle ${a() ?? ""} requirements`), X(c, 1, `cov-swatch cov-swatch-${i() ?? ""}`), K(l, a());
		}, [() => ({ "is-off": t.off.includes(i()) }), () => t.off.includes(i()) ? "false" : "true"]), H("click", o, () => t.onToggle(i())), G(e, o);
	}), O(r), G(e, r), A();
}
U(["click"]);
//#endregion
//#region app/svelte/CovExportButton.svelte
var ws = /* @__PURE__ */ W("<button class=\"cov-export-btn\" type=\"button\" title=\"Download a self-contained test report (HTML) you can share anywhere\">⤓ Export report</button>");
function Ts(e, t) {
	var n = ws();
	H("click", n, function(...e) {
		t.onExport?.apply(this, e);
	}), G(e, n);
}
U(["click"]);
//#endregion
//#region app/svelte/actions/richtext.ts
function Es(e, t) {
	let n = null, r = !0;
	return import("/js/editor.js").then(({ richText: i }) => {
		r && (n = i(t.value, t.onchange, t.placeholder), t.extraClass && n.classList.add(t.extraClass), e.appendChild(n));
	}), { destroy() {
		r = !1, n && n.remove(), n = null;
	} };
}
function Ds(e, t) {
	let n = Se(String(t || "")), r = [...n.childNodes];
	return e.appendChild(n), { destroy() {
		r.forEach((e) => e.remove()), r = [];
	} };
}
//#endregion
//#region app/svelte/StepReport.svelte
var Os = /* @__PURE__ */ W("<span class=\"tc-step-dot\"></span>"), ks = /* @__PURE__ */ W("<div class=\"tc-step-actual\">Actual:</div>"), As = /* @__PURE__ */ W("<div><div class=\"tc-step-head\"><span class=\"tc-step-n\"> </span> <div class=\"tc-step-act tc-md\"></div> <!></div> <div class=\"tc-step-exp\"><div class=\"tc-step-lbl\">Expected</div><div class=\"tc-md\"></div></div> <!></div>");
function js(t, n) {
	k(n, !0);
	let i = da(n, "ex", 3, void 0), a = /* @__PURE__ */ j(() => !!i() && typeof i().pass == "boolean"), o = /* @__PURE__ */ j(() => !!i() && i().pass === !0), s = /* @__PURE__ */ j(() => i() && i().response || "");
	var c = As();
	let l;
	var u = F(c), d = F(u), f = F(d);
	O(d);
	var p = L(d, 2);
	Y(p, (e, t) => qo?.(e, t), () => ({ text: n.step.action }));
	var m = L(p, 2), h = (t) => {
		var n = Os();
		Y(n, (e, t) => Q?.(e, t), () => V(o) ? e : r), G(t, n);
	};
	q(m, (e) => {
		V(a) && e(h);
	}), O(u);
	var g = L(u, 2);
	Y(L(F(g)), (e, t) => qo?.(e, t), () => ({ text: n.step.expected })), O(g);
	var _ = L(g, 2), v = (e) => {
		var t = ks();
		Y(t, (e, t) => Ds?.(e, t), () => V(s)), G(e, t);
	};
	q(_, (e) => {
		V(s) && e(v);
	}), O(c), R(() => {
		l = X(c, 1, "tc-step", null, l, {
			"is-pass": V(a) && V(o),
			"is-fail": V(a) && !V(o)
		}), K(f, `${n.index + 1}.`);
	}), G(t, c), A();
}
//#endregion
//#region app/svelte/AutomatedTests.svelte
var Ms = /* @__PURE__ */ W("<p class=\"cov-report-empty\">No automated tests connected.</p>"), Ns = /* @__PURE__ */ W("<div class=\"cov-vtest\"><div class=\"cov-vtest-open cov-auto-info\"><span></span> <span class=\"cov-vtest-name\"> </span> <span class=\"cov-vtest-id\"> </span></div> <button type=\"button\" class=\"cov-vtest-rm\" title=\"Disconnect this automated test\"></button></div>"), Ps = /* @__PURE__ */ W("<div class=\"cov-vtest cov-auto-declared\"><div class=\"cov-vtest-open cov-auto-info\"><span></span> <span class=\"cov-vtest-name\"> </span> <span class=\"cov-vtest-id\">declared</span></div></div>"), Fs = /* @__PURE__ */ W("<div class=\"cov-vtest-opt\"><span class=\"cov-vtest-optname\"> </span> <span class=\"cov-vtest-optid\"> <span class=\"wd-mounted\"></span></span></div>"), Is = /* @__PURE__ */ W("<div class=\"cov-report-sec cov-auto\"><h3> </h3> <div class=\"cov-auto-list\"><!> <!> <!></div> <div class=\"cov-vtest-add\"><input class=\"cov-vtest-search\" placeholder=\"Search automated tests to connect…\"/> <span class=\"cov-medit-status\"> </span></div> <div class=\"cov-vtest-drop\"></div> <div class=\"cov-auto-url\"><input class=\"cov-vtest-search\" placeholder=\"Add an external xUnit URL…\"/> <button type=\"button\" class=\"blk-small\">Add</button></div></div>");
function Ls(t, i) {
	k(i, !0);
	let a = da(i, "results", 7), o = /* @__PURE__ */ N(""), s = /* @__PURE__ */ N(""), c = /* @__PURE__ */ N(""), l = /* @__PURE__ */ N(!1), u = /* @__PURE__ */ N(""), d = /* @__PURE__ */ N(!1), f = (e) => (e.classname || "") + " " + (e.name || ""), p = /* @__PURE__ */ j(() => a().autoLinks && a().autoLinks[i.id] || []), m = /* @__PURE__ */ j(() => {
		let e = new Set(V(p).map((e) => e.name));
		return (xe(i.id, a()).auto || []).filter((t) => !e.has(t.name));
	});
	function h(e) {
		let t = (a().autoCatalog || []).find((t) => t.key === e);
		return t ? t.pass ? "pass" : "fail" : "untested";
	}
	function _(t) {
		return t === "pass" ? e : t === "fail" ? r : n;
	}
	let v = /* @__PURE__ */ j(() => {
		let e = new Set(V(p).map(f)), t = V(c).trim().toLowerCase();
		return (a().autoCatalog || []).filter((n) => !e.has(n.key) && (!t || (n.name || "").toLowerCase().includes(t) || (n.classname || "").toLowerCase().includes(t))).slice(0, 8);
	});
	async function y(e) {
		P(s, f(e), !0), P(o, "Disconnecting…");
		let t = await he(i.id, e, g.site?.sources ?? []);
		P(s, ""), t && await i.onReload();
	}
	async function b(e, t) {
		e.preventDefault(), P(l, !1), P(c, ""), P(o, "Connecting…"), await me(i.id, t, g.site?.sources ?? []) && await i.onReload();
	}
	async function x() {
		let e = V(u).trim();
		if (!e) return;
		P(d, !0), P(o, "Fetching…");
		let t = await ge(e);
		if (P(d, !1), !t.length) {
			P(o, "No xUnit tests found at that URL.");
			return;
		}
		let n = new Map([...a().autoCatalog || [], ...t].map((e) => [e.key, e]));
		a().autoCatalog = [...n.values()], await ye(e, i.id, g.site?.sources ?? []), P(u, ""), P(o, "Added " + t.length + " tests — search to connect."), P(l, !0);
	}
	function S(e) {
		e.key === "Enter" && (e.preventDefault(), x());
	}
	function C() {
		window.setTimeout(() => {
			P(l, !1);
		}, 160);
	}
	var w = Is(), T = F(w), ee = F(T);
	O(T);
	var te = L(T, 2), ne = F(te), re = (e) => {
		G(e, Ms());
	};
	q(ne, (e) => {
		!V(p).length && !V(m).length && e(re);
	});
	var ie = L(ne, 2);
	J(ie, 17, () => V(p), (e) => f(e), (e, t) => {
		var n = Ns(), i = F(n), a = F(i);
		Y(a, (e, t) => Q?.(e, t), () => _(h(f(V(t)))));
		var o = L(a, 2), c = F(o, !0);
		O(o);
		var l = L(o, 2), u = F(l, !0);
		O(l), O(i);
		var d = L(i, 2);
		Y(d, (e, t) => Q?.(e, t), () => r), O(n), R((e, n) => {
			X(a, 1, `cov-vtest-dot tc-result-${e ?? ""}`), K(c, V(t).name), K(u, V(t).classname || V(t).suite || ""), d.disabled = n;
		}, [() => h(f(V(t))), () => V(s) === f(V(t))]), H("click", d, () => y(V(t))), G(e, n);
	}), J(L(ie, 2), 17, () => V(m), (e) => e.name, (t, n) => {
		var i = Ps(), a = F(i), o = F(a);
		Y(o, (e, t) => Q?.(e, t), () => V(n).pass ? e : r);
		var s = L(o, 2), c = F(s, !0);
		O(s), kt(2), O(a), O(i), R(() => {
			X(o, 1, `cov-vtest-dot tc-result-${V(n).pass ? "pass" : "fail"}`), K(c, V(n).name);
		}), G(t, i);
	}), O(te);
	var ae = L(te, 2), oe = F(ae);
	ta(oe);
	var se = L(oe, 2), ce = F(se, !0);
	O(se), O(ae);
	var le = L(ae, 2);
	J(le, 21, () => V(v), (e) => e.key, (t, n) => {
		var i = Fs(), a = F(i), o = F(a, !0);
		O(a);
		var s = L(a, 2), c = F(s, !0);
		Y(L(c), (e, t) => Q?.(e, t), () => V(n).pass ? e : r), O(s), O(i), R(() => {
			K(o, V(n).name), K(c, (V(n).classname || V(n).suite || "") + " ");
		}), H("mousedown", i, (e) => b(e, V(n))), G(t, i);
	}), O(le);
	var ue = L(le, 2), de = F(ue);
	ta(de);
	var fe = L(de, 2);
	O(ue), O(w), R(() => {
		K(ee, `Automated tests (${V(p).length + V(m).length})`), K(ce, V(o)), Z(le, "hidden", !V(l) || !V(v).length), fe.disabled = V(d);
	}), H("input", oe, () => {
		P(l, !0);
	}), pi("focus", oe, () => {
		P(l, !0);
	}), pi("blur", oe, C), oa(oe, () => V(c), (e) => P(c, e)), H("keydown", de, S), oa(de, () => V(u), (e) => P(u, e)), H("click", fe, x), G(t, w), A();
}
U([
	"click",
	"input",
	"mousedown",
	"keydown"
]);
//#endregion
//#region app/svelte/VerifyingTests.svelte
var Rs = /* @__PURE__ */ W("<p class=\"cov-report-empty\">No test cases verify this requirement yet.</p>"), zs = /* @__PURE__ */ W("<div class=\"cov-vtest\"><button type=\"button\" class=\"cov-vtest-open\"><span></span> <span class=\"cov-vtest-name\"> </span> <span class=\"cov-vtest-id\"> </span></button> <button type=\"button\" class=\"cov-vtest-rm\" title=\"Unlink this test from the requirement\"></button></div>"), Bs = /* @__PURE__ */ W("<div class=\"cov-vtest-opt\"><span class=\"cov-vtest-optname\"> </span> <span class=\"cov-vtest-optid\"> </span></div>"), Vs = /* @__PURE__ */ W("<div class=\"cov-report-sec cov-vtests\"><h3> </h3> <div class=\"cov-vtest-list\"><!> <!></div> <div class=\"cov-vtest-add\"><input class=\"cov-vtest-search\" placeholder=\"Search to link an existing test…\"/> <span class=\"cov-medit-status\"> </span></div> <div class=\"cov-vtest-drop\"></div></div>");
function Hs(t, i) {
	k(i, !0);
	let a = /* @__PURE__ */ N(""), o = /* @__PURE__ */ N(""), s = /* @__PURE__ */ N(""), c = /* @__PURE__ */ N(!1), l = /* @__PURE__ */ j(() => {
		i.version;
		let e = le().find((e) => e.id === i.reqId);
		return e && e.verifiedBy || [];
	}), u = /* @__PURE__ */ j(() => (i.version, pe(de(), i.results)));
	function d(e) {
		let t = V(u).get(e);
		return t && t.status || "untested";
	}
	function f(t) {
		return t === "pass" ? e : t === "fail" ? r : n;
	}
	function p(e) {
		i.version;
		let t = de().find((t) => t.id === e);
		return t ? t.name : e;
	}
	let m = /* @__PURE__ */ j(() => {
		let e = new Set(V(l)), t = V(s).trim().toLowerCase();
		return i.version, de().filter((n) => !e.has(n.id) && (!t || n.id.toLowerCase().includes(t) || (n.name || "").toLowerCase().includes(t))).slice(0, 8);
	});
	async function g(e) {
		if (!h.unlinkTestFromRequirement) return;
		P(o, e, !0), P(a, "Unlinking…");
		let t = await h.unlinkTestFromRequirement(e, i.reqId);
		P(a, t ? "Unlinked " + e : "Unlink failed", !0), P(o, ""), t && i.onChanged();
	}
	async function _(e, t) {
		if (e.preventDefault(), !h.linkTestToRequirement) return;
		P(c, !1), P(s, ""), P(a, "Linking…");
		let n = await h.linkTestToRequirement(t, i.reqId);
		P(a, n ? "Linked " + t : "Link failed", !0), n && i.onChanged();
	}
	function v() {
		window.setTimeout(() => {
			P(c, !1);
		}, 160);
	}
	var y = Vs(), b = F(y), x = F(b);
	O(b);
	var S = L(b, 2), C = F(S), w = (e) => {
		G(e, Rs());
	};
	q(C, (e) => {
		V(l).length || e(w);
	}), J(L(C, 2), 16, () => V(l), (e) => e, (e, t) => {
		var n = zs(), a = F(n), s = F(a);
		Y(s, (e, t) => Q?.(e, t), () => f(d(t)));
		var c = L(s, 2), l = F(c, !0);
		O(c);
		var u = L(c, 2), m = F(u, !0);
		O(u), O(a);
		var h = L(a, 2);
		Y(h, (e, t) => Q?.(e, t), () => r), O(n), R((e, n) => {
			Z(a, "title", `Open ${t ?? ""}`), X(s, 1, `cov-vtest-dot tc-result-${e ?? ""}`), K(l, n), K(m, t), h.disabled = V(o) === t;
		}, [() => d(t), () => p(t)]), H("click", a, () => i.onOpenTest(t)), H("click", h, () => g(t)), G(e, n);
	}), O(S);
	var T = L(S, 2), ee = F(T);
	ta(ee);
	var te = L(ee, 2), ne = F(te, !0);
	O(te), O(T);
	var re = L(T, 2);
	J(re, 21, () => V(m), (e) => e.id, (e, t) => {
		var n = Bs(), r = F(n), i = F(r, !0);
		O(r);
		var a = L(r, 2), o = F(a, !0);
		O(a), O(n), R(() => {
			K(i, V(t).name || V(t).id), K(o, V(t).id);
		}), H("mousedown", n, (e) => _(e, V(t).id)), G(e, n);
	}), O(re), O(y), R(() => {
		K(x, `Test cases (${V(l).length ?? ""})`), K(ne, V(a)), Z(re, "hidden", !V(c) || !V(m).length);
	}), H("input", ee, () => {
		P(c, !0);
	}), pi("focus", ee, () => {
		P(c, !0);
	}), pi("blur", ee, v), oa(ee, () => V(s), (e) => P(s, e)), G(t, y), A();
}
U([
	"click",
	"input",
	"mousedown"
]);
//#endregion
//#region app/svelte/ReportPanel.svelte
var Us = /* @__PURE__ */ W("<p class=\"cov-report-desc\"> </p>"), Ws = /* @__PURE__ */ W("<a class=\"cov-report-link\">Open in its document <span class=\"wd-mounted\"></span></a>"), Gs = /* @__PURE__ */ W("<!> <!> <!> <!>", 1), Ks = /* @__PURE__ */ W("<!><a> </a>", 1), qs = /* @__PURE__ */ W("<p class=\"cov-report-link\">Verifies: <!></p>"), Js = /* @__PURE__ */ W("<p class=\"cov-report-note\"> </p>"), Ys = /* @__PURE__ */ W("<p class=\"cov-report-desc tc-report-sub\"><code> </code> <span> </span></p> <!> <!> <!> <div class=\"cov-report-sec\"><h3> </h3> <!></div> <!> <div class=\"cov-medit-bar\"><button type=\"button\" class=\"btn btn-primary\"><span class=\"wd-mounted\"></span>Run this test</button></div>", 1), Xs = /* @__PURE__ */ W("<aside class=\"cov-report\"><div class=\"cov-report-resize\" title=\"Drag to resize\"></div> <div class=\"cov-report-head\"><h2> </h2> <button class=\"cov-report-close\" title=\"Close\"></button></div> <!></aside>");
function Zs(e, t) {
	k(t, !0);
	let n = /* @__PURE__ */ N(void 0), i = /* @__PURE__ */ j(() => !!t.id && t.id.indexOf("T_") === 0), o = /* @__PURE__ */ j(() => !t.id || V(i) ? null : (t.version, le().find((e) => e.id === t.id) || null)), s = /* @__PURE__ */ j(() => !t.id || !V(i) ? null : (t.version, de().find((e) => e.id === t.id) || null)), c = /* @__PURE__ */ j(() => {
		if (!t.id || !V(i)) return "untested";
		let e = pe(V(s) ? [V(s)] : [], t.results).get(t.id);
		return e && e.status || "untested";
	}), l = /* @__PURE__ */ j(() => V(c) === "pass" ? "Pass" : V(c) === "fail" ? "Fail" : V(c) === "partial" ? "Partial" : "Untested"), d = /* @__PURE__ */ j(() => t.id && V(i) && t.results.manual ? t.results.manual[t.id] : null), f = /* @__PURE__ */ j(() => {
		let e = V(d) ? ve(V(d)) : [];
		return e.length && e[0].steps || [];
	}), p = /* @__PURE__ */ j(() => V(d) ? V(d).run : null), m = /* @__PURE__ */ j(() => {
		if (!V(p)) return "";
		let e = V(p).at && !isNaN(new Date(V(p).at).getTime()) ? new Date(V(p).at).toLocaleString() : "";
		return "Last run" + (V(p).by ? " by " + V(p).by : "") + (e ? " · " + e : "");
	}), h = /* @__PURE__ */ j(() => V(s) && V(s).steps || []);
	function g(e) {
		t.version;
		let n = le().find((t) => t.id === e);
		return n ? n.docId : void 0;
	}
	function _(e) {
		if (e.preventDefault(), !V(n)) return;
		let t = V(n), r = e.currentTarget, i = e.clientX, a = t.getBoundingClientRect().width;
		try {
			r.setPointerCapture(e.pointerId);
		} catch {}
		let o = (e) => {
			t.style.width = Math.min(window.innerWidth - 60, Math.max(320, a + (i - e.clientX))) + "px";
		}, s = () => {
			r.removeEventListener("pointermove", o), r.removeEventListener("pointerup", s);
		};
		r.addEventListener("pointermove", o), r.addEventListener("pointerup", s);
	}
	function v() {
		document.dispatchEvent(new window.CustomEvent("webdoc:run-test", { detail: { testId: t.id } }));
	}
	var y = Xs(), b = F(y), x = L(b, 2), S = F(x), C = F(S, !0);
	O(S);
	var w = L(S, 2);
	Y(w, (e, t) => Q?.(e, t), () => r), O(x), ji(L(x, 2), () => t.id, (e) => {
		var n = Si(), r = I(n), d = (e) => {
			var n = Gs(), r = I(n), i = (e) => {
				var t = Us(), n = F(t, !0);
				O(t), R(() => K(n, V(o).description)), G(e, t);
			};
			q(r, (e) => {
				V(o) && V(o).description && e(i);
			});
			var s = L(r, 2), c = (e) => {
				var n = Ws();
				Y(L(F(n)), (e, t) => Q?.(e, t), () => a), O(n), R(() => Z(n, "href", `#/${V(o).docId ?? ""}?req=${t.id ?? ""}`)), H("click", n, function(...e) {
					t.onCloseView?.apply(this, e);
				}), G(e, n);
			};
			q(s, (e) => {
				V(o) && e(c);
			});
			var l = L(s, 2);
			Ls(l, {
				get id() {
					return t.id;
				},
				get results() {
					return t.results;
				},
				get onReload() {
					return t.onReload;
				}
			}), Hs(L(l, 2), {
				get reqId() {
					return t.id;
				},
				get results() {
					return t.results;
				},
				get version() {
					return t.version;
				},
				get onOpenTest() {
					return t.onOpenNode;
				},
				get onChanged() {
					return t.onChanged;
				}
			}), G(e, n);
		}, p = (e) => {
			var n = Ys(), r = I(n), i = F(r), o = F(i, !0);
			O(i);
			var d = L(i, 2), p = F(d, !0);
			O(d), O(r);
			var _ = L(r, 2), y = (e) => {
				var n = qs();
				J(L(F(n)), 18, () => V(s).verifies, (e) => e, (e, n, r) => {
					var i = Ks(), a = I(i), o = (e) => {
						G(e, xi(","));
					};
					q(a, (e) => {
						V(r) && e(o);
					});
					var s = L(a), c = F(s, !0);
					O(s), R((e) => {
						Z(s, "href", `#/${e ?? ""}?req=${n ?? ""}`), K(c, n);
					}, [() => g(n)]), H("click", s, function(...e) {
						t.onCloseView?.apply(this, e);
					}), G(e, i);
				}), O(n), G(e, n);
			};
			q(_, (e) => {
				V(s) && V(s).verifies.length && e(y);
			});
			var b = L(_, 2), x = (e) => {
				var n = Ws();
				Y(L(F(n)), (e, t) => Q?.(e, t), () => a), O(n), R(() => Z(n, "href", `#/${V(s).docId ?? ""}?test=${t.id ?? ""}`)), H("click", n, function(...e) {
					t.onCloseView?.apply(this, e);
				}), G(e, n);
			};
			q(b, (e) => {
				V(s) && e(x);
			});
			var S = L(b, 2), C = (e) => {
				var t = Js(), n = F(t, !0);
				O(t), R(() => K(n, V(m))), G(e, t);
			};
			q(S, (e) => {
				V(m) && e(C);
			});
			var w = L(S, 2), T = F(w), ee = F(T);
			O(T), J(L(T, 2), 17, () => V(h), Mi, (e, t, n) => {
				js(e, {
					get step() {
						return V(t);
					},
					index: n,
					get ex() {
						return V(f)[n];
					}
				});
			}), O(w);
			var te = L(w, 2);
			Ls(te, {
				get id() {
					return t.id;
				},
				get results() {
					return t.results;
				},
				get onReload() {
					return t.onReload;
				}
			});
			var ne = L(te, 2), re = F(ne);
			Y(F(re), (e, t) => Q?.(e, t), () => u), kt(), O(re), O(ne), R(() => {
				K(o, t.id), X(d, 1, `tc-result tc-result-${V(c) ?? ""}`), K(p, V(l)), K(ee, `Steps (${V(h).length ?? ""})`);
			}), H("click", re, v), G(e, n);
		};
		q(r, (e) => {
			t.id && !V(i) ? e(d) : t.id && e(p, 1);
		}), G(e, n);
	}), O(y), ua(y, (e) => P(n, e), () => V(n)), R(() => {
		Z(y, "hidden", !t.id), K(C, V(i) && V(s) ? V(s).name : t.id);
	}), H("pointerdown", b, _), H("click", w, function(...e) {
		t.onDismiss?.apply(this, e);
	}), G(e, y), A();
}
U(["pointerdown", "click"]);
//#endregion
//#region app/svelte/CoverageOverlay.svelte
var Qs = [], $s = /* @__PURE__ */ W("<div></div>"), ec = /* @__PURE__ */ W("<p class=\"cov-empty\">No requirements found to test.</p>"), tc = /* @__PURE__ */ W("<!> <!> <!> <!>", 1);
function nc(e, t) {
	k(t, !0);
	let n = /* @__PURE__ */ N(qn(t.results)), r = /* @__PURE__ */ N(0), i = /* @__PURE__ */ N(qn(Qs.slice())), a = /* @__PURE__ */ N(null), o = /* @__PURE__ */ N(null), s = /* @__PURE__ */ j(() => {
		V(r);
		let e = le(), t = de();
		return {
			reqs: e,
			tests: t,
			status: fe(e, t, V(n))
		};
	});
	fr(() => {
		ue(V(s).status);
	}), fr(() => {
		let e = V(s).status;
		V(o) && V(o).setStatus(e);
	}), fr(() => {
		let e = new Set(V(i));
		V(o) && V(o).setStatusFilter(e);
	}), fr(() => {
		let e = (e) => {
			e.key === "Escape" && (V(a) === null ? t.onClose() : P(a, null));
		};
		return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
	});
	function c() {
		let e = {};
		V(s).reqs.forEach((t) => e[t.id] = []), V(s).reqs.forEach((t) => (t.traceFrom || []).forEach((n) => {
			e[n] && e[n].push(t.id);
		}));
		let t = V(s).reqs.map((t) => ({
			id: t.id,
			title: t.id,
			description: t.description,
			assumes: e[t.id] || [],
			next: []
		})), n = V(s).tests.map((e) => ({
			id: e.id,
			title: e.name || e.id,
			description: (e.steps || []).length + " step" + ((e.steps || []).length === 1 ? "" : "s"),
			assumes: (e.verifies || []).slice(),
			next: []
		})), r = new Map([...V(s).reqs.map((e) => [e.id, "req"]), ...V(s).tests.map((e) => [e.id, "test"])]);
		return {
			docs: t.concat(n),
			options: {
				nodeStatus: V(s).status,
				nodeKind: r,
				autoSize: !0,
				maxNodeW: 360,
				maxNodeH: 240,
				onSelect: (e) => {
					P(a, e, !0);
				},
				onActivate: (e) => {
					P(a, e, !0);
				}
			},
			onReady: (e) => {
				P(o, e, !0);
			}
		};
	}
	function l(e) {
		let t = V(i).includes(e) ? V(i).filter((t) => t !== e) : V(i).concat(e);
		P(i, t, !0), Qs = t;
	}
	async function u() {
		let e = await _e(g.site?.sources ?? []);
		P(n, e, !0), t.onResults(e), Wn(r);
	}
	var d = tc(), f = I(d), p = (e) => {
		var t = Si();
		ji(I(t), () => V(r), (e) => {
			var t = $s();
			Y(t, (e, t) => ys?.(e, t), c), G(e, t);
		}), G(e, t);
	}, m = (e) => {
		G(e, ec());
	};
	q(f, (e) => {
		V(s).reqs.length ? e(p) : e(m, -1);
	});
	var h = L(f, 2);
	Cs(h, {
		get off() {
			return V(i);
		},
		onToggle: l
	});
	var _ = L(h, 2);
	Ts(_, { get onExport() {
		return t.onExport;
	} }), Zs(L(_, 2), {
		get id() {
			return V(a);
		},
		get results() {
			return V(n);
		},
		get version() {
			return V(r);
		},
		onDismiss: () => {
			P(a, null);
		},
		get onCloseView() {
			return t.onClose;
		},
		onOpenNode: (e) => {
			P(a, e, !0);
		},
		onChanged: () => {
			Wn(r);
		},
		onReload: u
	}), G(e, d), A();
}
//#endregion
//#region app/svelte/RunnerOverlay.svelte
var rc = /* @__PURE__ */ W("<p class=\"runner-empty\">No test cases to run. Author a test-case table first.</p>"), ic = /* @__PURE__ */ W("<p class=\"run-verifies\"> </p>"), ac = /* @__PURE__ */ W("<th> </th>"), oc = /* @__PURE__ */ W("<tr><td class=\"run-no\"></td><td class=\"run-action tc-md\"></td><td class=\"run-expected tc-md\"></td><td class=\"run-actual\"></td><td class=\"run-result-cell\"><div class=\"run-pf\"><button type=\"button\" title=\"Pass\"></button> <button type=\"button\" title=\"Fail\"></button></div></td></tr>"), sc = /* @__PURE__ */ W("<section class=\"run-test\"><div class=\"run-test-head\"><h3> <span class=\"tc-id\"> </span></h3> <span> </span></div> <!> <div class=\"req-scroll\"><table class=\"run-grid\"><thead><tr></tr></thead><tbody></tbody></table></div>  <label class=\"run-notes-l\">Notes</label> <div></div></section>"), cc = /* @__PURE__ */ W("<div class=\"runner-overlay\" id=\"runnerOverlay\"><div class=\"runner-bar\"><span class=\"runner-title\">Test run</span> <span class=\"runner-progress\"> </span> <span style=\"flex:1\"></span> <label class=\"runner-by-l\">Tester <input class=\"runner-by\" placeholder=\"name…\"/></label> <span class=\"runner-status\"> </span> <button type=\"button\" class=\"btn\">Close</button> <button type=\"button\" class=\"btn btn-primary\">Save run</button></div> <div class=\"runner-body\"><div class=\"runner-inner\"><!> <!></div></div></div>");
function lc(t, n) {
	k(n, !0);
	let i = da(n, "results", 7), a = [
		"#",
		"Action",
		"Expected response",
		"Actual response",
		"Result"
	], o = qn(n.tests.map((e) => {
		let t = ve(i().manual[e.id]), n = t.length && t[0].steps || [];
		return {
			id: e.id,
			name: e.name || e.id,
			verifies: e.verifies || [],
			dirty: !1,
			notes: t.length && t[0].report || "",
			steps: (e.steps || []).map((e, t) => ({
				action: e.action,
				expected: e.expected,
				actual: n[t] && n[t].response || "",
				pass: n[t] && typeof n[t].pass == "boolean" ? n[t].pass : null
			}))
		};
	})), s = /* @__PURE__ */ N(qn(u())), c = /* @__PURE__ */ N(""), l = /* @__PURE__ */ N(void 0);
	function u() {
		try {
			return window.localStorage.getItem("wd-tester") || "";
		} catch {
			return "";
		}
	}
	let d = /* @__PURE__ */ j(() => {
		let e = 0, t = 0, n = 0, r = 0;
		return o.forEach((i) => i.steps.forEach((i) => {
			e++, i.pass !== null && (t++, i.pass ? n++ : r++);
		})), o.length + " test" + (o.length === 1 ? "" : "s") + " · " + t + "/" + e + " steps recorded · " + n + " pass, " + r + " fail";
	});
	function f(e) {
		let t = !1, n = !1;
		return e.steps.forEach((e) => {
			e.pass !== null && (t = !0, e.pass || (n = !0));
		}), t ? n ? "fail" : "pass" : "untested";
	}
	function p(e) {
		return e === "pass" ? "Pass" : e === "fail" ? "Fail" : "Not run";
	}
	function m(e, t, n) {
		let r = o[e].steps[t];
		r.pass = r.pass === n ? null : n, o[e].dirty = !0;
	}
	function h(e, t) {
		return (n) => {
			o[e].steps[t].actual = n, o[e].dirty = !0;
		};
	}
	function g(e) {
		return (t) => {
			o[e].notes = t, o[e].dirty = !0;
		};
	}
	function _(e) {
		let t = document.createElement("div");
		return t.appendChild(Se(String(e || ""))), t.innerHTML.trim();
	}
	async function v() {
		let e = V(s).trim();
		try {
			window.localStorage.setItem("wd-tester", e);
		} catch {}
		let t = (/* @__PURE__ */ new Date()).toISOString();
		o.forEach((n) => {
			n.dirty && (n.steps.some((e) => e.pass !== null) ? i().manual[n.id] = {
				run: {
					at: t,
					by: e
				},
				steps: n.steps.map((e) => ({
					step: e.action,
					response: _(e.actual),
					pass: e.pass
				})),
				report: _(n.notes)
			} : delete i().manual[n.id]);
		}), P(c, "Saving…");
		let r = await be(i().manual, n.sources);
		P(c, r ? "Saved." : "Save failed.", !0), r && n.onSaved();
	}
	function y(e) {
		e.key === "Escape" && n.onClose();
	}
	fr(() => {
		let e = window.setTimeout(() => {
			V(l) && V(l).focus();
		}, 30);
		return () => window.clearTimeout(e);
	});
	var b = cc(), x = F(b), S = L(F(x), 2), C = F(S, !0);
	O(S);
	var w = L(S, 4), T = L(F(w));
	ta(T), ua(T, (e) => P(l, e), () => V(l)), O(w);
	var ee = L(w, 2), te = F(ee, !0);
	O(ee);
	var ne = L(ee, 2), re = L(ne, 2);
	O(x);
	var ie = L(x, 2), ae = F(ie), oe = F(ae), se = (e) => {
		G(e, rc());
	};
	q(oe, (e) => {
		o.length || e(se);
	}), J(L(oe, 2), 19, () => o, (e) => e.id, (t, n, i) => {
		var o = sc(), s = F(o), c = F(s), l = F(c), u = L(l), d = F(u, !0);
		O(u), O(c);
		var _ = L(c, 2), v = F(_, !0);
		O(_), O(s);
		var y = L(s, 2), b = (e) => {
			var t = ic(), r = F(t);
			O(t), R((e) => K(r, `Verifies: ${e ?? ""}`), [() => V(n).verifies.join(", ")]), G(e, t);
		};
		q(y, (e) => {
			V(n).verifies.length && e(b);
		});
		var x = L(y, 2), S = F(x), C = F(S), w = F(C);
		J(w, 20, () => a, (e) => e, (e, t) => {
			var n = ac(), r = F(n, !0);
			O(n), R(() => K(r, t)), G(e, n);
		}), O(w), O(C);
		var T = L(C);
		J(T, 21, () => V(n).steps, Mi, (t, n, a) => {
			var o = oc(), s = F(o);
			s.textContent = a + 1;
			var c = L(s);
			Y(c, (e, t) => qo?.(e, t), () => ({ text: V(n).action }));
			var l = L(c);
			Y(l, (e, t) => qo?.(e, t), () => ({ text: V(n).expected }));
			var u = L(l);
			Y(u, (e, t) => Es?.(e, t), () => ({
				value: V(n).actual,
				onchange: h(V(i), a),
				placeholder: "What actually happened…"
			}));
			var d = L(u), f = F(d), p = F(f);
			let g;
			Y(p, (e, t) => Q?.(e, t), () => e);
			var _ = L(p, 2);
			let v;
			Y(_, (e, t) => Q?.(e, t), () => r), O(f), O(d), O(o), R(() => {
				g = X(p, 1, "run-pf-btn run-pf-pass", null, g, { "is-on": V(n).pass === !0 }), v = X(_, 1, "run-pf-btn run-pf-fail", null, v, { "is-on": V(n).pass === !1 });
			}), H("click", p, () => m(V(i), a, !0)), H("click", _, () => m(V(i), a, !1)), G(t, o);
		}), O(T), O(S), O(x), Y(L(x, 4), (e, t) => Es?.(e, t), () => ({
			value: V(n).notes,
			onchange: g(V(i)),
			placeholder: "Notes for this run…",
			extraClass: "run-notes"
		})), O(o), R((e, t) => {
			Z(o, "data-test-id", V(n).id), K(l, `${V(n).name ?? ""} `), K(d, V(n).id), X(_, 1, `run-test-pill tc-result tc-result-${e ?? ""}`), K(v, t);
		}, [() => f(V(n)), () => p(f(V(n)))]), G(t, o);
	}), O(ae), O(ie), O(b), R(() => {
		K(C, V(d)), K(te, V(c));
	}), H("keydown", b, y), oa(T, () => V(s), (e) => P(s, e)), H("click", ne, function(...e) {
		n.onClose?.apply(this, e);
	}), H("click", re, v), G(t, b), A();
}
U(["keydown", "click"]);
//#endregion
//#region app/svelte/islands/coverage.ts
function uc(e, t) {
	let n = wi(nc, {
		target: e,
		props: {
			results: t.results,
			onResults: t.onResults,
			onExport: t.onExport,
			onClose: t.onClose
		}
	});
	return { destroy: () => Oi(n) };
}
function dc(e, t) {
	let n = document.createElement("div");
	n.className = "wd-mounted", e.appendChild(n);
	let r = wi(lc, {
		target: n,
		props: {
			tests: t.tests,
			results: t.results,
			sources: t.sources,
			onSaved: t.onSaved,
			onClose: t.onClose
		}
	});
	return { destroy: () => {
		Oi(r), n.remove();
	} };
}
//#endregion
//#region app/svelte/stores/map.svelte.ts
var $ = qn({
	model: null,
	version: 0,
	mapMode: "all",
	focusMode: !1,
	focusId: null
}), fc = null, pc = null, mc = !1, hc = "recnext", gc = [], _c = !1, vc = !1;
function yc() {
	return {
		initialTransform: vc ? null : fc,
		animateFrom: _c ? pc : null,
		editMode: mc,
		connector: hc,
		hiddenGroups: gc.slice()
	};
}
function bc(e, t, n) {
	fc = e, pc = t, mc = n.editMode, hc = n.connector, gc = Array.from(n.hiddenGroups);
}
function xc(e, t) {
	_c = !!e, vc = !!t, $.version++;
}
function Sc(e, t) {
	$.model = e, xc(t && t.animate, t && t.refit);
}
function Cc() {
	mc = !1;
}
//#endregion
//#region app/svelte/GraphCanvas.svelte
var wc = /* @__PURE__ */ W("<div class=\"graph-canvas-host\"></div>");
function Tc(e, t) {
	k(t, !0);
	let n = {}, r = null;
	function i(e) {
		r &&= (r(), null), e && (r = e.on("change", t.onChange), t.onChange(e.getEditState())), t.onReady(e, n);
	}
	var a = wc();
	Y(a, (e, t) => bs?.(e, t), () => ({
		docs: t.docs,
		options: t.options,
		onReady: i,
		onTeardown: t.onTeardown
	})), G(e, a), A();
}
//#endregion
//#region app/svelte/MapToolbar.svelte
var Ec = /* @__PURE__ */ W("<div class=\"graph-controls\"><button type=\"button\" class=\"graph-ctrl-btn\" aria-label=\"Zoom in\" title=\"Zoom in\"><span class=\"wd-mounted\"></span></button> <button type=\"button\" class=\"graph-ctrl-btn\" aria-label=\"Zoom out\" title=\"Zoom out\"><span class=\"wd-mounted\"></span></button> <button type=\"button\" class=\"graph-ctrl-btn\" aria-label=\"Fit to view\" title=\"Fit to view\"><span class=\"wd-mounted\"></span></button></div> <button type=\"button\" title=\"Focus mode: click a node to centre the map on it and its links (Esc resets)\"><span class=\"wd-mounted\"></span> Focus</button>", 1);
function Dc(e, t) {
	k(t, !0);
	let n = 1.25;
	var r = Ec(), i = I(r), a = F(i);
	Y(F(a), (e, t) => Q?.(e, t), () => d), O(a);
	var c = L(a, 2);
	Y(F(c), (e, t) => Q?.(e, t), () => l), O(c);
	var u = L(c, 2);
	Y(F(u), (e, t) => Q?.(e, t), () => o), O(u), O(i);
	var f = L(i, 2);
	let p;
	Y(F(f), (e, t) => Q?.(e, t), () => s), kt(), O(f), R(() => {
		p = X(f, 1, "graph-focus-toggle", null, p, { "is-on": t.focusMode }), Z(f, "aria-pressed", t.focusMode ? "true" : "false");
	}), H("click", a, () => t.onZoom(n)), H("click", c, () => t.onZoom(1 / n)), H("click", u, function(...e) {
		t.onFit?.apply(this, e);
	}), H("click", f, function(...e) {
		t.onFocusToggle?.apply(this, e);
	}), G(e, r), A();
}
U(["click"]);
//#endregion
//#region app/svelte/MapSearch.svelte
var Oc = /* @__PURE__ */ W("<div class=\"graph-search\"><input type=\"search\" placeholder=\"Find a document…\" aria-label=\"Find a document in the map\" autocomplete=\"off\"/></div>");
function kc(e, t) {
	k(t, !0);
	var n = Oc(), r = F(n);
	O(n), H("input", r, (e) => t.onSearch(e.currentTarget.value)), H("keydown", r, (e) => {
		e.key === "Enter" && (e.preventDefault(), t.onSearch(e.currentTarget.value));
	}), G(e, n), A();
}
U(["input", "keydown"]);
//#endregion
//#region app/svelte/MapModeSelect.svelte
var Ac = /* @__PURE__ */ W("<span> </span>"), jc = /* @__PURE__ */ W("<button type=\"button\" role=\"option\"><span></span><span> </span></button>"), Mc = /* @__PURE__ */ W("<div class=\"graph-mapmode\"><button type=\"button\" class=\"graph-mapmode-btn\" aria-haspopup=\"listbox\">Map: <span></span><span class=\"graph-mapmode-label\"></span><span class=\"graph-mapmode-caret\"></span></button> <div class=\"graph-mapmode-menu\" role=\"listbox\"></div></div>");
function Nc(e, n) {
	k(n, !0);
	let r = /* @__PURE__ */ N(!1), i = /* @__PURE__ */ N(void 0), a = /* @__PURE__ */ j(() => n.modes.find((e) => e.value === n.current) || n.modes[0]);
	fr(() => {
		if (!V(r)) return;
		let e = (e) => {
			V(i) && !V(i).contains(e.target) && P(r, !1);
		};
		return document.addEventListener("mousedown", e), () => document.removeEventListener("mousedown", e);
	});
	function o(e) {
		P(r, !1), e !== n.current && n.onPick(e);
	}
	var s = Mc(), c = F(s), l = L(F(c)), u = L(l);
	J(u, 21, () => n.modes, (e) => e.value, (e, t) => {
		var r = Ac(), i = F(r, !0);
		O(r), R(() => {
			X(r, 1, Wi(V(t).value === n.current ? "is-cur" : void 0)), K(i, V(t).label);
		}), G(e, r);
	}), O(u), Y(L(u), (e, t) => Q?.(e, t), () => t), O(c);
	var d = L(c, 2);
	J(d, 21, () => n.modes, (e) => e.value, (e, t) => {
		var r = jc();
		let i;
		var a = F(r), s = L(a), c = F(s, !0);
		O(s), O(r), R(() => {
			i = X(r, 1, "graph-mapmode-item", null, i, { "is-sel": V(t).value === n.current }), Z(r, "aria-selected", V(t).value === n.current), X(a, 1, `graph-legend-swatch ${(V(t).swatch || "all") ?? ""}`), K(c, V(t).label);
		}), H("click", r, () => o(V(t).value)), G(e, r);
	}), O(d), O(s), ua(s, (e) => P(i, e), () => V(i)), R(() => {
		Z(c, "aria-expanded", V(r) ? "true" : "false"), X(l, 1, `graph-legend-swatch ${(V(a).swatch || "all") ?? ""}`), Z(d, "hidden", !V(r));
	}), H("click", c, () => {
		P(r, !V(r));
	}), G(e, s), A();
}
U(["click"]);
//#endregion
//#region app/svelte/EdgeLegend.svelte
var Pc = /* @__PURE__ */ W("<button type=\"button\"><span></span> </button>");
function Fc(e, t) {
	k(t, !0);
	let n = ["prereq", "recnext"];
	var r = Si();
	J(I(r), 17, () => t.kinds, ([e, t]) => e, (e, r) => {
		var i = /* @__PURE__ */ j(() => Le(V(r), 2));
		let a = () => V(i)[0], o = () => V(i)[1];
		var s = Pc();
		let c;
		var l = F(s), u = L(l, 1, !0);
		O(s), R((e) => {
			c = X(s, 1, "graph-legend-item", null, c, e), Z(s, "data-kind", a()), Z(s, "aria-pressed", t.visibility[a()] === !1 ? "false" : "true"), Z(s, "title", `Toggle ${o() ?? ""}`), X(l, 1, `graph-legend-swatch ${a() ?? ""}`), K(u, o());
		}, [() => ({
			"is-off": t.visibility[a()] === !1,
			"is-connector": t.editMode && n.includes(a()),
			"is-connector-active": t.editMode && n.includes(a()) && a() === t.connector
		})]), H("click", s, () => t.onToggle(a())), G(e, s);
	}), G(e, r), A();
}
U(["click"]);
//#endregion
//#region app/svelte/GroupLegend.svelte
var Ic = /* @__PURE__ */ W("<button type=\"button\" title=\"Dim the pages only this group can read\"><span class=\"group-dot\"></span> </button>"), Lc = /* @__PURE__ */ W("<div class=\"graph-groups\"><p class=\"graph-groups-title\">Access groups</p> <!> <p class=\"graph-groups-note\">A locked page shows a padlock: it exists, but your account cannot open it.</p></div>");
function Rc(e, t) {
	k(t, !0);
	var n = Lc();
	J(L(F(n), 2), 16, () => t.groups, (e) => e, (e, n) => {
		var r = Ic();
		let i;
		var a = F(r), o = L(a, 1, !0);
		O(r), R((e, t, n, s) => {
			i = X(r, 1, "graph-group-item", null, i, e), Z(r, "aria-pressed", t), Zi(a, `background: ${n ?? ""}`), K(o, s);
		}, [
			() => ({ "is-off": t.hidden.has(n) }),
			() => t.hidden.has(n) ? "false" : "true",
			() => x(n),
			() => S(n)
		]), H("click", r, () => t.onToggle(n)), G(e, r);
	}), kt(2), O(n), G(e, n), A();
}
U(["click"]);
//#endregion
//#region app/svelte/EditControls.svelte
var zc = /* @__PURE__ */ W("<button type=\"button\" title=\"Draw or delete connections between documents\"><span class=\"wd-mounted\"></span> Edit connections</button> <div class=\"graph-edit-hint\"> </div>", 1);
function Bc(e, t) {
	k(t, !0);
	function n(e) {
		return e.editMode ? e.selectedEdge ? "Connection selected — press Delete to remove it." : e.pendingSourceTitle ? e.connector === "prereq" ? "Now click the document “" + e.pendingSourceTitle + "” should assume (its prerequisite)." : "Now click the document to read next after “" + e.pendingSourceTitle + "”." : e.connector === "prereq" ? "Prerequisite: click a document, then the one it assumes. (Or click a line + Delete.)" : "Recommended next: click a document, then the one to read next. (Or click a line + Delete.)" : "";
	}
	let r = /* @__PURE__ */ j(() => n(t.state));
	var a = zc(), o = I(a);
	let s;
	Y(F(o), (e, t) => Q?.(e, t), () => i), kt(), O(o);
	var c = L(o, 2), l = F(c, !0);
	O(c), R(() => {
		s = X(o, 1, "graph-edit-toggle", null, s, { "is-on": t.state.editMode }), Z(o, "aria-pressed", t.state.editMode ? "true" : "false"), Z(c, "hidden", !t.state.editMode), K(l, V(r));
	}), H("click", o, function(...e) {
		t.onToggle?.apply(this, e);
	}), G(e, a), A();
}
U(["click"]);
//#endregion
//#region app/svelte/MapEmpty.svelte
var Vc = /* @__PURE__ */ W("<div class=\"graph-empty\">No documents to map.</div>");
function Hc(e) {
	G(e, Vc());
}
//#endregion
//#region app/svelte/MapOverlay.svelte
var Uc = /* @__PURE__ */ W("<div><!> <div class=\"graph-minimap\"></div> <!> <!> <div class=\"graph-legend\"><!> <!></div> <!> <!> <!></div>");
function Wc(e, t) {
	k(t, !0);
	let n = [
		{
			value: "all",
			label: "All connections",
			swatch: "all"
		},
		{
			value: "recnext",
			label: "Recommended next",
			swatch: "recnext"
		},
		{
			value: "prereq",
			label: "Prerequisite",
			swatch: "prereq"
		}
	], r = document.createElement("canvas");
	r.className = "graph-minimap-svg";
	function i(e, t) {
		return e.appendChild(t), { destroy: () => t.remove() };
	}
	let a = null, o = null, s = /* @__PURE__ */ N(qn({
		editMode: !1,
		connector: "recnext",
		pendingSourceTitle: null,
		selectedEdge: null,
		visibility: {},
		hiddenGroups: /* @__PURE__ */ new Set()
	})), c = /* @__PURE__ */ j(() => $.model ? $.model.docs : []), l = /* @__PURE__ */ j(() => {
		let e = $.model, t = [["prereq", "Prerequisite"], ["recnext", "Recommended next"]];
		return e && e.traceEdges.length && t.push(["trace", "Requirement trace"]), e && e.pageLinks.length && t.push(["pagelink", "Page link"]), t.push(["missing", "Missing"]), t;
	}), u = /* @__PURE__ */ j(() => $.model ? $.model.groups : []), d = /* @__PURE__ */ j(() => !!$.model && $.model.docs.length === 0);
	function f() {
		a && bc(a.getTransform(), a.getNodePositions(), a.getEditState());
		let e = yc(), n = !!($.focusMode && $.focusId);
		return {
			currentId: n ? $.focusId : g.current && g.current.id,
			traceEdges: $.model ? $.model.traceEdges : [],
			pageLinks: $.model ? $.model.pageLinks : [],
			externalNodes: $.model ? $.model.externalNodes : [],
			initialTransform: e.initialTransform,
			animateFrom: e.animateFrom,
			minimapCanvas: r,
			mapMode: $.mapMode,
			onMapMode: (e) => {
				$.mapMode = e, xc(!0);
			},
			hiddenGroups: new Set(e.hiddenGroups),
			focusId: n ? $.focusId : null,
			onSelect: (e) => {
				$.focusMode ? ($.focusId = $.focusId === e ? null : e, xc(!0, !0)) : h.navigate && h.navigate(e);
			},
			onActivate: (e) => {
				t.onClose(), h.navigate && h.navigate(e);
			},
			onConnect: (e, t, n) => {
				p(n === "prereq" ? [
					t,
					e,
					"assumes"
				] : [
					e,
					t,
					"next"
				], "add");
			},
			onDisconnect: (e, t, n) => {
				p(n === "prereq" ? [
					t,
					e,
					"assumes"
				] : [
					e,
					t,
					"next"
				], "remove");
			},
			onDelete: (e) => {
				h.deleteDocFlow && h.deleteDocFlow(e, { rebuildMap: !0 });
			}
		};
	}
	async function p(e, n) {
		h.editDocRelation && await h.editDocRelation(e[0], e[1], e[2], n) && await t.onRebuild(!0);
	}
	function m(e, t) {
		if (e) {
			a = e, o = t;
			let n = yc();
			n.editMode && (e.setEditMode(!0), e.setConnector(n.connector));
		} else t === o && (a = null, o = null);
	}
	function _(e) {
		P(s, e, !0);
	}
	function v(e) {
		bc(e.transform, e.positions, e.editState);
	}
	function y(e) {
		if (a) {
			if (V(s).editMode && (e === "prereq" || e === "recnext")) {
				a.setConnector(e);
				return;
			}
			a.setVisibility(e, V(s).visibility[e] === !1);
		}
	}
	function b(e) {
		if (!a) return;
		let t = Array.from(V(s).hiddenGroups);
		a.setHiddenGroups(t.includes(e) ? t.filter((t) => t !== e) : t.concat(e));
	}
	function x() {
		$.focusMode = !$.focusMode, $.focusMode || ($.focusId = null), xc(!0, !0);
	}
	fr(() => {
		let e = (e) => {
			e.key === "Escape" && ($.focusMode && $.focusId ? ($.focusId = null, xc(!0, !0)) : t.onClose());
		};
		return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
	});
	var S = Uc();
	let C;
	var w = F(S);
	ji(w, () => $.version, (e) => {
		{
			let t = /* @__PURE__ */ j(f);
			Tc(e, {
				get docs() {
					return V(c);
				},
				get options() {
					return V(t);
				},
				onReady: m,
				onChange: _,
				onTeardown: v
			});
		}
	});
	var T = L(w, 2);
	Y(T, (e, t) => i?.(e, t), () => r);
	var ee = L(T, 2);
	Dc(ee, {
		get focusMode() {
			return $.focusMode;
		},
		onZoom: (e) => {
			a && a.zoomBy(e);
		},
		onFit: () => {
			a && a.fit();
		},
		onFocusToggle: x
	});
	var te = L(ee, 2);
	kc(te, { onSearch: (e) => {
		a && a.search(e);
	} });
	var ne = L(te, 2), re = F(ne);
	Nc(re, {
		get modes() {
			return n;
		},
		get current() {
			return $.mapMode;
		},
		onPick: (e) => {
			a && a.setMapMode(e);
		}
	}), Fc(L(re, 2), {
		get kinds() {
			return V(l);
		},
		get visibility() {
			return V(s).visibility;
		},
		get editMode() {
			return V(s).editMode;
		},
		get connector() {
			return V(s).connector;
		},
		onToggle: y
	}), O(ne);
	var ie = L(ne, 2), ae = (e) => {
		Rc(e, {
			get groups() {
				return V(u);
			},
			get hidden() {
				return V(s).hiddenGroups;
			},
			onToggle: b
		});
	};
	q(ie, (e) => {
		V(u).length && e(ae);
	});
	var oe = L(ie, 2);
	Bc(oe, {
		get state() {
			return V(s);
		},
		onToggle: () => {
			a && a.setEditMode(!V(s).editMode);
		}
	});
	var se = L(oe, 2), ce = (e) => {
		Hc(e, {});
	};
	q(se, (e) => {
		V(d) && e(ce);
	}), O(S), R(() => C = X(S, 1, "graph-root", null, C, { "is-editing": V(s).editMode })), G(e, S), A();
}
//#endregion
//#region app/svelte/islands/map.ts
function Gc(e, t) {
	let n = wi(Wc, {
		target: e,
		props: {
			onClose: t.onClose,
			onRebuild: t.onRebuild
		}
	});
	return { destroy: () => {
		Oi(n), Cc();
	} };
}
//#endregion
export { pa as NoOp, Da as beginSearch, An as flushSync, ga as invalidateTree, wi as mount, Vo as mountAccountButton, uc as mountCoverageOverlay, Ya as mountCrumbs, Fa as mountDocTree, Qa as mountFooter, Ko as mountGroupChip, Gc as mountMapOverlay, hs as mountReqTable, Wo as mountRestrictedPage, Go as mountRestrictedSection, dc as mountRunner, Ia as mountSearchHits, Bo as mountSignInWall, gs as mountTestCase, Ja as mountToc, Ho as openAccountPanel, Uo as openAdminPanel, ha as setActive, Ga as setCrumbs, qa as setFootLinks, Sc as setMapModel, Ka as setToc, Oa as showHits, Xo as startCoverageSync, Oi as unmount };

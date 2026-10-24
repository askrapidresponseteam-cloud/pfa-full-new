'use strict';

/* An in-memory Firestore with the firebase-admin shape the backend uses, for
   tests that drive the real route handlers end to end: documents and
   subcollections; get, set (with merge), create, update (dotted paths, a
   lastUpdateTime precondition) and delete; queries with where, orderBy,
   limit, startAfter, select and count; transactions and batches; and the
   FieldValue sentinels (serverTimestamp, increment, arrayUnion, arrayRemove,
   delete). Timestamps are firebase-admin's own, so range queries over them
   compare as they would on the server.

   Transactions behave as Firestore's do under contention (8 Oct 2026; until
   then two transactions could both read a counter and both write it, so the
   suite could not catch a race): every document a transaction reads is
   remembered with its update time, and at commit, if any of them has changed
   since (or appeared, or gone), nothing is written and the transaction runs
   again, up to five times, then fails with ABORTED. Reads after a write in
   the same transaction are refused, as on the server. A commit applies all of
   its writes in one step, so no other request sees half of them.

   memoryFirestore({ latency: 3 }) makes every read and commit wait that many
   milliseconds, so two requests fired together really do overlap.

     const db = memoryFirestore();
     require('../lib/firebase')._setDbForTests(db);
     db.dump()  ->  { 'submissions/PFA-Q-2026-00001': {...}, ... } */

const { Timestamp } = require('firebase-admin/firestore');

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Timestamp || Buffer.isBuffer(value) || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = clone(v);
  return out;
}

const kindOf = (v) => (v && typeof v === 'object' && v.constructor ? v.constructor.name : '');
const isSentinel = (v) => /Transform$/.test(kindOf(v));

function resolve(current, value) {
  switch (kindOf(value)) {
    case 'ServerTimestampTransform': return Timestamp.now();
    case 'NumericIncrementTransform': return (Number(current) || 0) + value.operand;
    case 'ArrayUnionTransform': {
      const out = Array.isArray(current) ? current.slice() : [];
      for (const e of value.elements) if (!out.some((x) => JSON.stringify(x) === JSON.stringify(e))) out.push(clone(e));
      return out;
    }
    case 'ArrayRemoveTransform': {
      const drop = value.elements.map((e) => JSON.stringify(e));
      return (Array.isArray(current) ? current : []).filter((x) => !drop.includes(JSON.stringify(x)));
    }
    default: return clone(value);
  }
}

/* Writes an object into a document, resolving sentinels against what is
   there. merge keeps fields not named; a nested plain object merges too. */
function write(target, data, merge) {
  const out = merge ? Object.assign({}, target) : {};
  for (const [k, v] of Object.entries(data || {})) {
    if (kindOf(v) === 'DeleteTransform') { delete out[k]; continue; }
    if (merge && v && typeof v === 'object' && !Array.isArray(v) && !isSentinel(v) && kindOf(v) === 'Object'
        && out[k] && typeof out[k] === 'object' && kindOf(out[k]) === 'Object') {
      out[k] = write(out[k], v, true);
      continue;
    }
    out[k] = isSentinel(v) ? resolve(out[k], v) : (v && kindOf(v) === 'Object' ? write({}, v, false) : clone(v));
  }
  return out;
}

function getPath(data, field) {
  return String(field).split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
}

function setPath(data, field, value) {
  const keys = String(field).split('.');
  let o = data;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (kindOf(value) === 'DeleteTransform') delete o[last];
  else o[last] = isSentinel(value) ? resolve(o[last], value) : clone(value);
}

function comparable(v) {
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return v;
}

function compare(a, b) {
  const x = comparable(a);
  const y = comparable(b);
  if (x === y) return 0;
  if (x === undefined || x === null) return -1;
  if (y === undefined || y === null) return 1;
  return x < y ? -1 : 1;
}

function matches(data, [field, op, value]) {
  const v = getPath(data, field);
  if (v === undefined) return op === '!=' ? false : false;
  const same = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
  switch (op) {
    case '==': return same(v, value);
    case '!=': return !same(v, value);
    case '<': return compare(v, value) < 0;
    case '<=': return compare(v, value) <= 0;
    case '>': return compare(v, value) > 0;
    case '>=': return compare(v, value) >= 0;
    case 'in': return value.some((x) => same(v, x));
    case 'not-in': return !value.some((x) => same(v, x));
    case 'array-contains': return Array.isArray(v) && v.some((x) => same(x, value));
    case 'array-contains-any': return Array.isArray(v) && v.some((x) => value.some((y) => same(x, y)));
    default: throw new Error(`memory firestore: operator ${op} not supported`);
  }
}

function memoryFirestore(options) {
  const store = new Map();          // path -> { data, createTime, updateTime }
  let clock = 0;
  const tick = () => { clock += 1; return Timestamp.fromMillis(1790000000000 + clock); };
  const latency = Math.max(0, Number(options && options.latency) || 0);
  const pause = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());

  function snapshot(ref) {
    const hit = store.get(ref.path);
    const data = hit ? clone(hit.data) : undefined;
    return {
      id: ref.id,
      ref,
      exists: Boolean(hit),
      createTime: hit && hit.createTime,
      updateTime: hit && hit.updateTime,
      data: () => (hit ? clone(hit.data) : undefined),
      get: (field) => (data ? getPath(data, field) : undefined)
    };
  }

  function fail(code, message) { return Object.assign(new Error(`${code} ${message}`), { code }); }

  function docRef(path) {
    const parts = path.split('/');
    const ref = {
      id: parts[parts.length - 1],
      path,
      get parent() { return collectionRef(parts.slice(0, -1).join('/')); },
      collection: (name) => collectionRef(`${path}/${name}`),
      async get() { await pause(); return snapshot(ref); },
      /* the writes themselves are synchronous (the _ forms), so a batch or a
         transaction can apply several in one step */
      _set(data, opts) {
        const hit = store.get(path);
        const now = tick();
        store.set(path, { data: write(hit ? hit.data : {}, data, Boolean(opts && opts.merge)), createTime: hit ? hit.createTime : now, updateTime: now });
        return { writeTime: now };
      },
      _create(data) {
        if (store.has(path)) throw fail(6, `ALREADY_EXISTS: ${path}`);
        return ref._set(data);
      },
      _update(data, precondition) {
        const hit = store.get(path);
        if (!hit) throw fail(5, `NOT_FOUND: ${path}`);
        if (precondition && precondition.lastUpdateTime && !precondition.lastUpdateTime.isEqual(hit.updateTime)) {
          throw fail(9, `FAILED_PRECONDITION: ${path}`);
        }
        const next = clone(hit.data);
        for (const [k, v] of Object.entries(data || {})) setPath(next, k, v);
        const now = tick();
        store.set(path, { data: next, createTime: hit.createTime, updateTime: now });
        return { writeTime: now };
      },
      _delete() { store.delete(path); for (const k of [...store.keys()]) if (k.startsWith(`${path}/`)) store.delete(k); },
      async set(data, opts) { await pause(); return ref._set(data, opts); },
      async create(data) { await pause(); return ref._create(data); },
      async update(data, precondition) { await pause(); return ref._update(data, precondition); },
      async delete() { await pause(); return ref._delete(); }
    };
    return ref;
  }

  function query(collection, spec) {
    const q = {
      where: (field, op, value) => query(collection, Object.assign({}, spec, { filters: spec.filters.concat([[field, op, value]]) })),
      orderBy: (field, dir) => query(collection, Object.assign({}, spec, { orders: spec.orders.concat([[field, dir === 'desc' ? -1 : 1]]) })),
      limit: (n) => query(collection, Object.assign({}, spec, { limit: n })),
      startAfter: (...values) => query(collection, Object.assign({}, spec, { after: values })),
      select: () => q,
      count: () => ({ async get() { const r = await q.get(); return { data: () => ({ count: r.size }) }; } }),
      async get() {
        await pause();
        return q._run();
      },
      _run() {
        const depth = collection.split('/').length + 1;
        let docs = [...store.keys()]
          .filter((k) => k.startsWith(`${collection}/`) && k.split('/').length === depth)
          .map((k) => snapshot(docRef(k)))
          .filter((s) => spec.filters.every((f) => matches(s.data(), f)));
        const orders = spec.orders.length ? spec.orders : [];
        /* '__name__' is the document's own name, as on the server
           (FieldPath.documentId()): every document has one */
        const valueOf = (s, field) => (String(field) === '__name__' ? s.id : getPath(s.data(), field));
        /* as Firestore does: a query ordered by a field leaves out every
           document that does not have it */
        docs = docs.filter((s) => orders.every(([field]) => valueOf(s, field) !== undefined));
        docs.sort((a, b) => {
          for (const [field, dir] of orders) {
            const c = compare(valueOf(a, field), valueOf(b, field));
            if (c) return c * dir;
          }
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        if (spec.after) {
          const marks = spec.after.length === 1 && spec.after[0] && spec.after[0].ref
            ? orders.map(([field]) => spec.after[0].get(field))
            : spec.after;
          const i = docs.findIndex((s) => {
            for (let n = 0; n < orders.length && n < marks.length; n += 1) {
              const c = compare(valueOf(s, orders[n][0]), marks[n]) * orders[n][1];
              if (c !== 0) return c > 0;
            }
            return false;
          });
          docs = i < 0 ? [] : docs.slice(i);
        }
        if (spec.limit != null) docs = docs.slice(0, spec.limit);
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
      }
    };
    return q;
  }

  function collectionRef(path) {
    const base = query(path, { filters: [], orders: [] });
    let auto = 0;
    return Object.assign(base, {
      id: path.split('/').pop(),
      path,
      doc: (id) => docRef(`${path}/${id == null ? `auto${(auto += 1)}${Date.now().toString(36)}` : id}`),
      /* as Firestore's: every document here, including one that does not
         exist itself but has documents under it */
      async listDocuments() {
        await pause();
        const depth = path.split('/').length;
        const ids = new Set();
        for (const k of store.keys()) if (k.startsWith(`${path}/`)) ids.add(k.split('/')[depth]);
        return [...ids].sort().map((id) => docRef(`${path}/${id}`));
      },
      async add(data) { const ref = docRef(`${path}/auto${(auto += 1)}${Date.now().toString(36)}`); await ref.set(data); return ref; }
    });
  }

  function writer() {
    const ops = [];
    const api = {
      set(ref, data, opts) { ops.push(() => ref._set(data, opts)); return api; },
      create(ref, data) { ops.push(() => ref._create(data)); return api; },
      update(ref, data, pre) { ops.push(() => ref._update(data, pre)); return api; },
      delete(ref) { ops.push(() => ref._delete()); return api; },
      _pending: () => ops.length,
      /* all or nothing, in one synchronous step: nothing else runs between
         the check (a transaction's reads) and the last write */
      _apply(check) {
        const plan = ops.slice();
        ops.length = 0;
        if (check && check() === false) return null;   // a transaction that lost a race writes nothing
        const before = new Map(store);
        try { for (const op of plan) op(); } catch (error) { store.clear(); for (const [k, v] of before) store.set(k, v); throw error; }
        return [];
      },
      async commit() { await pause(); return api._apply(); }
    };
    return api;
  }

  const stamp = (path) => { const hit = store.get(path); return hit ? hit.updateTime.toMillis() : null; };

  return {
    collection: collectionRef,
    doc: docRef,
    batch: writer,
    async runTransaction(fn) {
      for (let attempt = 1; ; attempt += 1) {
        const tx = writer();
        const seen = new Map();   // path -> update time when read (null: absent)
        const note = (snap) => { if (!seen.has(snap.ref.path)) seen.set(snap.ref.path, snap.exists ? snap.updateTime.toMillis() : null); return snap; };
        const guard = () => { if (tx._pending()) throw fail(3, 'INVALID_ARGUMENT: Firestore transactions require all reads to be executed before all writes.'); };
        tx.get = async (refOrQuery) => {
          guard();
          await pause();
          if (typeof refOrQuery._run === 'function') {
            const r = refOrQuery._run();
            r.docs.forEach(note);
            return r;
          }
          return note(snapshot(refOrQuery));
        };
        tx.getAll = async (...refs) => { guard(); await pause(); return refs.map((r) => note(snapshot(r))); };
        const result = await fn(tx);
        await pause();
        let conflict = false;
        tx._apply(() => {
          for (const [path, at] of seen) if (stamp(path) !== at) { conflict = true; break; }
          return !conflict;
        });
        if (!conflict) return result;
        if (attempt >= 5) throw fail(10, 'ABORTED: Too much contention on these documents. Please try again.');
      }
    },
    async getAll(...refs) { await pause(); return refs.map((r) => snapshot(r)); },
    dump() { const out = {}; for (const [k, v] of store) out[k] = clone(v.data); return out; },
    _store: store
  };
}

module.exports = { memoryFirestore };

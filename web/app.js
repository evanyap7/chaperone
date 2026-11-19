/* Chaperone web app. Vanilla JS, no dependencies, works offline.
   Talks to the server in src/app.js:
     GET  /api/state         full snapshot
     POST /api/demo/run      202 {ok, scenarios} | 409 already running
     POST /api/queue/decide  {queue_id, decision: approve|deny}
                             200 {ok, queue} | {ok:false, code, error}
                             codes: invalid 400, not_found 404, never 403, already_decided 409
     GET  /api/events        SSE: hello, action, queue, scorecard, briefing, reset, demo, scenario
   Every number on screen is computed from that data; nothing is invented here. */
(function () {
  'use strict';

  // ------------------------------------------------------------------ constants
  const TABS = ['today', 'log', 'queue', 'facts', 'lineage', 'score'];
  const AGENTS = ['Marketing', 'Sales', 'Ops', 'Finance', 'Support'];
  const DEC = {
    ALLOW: { cls: 'done', label: 'Done', icon: 'i-done', filter: 'Done' },
    HOLD_FOR_APPROVAL: { cls: 'waiting', label: 'Waiting for you', icon: 'i-wait', filter: 'Waiting for you' },
    BLOCK: { cls: 'blocked', label: 'Stopped', icon: 'i-stop', filter: 'Stopped' },
  };
  const LEVELS = {
    public: { label: 'Public', n: 1, pill: 'public' },
    internal: { label: 'Studio only', n: 2, pill: 'internal' },
    'client-confidential': { label: 'Client confidential', n: 3, pill: 'confidential' },
    regulated: { label: 'Personal or regulated', n: 4, pill: 'regulated' },
  };
  const LEVEL_ORDER = ['regulated', 'client-confidential', 'internal', 'public'];
  const ACTION_WORDS = {
    read_file: 'read a file', list_dir: 'list a folder', write_file: 'write a file',
    delete_file: 'delete a file', send_email: 'send an email',
    upload_to_external_tool: 'upload to an outside tool', pay_supplier: 'pay a supplier',
    order_from_supplier: 'place a supplier order',
  };
  const UNDO_MS = 5000;

  // ---------------------------------------------------------------------- state
  const S = {
    log: [], byId: new Map(), queue: new Map(), results: [], classifier: null,
    briefing: null, lineage: [], demoRunning: false,
    scenarioIds: [], scen: new Map(), // id -> {name, status, points}
    filters: { dec: 'all', agent: 'all' },
    pending: new Map(), // queue_id -> {decision, until, timer, tick}
    errors: new Map(),  // queue_id -> message
    open: new Set(),    // ids of open <details>
    videoOk: false,
    tab: 'today',
  };

  // -------------------------------------------------------------------- helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
  const money = (n) => 'SGD ' + Number(n).toLocaleString('en-SG');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
  function timeOf(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  const stripPrefix = (line) => cap(String(line || '').replace(/^(Blocked|Held|Allowed):\s*/, ''));
  const levelOf = (lv) => LEVELS[lv] || { label: lv || 'Unknown', n: 0, pill: 'internal' };
  const levelPill = (lv) => { const L = levelOf(lv); return `<span class="pill pill-level-${L.pill}">${esc(L.label)}</span>`; };
  const decPill = (d, label) => { const D = DEC[d]; return D ? `<span class="pill pill-status-${D.cls}">${icon(D.icon)}${esc(label || D.label)}</span>` : ''; };
  const agentPill = (a) => `<span class="pill pill-agent">${esc(a)}</span>`;
  const meter = () => '<span class="meter" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

  function dedupeEvidence(list) {
    const seen = new Set();
    const out = [];
    for (const ev of list || []) {
      const k = `${ev.file}|${ev.line}|${ev.quote}`;
      const prev = out.find((o) => `${o.file}|${o.line}|${o.quote}` === k);
      if (prev) { if (ev.why && !prev.whys.includes(ev.why)) prev.whys.push(ev.why); continue; }
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ file: ev.file, line: ev.line, quote: ev.quote, whys: ev.why ? [ev.why] : [] });
    }
    return out;
  }
  function fileref(file, line) {
    return `<span class="fileref">${icon('i-file')}<code class="path">${esc(file)}</code>${line != null ? `<span class="ln">line ${esc(line)}</span>` : ''}</span>`;
  }
  // Quotes are shown verbatim apart from markdown table/bold syntax, which reads as noise to a non-technical owner.
  const cleanQuote = (q) => String(q || '').replace(/\*\*/g, '').replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ' — ');
  function quoteFig(ev, extraCls) {
    const whys = ev.whys && ev.whys.length ? `<ul class="why">${ev.whys.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    return `<figure class="quote${extraCls ? ' ' + extraCls : ''}">${whys}<blockquote><p>${esc(cleanQuote(ev.quote))}</p></blockquote><figcaption>${fileref(ev.file, ev.line)}</figcaption></figure>`;
  }
  function techDetails(e, extra) {
    const rows = [
      ['Rules', (e.rules || []).join(', ') || 'none'],
      ['Action', e.action],
      ['Log entry', '#' + e.id],
      ['Scenario', e.scenario],
      ['File level', e.data_level],
    ];
    if (extra) rows.push(...extra);
    return `<details class="tech"><summary>${icon('i-chev')}Technical details</summary><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`;
  }

  // Formats the file's real value in the same shape as the claim: "25%" + 20 -> "20%".
  function formatReal(claimed, real) {
    if (real == null) return null;
    const m = String(claimed).match(/^([^\d]*)([\d][\d,.]*)(.*)$/);
    if (!m) return String(real);
    const num = typeof real === 'number' ? real : Number(String(real).replace(/,/g, ''));
    const body = m[2].includes(',') || num >= 10000 ? num.toLocaleString('en-SG') : String(num);
    return m[1] + body + m[3];
  }

  // --------------------------------------------------------------- live region
  // One polite region (#announcer). Streaming actions are aggregated and spoken
  // at most every 1.5s so a screen reader is never flooded.
  const ann = { msgs: [], counts: { ALLOW: 0, HOLD_FOR_APPROVAL: 0, BLOCK: 0 }, timer: null };
  function announce(msg) { if (msg) ann.msgs.push(msg); scheduleAnnounce(); }
  function countForAnnounce(dec) { if (ann.counts[dec] != null) ann.counts[dec]++; scheduleAnnounce(); }
  function scheduleAnnounce() {
    if (ann.timer) return;
    ann.timer = setTimeout(() => {
      ann.timer = null;
      const c = ann.counts;
      const total = c.ALLOW + c.HOLD_FOR_APPROVAL + c.BLOCK;
      const parts = [];
      if (total) {
        const bits = [];
        if (c.BLOCK) bits.push(`${c.BLOCK} stopped`);
        if (c.HOLD_FOR_APPROVAL) bits.push(`${c.HOLD_FOR_APPROVAL} waiting for you`);
        if (c.ALLOW) bits.push(`${c.ALLOW} done`);
        parts.push(`${plural(total, 'new action')}: ${bits.join(', ')}.`);
      }
      parts.push(...ann.msgs);
      ann.msgs = []; ann.counts = { ALLOW: 0, HOLD_FOR_APPROVAL: 0, BLOCK: 0 };
      if (!parts.length) return;
      const el = $('#announcer');
      el.textContent = '';
      requestAnimationFrame(() => { el.textContent = parts.join(' '); });
    }, 1500);
  }

  // -------------------------------------------------------------------- toasts
  function toast(text, kind, sub) {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    const ic = kind === 'approved' ? 'i-done' : kind === 'info' ? 'i-know' : 'i-stop';
    t.innerHTML = `${icon(ic)}<div class="toast-body"><p class="toast-text">${esc(text)}</p>${sub ? `<p class="toast-sub">${esc(sub)}</p>` : ''}</div><button type="button" class="toast-close" aria-label="Dismiss this message">${icon('i-close')}</button>`;
    const kill = () => { if (t.parentNode) t.remove(); };
    t.querySelector('.toast-close').addEventListener('click', kill);
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(kill, 7000);
  }

  // -------------------------------------------------------------- derived data
  function counts() {
    const c = { total: S.log.length, ALLOW: 0, HOLD_FOR_APPROVAL: 0, BLOCK: 0, stopped: 0, scope: 0 };
    for (const e of S.log) {
      c[e.decision] = (c[e.decision] || 0) + 1;
      if (e.decision === 'BLOCK') { if (e.scope_creep && e.scope_creep.length) c.scope++; else c.stopped++; }
    }
    const pend = [...S.queue.values()].filter((q) => q.status === 'pending' && !S.pending.has(q.queue_id));
    c.pending = pend.length;
    c.pendingMoney = pend.reduce((a, q) => a + (Number(q.money_at_stake) || 0), 0);
    return c;
  }
  const pendingQueue = () => [...S.queue.values()].filter((q) => q.status === 'pending').sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const decidedQueue = () => [...S.queue.values()].filter((q) => q.status !== 'pending').sort((a, b) => (a.decided_at || '') < (b.decided_at || '') ? 1 : -1);
  function levelMap() {
    const m = new Map();
    for (const n of S.lineage || []) if (n && n.id) m.set(n.id, n.level);
    for (const e of S.log) {
      for (const n of e.lineage_chain || []) if (n.id && !m.has(n.id)) m.set(n.id, n.level);
      if ((e.files_touched || []).length === 1 && !m.has(e.files_touched[0])) m.set(e.files_touched[0], e.data_level);
    }
    return m;
  }

  // ------------------------------------------------------------------- log rows
  function flagPill(e) {
    if ((e.fact_check || []).some((f) => f.status !== 'ok')) return '<span class="pill pill-status-fabricated">Wrong figures</span>';
    if (e.injection && e.injection.flagged) return `<span class="pill pill-status-fabricated">${icon('i-mail')}Hidden instruction</span>`;
    if ((e.scope_creep || []).length) return `<span class="pill pill-status-regulated">${icon('i-eye')}Not needed</span>`;
    return '';
  }
  function statusPills(e) {
    if (e.decision === 'HOLD_FOR_APPROVAL' && e.queue_id) {
      const q = S.queue.get(e.queue_id);
      if (q && q.status === 'approved') return decPill('ALLOW', 'You approved');
      if (q && q.status === 'denied') return `<span class="pill pill-status-blocked">${icon('i-cross-circle')}You said no</span>`;
    }
    return decPill(e.decision) + flagPill(e);
  }
  function rowFiles(e) {
    const files = e.files_touched || [];
    const lv = levelOf(e.data_level).label;
    if (!files.length) return `<span class="row-files">${esc(lv)}</span>`;
    return `<span class="row-files"><code>${files.map(esc).join(', ')}</code> · ${esc(lv)}</span>`;
  }
  function rowBody(e) {
    const parts = [];
    parts.push(`<p class="rb-task"><strong>${esc(e.agent)}</strong> was asked to ${esc(e.task)} and wanted to ${esc(ACTION_WORDS[e.action] || e.action)}.</p>`);
    const ev = dedupeEvidence(e.evidence);
    if (ev.length) parts.push(`<div class="rb-sec"><h4 class="rb-h">The lines in your files that decided it</h4>${ev.map((x) => quoteFig(x)).join('')}</div>`);
    const fc = e.fact_check || [];
    if (fc.length) {
      parts.push(`<div class="rb-sec"><h4 class="rb-h">Figures checked</h4><ul class="mini-facts">${fc.map((f) => {
        const real = formatReal(f.claimed, f.real);
        return f.status === 'ok'
          ? `<li>${icon('i-done')}<b>${esc(f.claimed)}</b> matches your file</li>`
          : `<li><span class="sr-only">Agent wrote</span><s>${esc(f.claimed)}</s>${icon('i-arrow')}<span class="sr-only">your file says</span>${real ? `<b>${esc(real)}</b>` : 'not on file'}</li>`;
      }).join('')}</ul><div class="rb-links"><button type="button" class="link" data-goto="facts">See the full fact-check ${icon('i-arrow')}</button></div></div>`);
    }
    if (e.injection && e.injection.flagged) {
      const inj = e.injection;
      parts.push(`<div class="inj"><p class="inj-h">${icon('i-mail')}An inbound message tried to give your agent an instruction</p>${quoteFig({ file: inj.file, line: inj.line, quote: inj.quote, whys: [] }, 'as-data')}<p class="data-note">${icon('i-done')}<span>Chaperone treated this text as information, not as an instruction. It was not followed.</span></p></div>`);
    }
    const sc = e.scope_creep || [];
    if (sc.length) parts.push(`<div class="rb-sec"><h4 class="rb-h">Opened but not needed for the task</h4><ul class="rb-list">${sc.map((s) => `<li>${icon('i-lock', '')}<code>${esc(s.file)}</code>${levelPill(s.level)}</li>`).join('')}</ul></div>`);
    const ch = e.lineage_chain || [];
    if (ch.length > 1) {
      parts.push(`<div class="rb-sec"><h4 class="rb-h">Where this file came from</h4><p class="mini-chain">${ch.map((n) => `<code>${esc(n.id)}</code> ${levelPill(n.level)}`).join(icon('i-arrow'))}</p><div class="rb-links"><button type="button" class="link" data-goto="lineage">See where files went ${icon('i-arrow')}</button></div></div>`);
    }
    if (e.queue_id) parts.push(`<div class="rb-links"><button type="button" class="link" data-goto="queue">Open it in Approvals ${icon('i-arrow')}</button></div>`);
    parts.push(techDetails(e));
    return parts.join('');
  }
  function buildRow(e, prefix) {
    const d = document.createElement('details');
    const id = (prefix || 'log-') + e.id;
    d.className = 'row d-' + e.decision;
    d.id = id;
    d.dataset.dec = e.decision;
    d.dataset.agent = e.agent;
    d.dataset.lid = e.id;
    if (S.open.has(id)) d.open = true;
    d.innerHTML = `<summary><time class="row-time" datetime="${esc(e.ts)}">${esc(timeOf(e.ts))}</time>${agentPill(e.agent)}<span class="row-action"><span class="row-text">${esc(stripPrefix(e.owner_line))}</span>${rowFiles(e)}</span><span class="row-status">${statusPills(e)}</span><span class="pill pill-scenario" title="Demo scenario">${esc(e.scenario)}</span>${icon('i-chev', 'chev')}</summary><div class="row-body">${rowBody(e)}</div>`;
    return d;
  }
  function refreshRowStatus(qid) {
    for (const e of S.log) {
      if (e.queue_id !== qid) continue;
      for (const pre of ['log-', 'today-log-']) {
        const r = document.getElementById(pre + e.id);
        const st = r && r.querySelector('.row-status');
        if (st) st.innerHTML = statusPills(e);
      }
    }
  }

  // ------------------------------------------------------------------ log tab
  function renderFilters() {
    const c = counts();
    const decs = [['all', 'Everything', null, c.total], ['BLOCK', 'Stopped', 'i-stop', c.BLOCK], ['HOLD_FOR_APPROVAL', 'Waiting for you', 'i-wait', c.HOLD_FOR_APPROVAL], ['ALLOW', 'Done', 'i-done', c.ALLOW]];
    const df = $('#decFilter');
    df.innerHTML = decs.map(([k, l, ic, n]) => `<button type="button" data-dec="${k}" aria-pressed="${S.filters.dec === k}">${ic ? icon(ic) : ''}${esc(l)} <span class="u-mono">${n}</span></button>`).join('');
    const per = {};
    for (const e of S.log) per[e.agent] = (per[e.agent] || 0) + 1;
    const af = $('#agentFilter');
    af.innerHTML = [['all', 'All agents', c.total]].concat(AGENTS.map((a) => [a, a, per[a] || 0])).map(([k, l, n]) => `<button type="button" data-agent="${esc(k)}" aria-pressed="${S.filters.agent === k}">${esc(l)} <span class="u-mono">${n}</span></button>`).join('');
  }
  function applyFilters() {
    const list = $('#logList');
    let shown = 0;
    for (const r of list.children) {
      const ok = (S.filters.dec === 'all' || r.dataset.dec === S.filters.dec) && (S.filters.agent === 'all' || r.dataset.agent === S.filters.agent);
      r.hidden = !ok;
      if (ok) shown++;
    }
    const c = counts();
    const empty = c.total === 0;
    $('#logEmpty').classList.toggle('hidden', !empty);
    $('#logNone').classList.toggle('hidden', empty || shown > 0);
    list.classList.toggle('hidden', empty || shown === 0);
    $('#filters').classList.toggle('hidden', empty);
    const sum = $('#logSummary');
    if (empty) { sum.textContent = ''; sum.classList.add('hidden'); return; }
    sum.classList.remove('hidden');
    const filtered = S.filters.dec !== 'all' || S.filters.agent !== 'all';
    sum.textContent = filtered
      ? `Showing ${shown} of ${plural(c.total, 'action')}.`
      : `${plural(c.total, 'action')} so far: ${c.BLOCK} stopped, ${c.HOLD_FOR_APPROVAL} waiting for your yes, ${c.ALLOW} done.`;
    const lc = $('#logCount');
    lc.textContent = String(c.total);
    lc.classList.toggle('hidden', !c.total);
  }
  function rebuildLog() {
    const list = $('#logList');
    list.textContent = '';
    const frag = document.createDocumentFragment();
    for (let i = S.log.length - 1; i >= 0; i--) frag.appendChild(buildRow(S.log[i]));
    list.appendChild(frag);
    renderFilters();
    applyFilters();
  }
  function prependRow(e) {
    const r = buildRow(e);
    r.classList.add('fresh');
    r.addEventListener('animationend', () => r.classList.remove('fresh'), { once: true });
    $('#logList').prepend(r);
  }

  // ----------------------------------------------------------- approval cards
  function logFor(q) { return S.byId.get(q.log_id); }
  function recText(q) {
    const e = logFor(q);
    const why = e ? stripPrefix(e.owner_line).replace(/\s*Recommend:.*$/i, '') : '';
    if (q.recommendation === 'deny') return { cls: 'rec-deny', ic: 'i-stop', head: 'Chaperone recommends: no.', why };
    return { cls: 'rec-review', ic: 'i-eye', head: 'Chaperone recommends: look closely.', why };
  }
  function cardHtml(q, where) {
    const compact = where === 'today';
    const e = logFor(q);
    const k = `${where}-${q.queue_id}`;
    const rec = recText(q);
    const pend = S.pending.get(q.queue_id);
    const err = S.errors.get(q.queue_id);
    const whyId = `why-${k}`;
    const ev = e ? dedupeEvidence(e.evidence) : [];
    const related = S.log.filter((x) => x.queue_id === q.queue_id);
    const stake = q.money_at_stake != null ? `<p class="stake"><span class="amt">${esc(money(q.money_at_stake))}</span><span class="lbl">at stake</span></p>` : '';
    let actions;
    if (pend) {
      const left = Math.max(0, Math.ceil((pend.until - Date.now()) / 1000));
      const verb = pend.decision === 'approve' ? 'You approved this.' : 'You said no.';
      actions = `<div class="undo u-${pend.decision}" data-undo="${q.queue_id}"><p class="undo-text"><strong>${verb}</strong> Recording it in <span class="n" data-count="${q.queue_id}">${left}</span>s.</p><button type="button" class="btn btn-secondary btn-undo" data-act="undo" data-q="${q.queue_id}" data-key="undo-${k}">${icon('i-undo')}Undo</button><span class="undo-bar" aria-hidden="true"><i style="animation-duration:${Math.max(0, pend.until - Date.now())}ms"></i></span></div>`;
    } else {
      const denyCls = where === 'queue' ? 'btn btn-danger btn-deny' : 'btn btn-danger';
      const approve = q.never
        ? `<button type="button" class="btn btn-approve" disabled>Approve</button>`
        : `<button type="button" class="btn btn-approve" data-act="approve" data-q="${q.queue_id}" data-key="approve-${k}" aria-describedby="qt-${k}">${icon('i-done')}Approve</button>`;
      actions = `<div class="card-actions">${approve}<button type="button" class="${denyCls}" data-act="deny" data-q="${q.queue_id}" data-key="deny-${k}" aria-describedby="qt-${k}">${icon('i-cross')}Say no</button></div>`;
    }
    const extra = related.length > 1 ? `<p class="card-note">${esc(plural(related.length, 'payment'))} were attempted against this one invoice. Approving releases the whole amount.</p>` : '';
    const whyBody = ev.length || e
      ? `<details class="why-held" id="${whyId}"${S.open.has(whyId) ? ' open' : ''}><summary>${icon('i-chev', 'chev')}Why it was held</summary><div class="why-body">${ev.map((x) => quoteFig(x)).join('')}${e ? techDetails(e, [['Approval', q.queue_id]]) : ''}</div></details>`
      : '';
    return `<article class="card card-pending${compact ? ' compact' : ''}${q.never ? ' card-never' : ''}${pend ? ' is-pending' : ''}" id="card-${k}" data-qid="${q.queue_id}" aria-labelledby="qt-${k}">
      <div class="card-top"><div class="card-who">${agentPill(q.agent)}<span class="card-when"><time datetime="${esc(q.created_at)}">${esc(timeOf(q.created_at))}</time></span>${e ? `<span class="pill pill-scenario card-scen">${esc(e.scenario)}</span>` : ''}</div>${stake}</div>
      <h3 class="card-title" id="qt-${k}">${esc(q.summary)}</h3>
      <p class="rec ${rec.cls}">${icon(rec.ic)}<span><strong>${rec.head}</strong>${rec.why && !compact ? ' ' + esc(rec.why) : ''}</span></p>
      ${compact ? '' : extra}
      ${compact ? '' : whyBody}
      ${actions}
      <p class="card-err" role="alert"${err ? '' : ' hidden'}>${esc(err || '')}</p>
    </article>`;
  }
  function withFocus(container, fn) {
    const a = document.activeElement;
    const key = a && container.contains(a) && a.dataset ? a.dataset.key : null;
    fn();
    if (key) {
      const el = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (el) el.focus();
      else {
        const card = a && a.closest && a.closest('[data-qid]');
        const fallback = container.querySelector('button[data-act]') || $('#' + (container.id === 'todayQueue' ? 'h-waiting' : 'h-pending'));
        if (fallback) { if (!fallback.hasAttribute('tabindex') && fallback.tagName === 'H2') fallback.tabIndex = -1; fallback.focus(); }
        void card;
      }
    }
  }
  function renderQueue() {
    const pend = pendingQueue();
    const dec = decidedQueue();
    const hasLog = S.log.length > 0;
    const ql = $('#queueList');
    withFocus(ql, () => { ql.innerHTML = pend.map((q) => cardHtml(q, 'queue')).join(''); });
    $('#queueEmpty').classList.toggle('hidden', pend.length > 0);
    $('#queueEmptyRun').classList.toggle('hidden', hasLog);
    $('#queueEmptyBack').classList.toggle('hidden', !hasLog);
    $('#decidedWrap').classList.toggle('hidden', dec.length === 0);
    $('#decidedList').innerHTML = dec.map((q) => {
      const ok = q.status === 'approved';
      return `<li class="dec-${esc(q.status)}">${icon(ok ? 'i-done' : 'i-cross-circle')}<span class="what">${esc(q.summary)}</span><span class="pill ${ok ? 'pill-status-done' : 'pill-status-blocked'}">${ok ? 'You approved this' : 'You said no'}</span>${q.decided_at ? `<time datetime="${esc(q.decided_at)}">${esc(timeOf(q.decided_at))}</time>` : ''}</li>`;
    }).join('');
    const c = counts();
    const b = $('#queueBadge');
    b.textContent = String(c.pending);
    b.classList.toggle('hidden', c.pending === 0);
    const tb = $('#tabbtn-queue');
    tb.setAttribute('aria-label', c.pending ? `Approvals, ${plural(c.pending, 'item')} waiting` : 'Approvals');
  }

  // ------------------------------------------------------------ decide + undo
  function startDecision(qid, decision) {
    if (S.pending.has(qid)) return;
    const q = S.queue.get(qid);
    if (!q || q.status !== 'pending') return;
    S.errors.delete(qid);
    const p = { decision, until: Date.now() + UNDO_MS };
    p.timer = setTimeout(() => commitDecision(qid), UNDO_MS);
    p.tick = setInterval(() => {
      for (const el of $$(`[data-count="${qid}"]`)) el.textContent = String(Math.max(0, Math.ceil((p.until - Date.now()) / 1000)));
    }, 250);
    S.pending.set(qid, p);
    renderQueueAndToday();
    const undo = $(`#tab-${S.tab} [data-act="undo"][data-q="${qid}"]`);
    if (undo) undo.focus();
    announce(`${decision === 'approve' ? 'Approved' : 'Said no to'}: ${q.summary} Recording it in ${UNDO_MS / 1000} seconds. Press Undo to change your mind.`);
  }
  function clearPending(qid) {
    const p = S.pending.get(qid);
    if (!p) return null;
    clearTimeout(p.timer); clearInterval(p.tick);
    S.pending.delete(qid);
    return p;
  }
  function undoDecision(qid) {
    if (!clearPending(qid)) return;
    renderQueueAndToday();
    const btn = $(`#tab-${S.tab} [data-act="approve"][data-q="${qid}"]`) || $(`#tab-${S.tab} [data-act="deny"][data-q="${qid}"]`);
    if (btn) btn.focus();
    announce('Undone. It is still waiting for you.');
  }
  async function commitDecision(qid) {
    const p = clearPending(qid);
    if (!p) return;
    const q = S.queue.get(qid);
    let res, body;
    try {
      res = await fetch('/api/queue/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queue_id: qid, decision: p.decision }) });
      body = await res.json().catch(() => ({}));
    } catch (_) {
      S.errors.set(qid, 'Could not reach Chaperone, so nothing was recorded. Try again.');
      renderQueueAndToday();
      announce('Could not record that decision. Try again.');
      return;
    }
    if (res.ok && body && body.ok) {
      upsertQueue(body.queue);
      const ok = body.queue.status === 'approved';
      toast(ok ? 'Approved. The agent can go ahead.' : 'You said no. Nothing was done.', ok ? 'approved' : '', q ? q.summary : '');
      announce(ok ? `Recorded: approved. ${q ? q.summary : ''}` : `Recorded: you said no. ${q ? q.summary : ''}`);
      return;
    }
    const code = body && body.code;
    let msg;
    if (code === 'never') msg = 'Nobody can approve this. It breaks a rule that has no exceptions, so it stays stopped.';
    else if (code === 'already_decided') {
      if (body.queue) upsertQueue(body.queue);
      msg = null;
      toast('This was already decided.', 'info', body.queue ? `It was ${body.queue.status === 'approved' ? 'approved' : 'turned down'} earlier.` : '');
      announce('This was already decided earlier.');
    } else if (code === 'not_found') {
      msg = null;
      S.queue.delete(qid);
      toast('That approval no longer exists.', 'info', 'The demo may have been run again since this page loaded.');
      announce('That approval no longer exists.');
    } else msg = 'Could not record that. Try again.';
    if (msg) { S.errors.set(qid, msg); announce(msg); }
    renderQueueAndToday();
  }
  // Leaving the page mid-countdown still records what the person chose.
  window.addEventListener('pagehide', () => {
    for (const [qid, p] of S.pending) {
      clearTimeout(p.timer); clearInterval(p.tick);
      try { navigator.sendBeacon('/api/queue/decide', new Blob([JSON.stringify({ queue_id: qid, decision: p.decision })], { type: 'application/json' })); } catch (_) { /* best effort */ }
    }
    S.pending.clear();
  });

  function upsertQueue(q) {
    if (!q || !q.queue_id) return;
    const prev = S.queue.get(q.queue_id);
    S.queue.set(q.queue_id, q);
    if (q.status !== 'pending') { clearPending(q.queue_id); S.errors.delete(q.queue_id); }
    if (!prev || prev.status !== q.status) refreshRowStatus(q.queue_id);
  }

  // ---------------------------------------------------------------- Today tab
  function renderToday() {
    const c = counts();
    const has = S.log.length > 0;
    $('#todayIntro').classList.toggle('hidden', has);
    $('#todayBody').classList.toggle('hidden', !has);
    const last = S.log.length ? new Date(S.log[S.log.length - 1].ts) : new Date();
    const dateStr = isNaN(last) ? '' : last.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#greeting').textContent = 'Lumen Studio' + (dateStr ? ' · ' + dateStr : '');
    const lead = $('#todayLead');
    const sub = $('#todaySub');
    if (!has) {
      lead.textContent = S.demoRunning ? 'Your agents are starting work…' : 'Nothing has happened yet today.';
      sub.textContent = "Run the demo to replay ten real situations from the studio's own files. Chaperone decides each one and shows you the line in the file that decided it.";
    } else if (c.pending > 0) {
      lead.innerHTML = `${esc(plural(c.pending, 'thing needs', 'things need'))} your yes${c.pendingMoney ? ` — <span class="money">${esc(money(c.pendingMoney))}</span> in all` : ''}.`;
      sub.textContent = `Chaperone also stopped ${plural(c.stopped, 'risky action')} before anything left the studio${c.scope ? `, and blocked ${plural(c.scope, 'file read')} an agent did not need` : ''}. ${plural(c.ALLOW, 'routine action')} went ahead without bothering you.`;
    } else {
      lead.textContent = 'Nothing needs you right now.';
      sub.textContent = `Chaperone stopped ${plural(c.stopped, 'risky action')}${c.scope ? ` and ${plural(c.scope, 'unneeded file read')}` : ''}, and let ${plural(c.ALLOW, 'routine action')} through.${S.demoRunning ? ' Your agents are still working.' : ''}`;
    }
    if (!has) return;

    // stat cards — waiting first: it is the only one that needs her
    const stats = [
      ['waiting', 'i-wait', c.pending, c.pending ? `waiting for your yes · <span class="money">${esc(money(c.pendingMoney))}</span>` : 'waiting for your yes'],
      ['blocked', 'i-stop', c.stopped, 'stopped before anything went out'],
      ['held', 'i-eye', c.scope, 'file reads stopped, not needed for the task'],
      ['done', 'i-done', c.ALLOW, 'done without asking'],
    ];
    $('#statrow').innerHTML = stats.map(([k, ic, n, l]) => `<div class="stat stat-${k}"><span class="stat-ic" aria-hidden="true">${icon(ic)}</span><span class="stat-n">${n}</span><span class="stat-l">${l}</span></div>`).join('');

    // pending cards (compact)
    const pend = pendingQueue();
    const tq = $('#todayQueue');
    withFocus(tq, () => { tq.innerHTML = pend.map((q) => cardHtml(q, 'today')).join(''); });
    $('#todayQueueEmpty').classList.toggle('hidden', pend.length > 0);

    // stopped rows (scope reads go under "You should know")
    const stopped = S.log.filter((e) => e.decision === 'BLOCK' && !(e.scope_creep && e.scope_creep.length)).reverse();
    const ts = $('#todayStopped');
    const have = new Set($$('details.row', ts).map((r) => r.dataset.lid));
    const want = stopped.map((e) => String(e.id));
    if (want.join() !== [...have].join()) {
      ts.textContent = '';
      for (const e of stopped) ts.appendChild(buildRow(e, 'today-log-'));
    }
    $('#todayStoppedEmpty').classList.toggle('hidden', stopped.length > 0);

    // You should know: unneeded reads + inbound instructions
    const secs = [];
    const scope = S.log.filter((e) => (e.scope_creep || []).length);
    if (scope.length) {
      const groups = new Map();
      for (const e of scope) {
        const k = e.agent + '|' + e.task;
        if (!groups.has(k)) groups.set(k, { agent: e.agent, task: e.task, files: [] });
        for (const s of e.scope_creep) groups.get(k).files.push(s);
      }
      secs.push(`<section class="briefsec" aria-labelledby="h-know"><h2 id="h-know">${icon('i-know')}You should know</h2>${[...groups.values()].map((g) => `<div class="briefitem"><p class="text">${esc(g.agent)} opened ${esc(plural(g.files.length, 'file'))} it did not need while asked to ${esc(g.task)}. Chaperone stopped each read.</p><ul class="files">${g.files.map((f) => `<li>${icon('i-lock')}<code>${esc(f.file)}</code>${levelPill(f.level)}</li>`).join('')}</ul></div>`).join('')}</section>`);
    }
    const inj = S.log.filter((e) => e.injection && e.injection.flagged);
    if (inj.length) {
      secs.push(`<section class="briefsec inj" aria-labelledby="h-inj"><h2 id="h-inj">${icon('i-mail')}An inbound message tried to give instructions</h2>${inj.map((e) => `<div class="briefitem"><p class="text">${esc(stripPrefix(e.owner_line))}</p>${quoteFig({ file: e.injection.file, line: e.injection.line, quote: e.injection.quote, whys: [] }, 'as-data')}<p class="data-note">${icon('i-done')}<span>Treated as information, not as an instruction. Nothing in that message was followed.</span></p></div>`).join('')}</section>`);
    }
    const bs = $('#briefSections');
    const html = secs.join('');
    if (bs.dataset.sig !== html) { bs.innerHTML = html; bs.dataset.sig = html; }

    const done = S.log.filter((e) => e.decision === 'ALLOW');
    $('#doneSummary').textContent = `Done without asking (${done.length})`;
    $('#doneList').innerHTML = done.map((e) => `<li>${esc(stripPrefix(e.owner_line))}</li>`).join('');
    $('#doneMore').classList.toggle('hidden', done.length === 0);

    const bt = S.briefing && S.briefing.text;
    $('#rawBrief').classList.toggle('hidden', !bt);
    if (bt) $('#briefText').textContent = bt;
    $('#videoWrap').classList.toggle('hidden', !S.videoOk);

    renderLanes();
  }
  function renderLanes() {
    const lanes = $('#lanes');
    const html = AGENTS.map((a) => {
      const es = S.log.filter((e) => e.agent === a);
      const n = { ALLOW: 0, HOLD_FOR_APPROVAL: 0, BLOCK: 0 };
      for (const e of es) n[e.decision]++;
      const sr = es.length ? `${plural(es.length, 'action')}: ${n.ALLOW} done, ${n.HOLD_FOR_APPROVAL} waiting, ${n.BLOCK} stopped` : 'no actions yet';
      return `<li class="lane" data-agent="${esc(a)}"><div class="lane-head"><span class="lane-name">${esc(a)}</span><span class="lane-n" aria-hidden="true">${es.length}</span></div><span class="sr-only">${esc(sr)}</span><span class="lane-pips" aria-hidden="true">${es.length ? es.map((e) => `<svg class="ic d-${e.decision}" data-lid="${e.id}" focusable="false"><title>${esc(DEC[e.decision].label)}</title><use href="#${DEC[e.decision].icon}"/></svg>`).join('') : '<span class="lane-none">Nothing yet</span>'}</span></li>`;
    }).join('');
    if (lanes.dataset.sig === html) return;
    const before = new Set($$('[data-lid]', lanes).map((x) => x.dataset.lid));
    lanes.innerHTML = html;
    lanes.dataset.sig = html;
    if (before.size) for (const p of $$('[data-lid]', lanes)) if (!before.has(p.dataset.lid)) p.classList.add('new');
  }

  // --------------------------------------------------------------- Facts tab
  function markBody(body, checks) {
    let out = '';
    let rest = String(body || '');
    for (const f of checks) {
      const i = rest.indexOf(f.claimed);
      if (i < 0) continue;
      out += esc(rest.slice(0, i)) + `<mark class="${f.status === 'ok' ? 'ok' : 'bad'}">${esc(f.claimed)}</mark>`;
      rest = rest.slice(i + f.claimed.length);
    }
    return out + esc(rest);
  }
  function renderFacts() {
    const items = S.log.filter((e) => (e.fact_check || []).length);
    const fl = $('#factList');
    $('#factEmpty').classList.toggle('hidden', items.length > 0);
    $('#factEmptyRun').classList.toggle('hidden', S.log.length > 0);
    $('#factEmptyBack').classList.toggle('hidden', S.log.length === 0);
    const html = items.map((e) => {
      const fc = e.fact_check;
      const bad = fc.filter((f) => f.status !== 'ok').length;
      const to = e.params && e.params.to;
      const body = e.params && e.params.body;
      const rows = fc.map((f) => {
        const ok = f.status === 'ok';
        const real = formatReal(f.claimed, f.real);
        const state = ok ? `${icon('i-done')}Matches your file` : f.status === 'fabricated' ? `${icon('i-cross-circle')}Not on file` : `${icon('i-cross-circle')}Wrong`;
        const realCell = real != null
          ? `<span class="val">${esc(real)}</span>${f.source_quote ? quoteFig({ file: f.source_file, line: f.source_line, quote: f.source_quote, whys: [] }) : ''}`
          : `<span class="none">${icon('i-know')}No file backs this figure up.</span>`;
        return `<div class="fact-row ${ok ? 'ok' : 'bad'}"><div class="claimed"><span class="sr-only">The agent wrote</span><span class="val">${esc(f.claimed)}</span><span class="state">${state}</span></div><div class="vs" aria-hidden="true">${icon('i-arrow')}</div><div class="real"><span class="sr-only">Your file says</span>${realCell}</div></div>`;
      }).join('');
      return `<article class="fact" id="fact-${e.id}">
        <div class="fact-head"><div><div class="card-who">${agentPill(e.agent)}${decPill(e.decision, e.decision === 'BLOCK' ? 'Stopped, not sent' : null)}<span class="pill pill-scenario">${esc(e.scenario)}</span></div><h3 class="fact-title">${esc(cap(e.task))}</h3></div>${bad ? `<span class="pill pill-status-fabricated">${esc(plural(bad, 'figure'))} wrong</span>` : `<span class="pill pill-status-done">${icon('i-done')}All figures match</span>`}</div>
        ${body ? `<figure class="draft"><figcaption>The draft the agent wrote</figcaption>${to ? `<p class="to">To <code>${esc(to)}</code></p>` : ''}<blockquote><p>${markBody(body, fc)}</p></blockquote></figure>` : ''}
        <div class="fact-table"><div class="fact-hdr" aria-hidden="true"><span>The agent wrote</span><span></span><span>Your file says</span></div>${rows}</div>
        ${bad ? `<p class="fact-verdict">${icon('i-stop')}<span>${esc(stripPrefix(e.owner_line))}</span></p>` : ''}
        ${techDetails(e)}
      </article>`;
    }).join('');
    if (fl.dataset.sig !== html) { fl.innerHTML = html; fl.dataset.sig = html; }
  }

  // ------------------------------------------------------------- Lineage tab
  function renderLineage() {
    const outputs = new Map(); // output id -> {chain, write, acts[]}
    for (const e of S.log) {
      const ch = e.lineage_chain || [];
      if (ch.length < 2) continue;
      const out = ch[ch.length - 1];
      if (!outputs.has(out.id)) outputs.set(out.id, { out, sources: ch.slice(0, -1), write: null, acts: [] });
      const g = outputs.get(out.id);
      if (e.action === 'write_file' && !g.write) g.write = e;
      else if (!(e.action === 'write_file')) g.acts.push(e);
    }
    const lv = (l) => `lv-${esc(l)}`;
    const html = [...outputs.values()].map((g) => {
      const who = (g.write || g.acts[0] || {}).agent || '';
      const task = (g.write || g.acts[0] || {}).task || '';
      const srcNodes = g.sources.map((n) => `<li class="node ${lv(n.level)}"><div class="node-head"><span class="node-k">Your file</span>${meter()}</div><code class="node-id">${esc(n.id)}</code><div class="node-lv">${levelPill(n.level)}</div>${n.unannounced ? `<span class="flag">${icon('i-lock')}Holds unannounced news</span>` : ''}</li>`).join('');
      const outL = levelOf(g.out.level).label;
      const srcL = g.sources.map((n) => levelOf(n.level).label);
      const outNode = `<li class="node ${lv(g.out.level)}"><div class="node-head"><span class="node-k">New file ${esc(who)} wrote</span>${meter()}</div><code class="node-id">${esc(g.out.id)}</code><div class="node-lv">${levelPill(g.out.level)}</div><p class="inherit">Inherits ${esc(outL)} from ${g.sources.length === 1 ? 'the file it was made from' : 'the most private file it was made from'}${srcL.length ? '' : ''}.</p>${g.out.unannounced ? `<span class="flag">${icon('i-lock')}Still holds the unannounced news</span>` : ''}</li>`;
      const acts = g.acts.map((a) => {
        const target = a.params && (a.params.target || a.params.to);
        const D = DEC[a.decision];
        return `<li class="link-step" aria-hidden="true">${icon('i-arrow', 'h')}${icon('i-down', 'v')}<span class="link-lbl">then tried to</span></li><li class="node act d-${a.decision}"><span class="node-k">${esc(ACTION_WORDS[a.action] || a.action)}</span><p class="node-text">${target ? `Send it to <strong>${esc(target)}</strong>` : esc(stripPrefix(a.owner_line))}</p><div class="node-lv">${decPill(a.decision, a.decision === 'BLOCK' ? 'Stopped' : D && D.label)}</div><p class="inherit">${esc(stripPrefix(a.owner_line))}</p></li>`;
      }).join('');
      const srcBlock = g.sources.length === 1 ? srcNodes : `<li class="node-group"><ol class="chain-steps">${srcNodes}</ol></li>`;
      return `<article class="chain"><h3 class="chain-title">${esc(cap(task || 'A new file'))}</h3><p class="chain-sub">${esc(who)} made <code>${esc(g.out.id)}</code> from ${esc(plural(g.sources.length, 'of your files', 'of your files'))}. It stays as private as its source.</p><ol class="chain-steps">${srcBlock}<li class="link-step" aria-hidden="true">${icon('i-arrow', 'h')}${icon('i-down', 'v')}<span class="link-lbl">summarised into</span></li>${outNode}${acts}</ol></article>`;
    }).join('');
    const ll = $('#lineageList');
    if (ll.dataset.sig !== html) { ll.innerHTML = html; ll.dataset.sig = html; }
    $('#lineageEmpty').classList.toggle('hidden', outputs.size > 0);
    $('#lineageEmptyRun').classList.toggle('hidden', S.log.length > 0);
    $('#lineageEmptyBack').classList.toggle('hidden', S.log.length === 0);

    // every file opened, by level
    const lm = levelMap();
    const files = new Set();
    for (const e of S.log) for (const f of e.files_touched || []) files.add(f);
    const by = {};
    for (const f of files) { const l = lm.get(f) || 'internal'; (by[l] = by[l] || []).push(f); }
    $('#filesWrap').classList.toggle('hidden', files.size === 0);
    const fhtml = LEVEL_ORDER.map((l) => {
      const list = (by[l] || []).sort();
      return `<div class="level lv-${l}"><h3><span class="lv-name">${meter()}${esc(levelOf(l).label)}</span><span class="n">${list.length}</span></h3>${list.length ? `<ul>${list.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="quiet small">None today.</p>'}</div>`;
    }).join('');
    const fb = $('#filesByLevel');
    if (fb.dataset.sig !== fhtml) { fb.innerHTML = fhtml; fb.dataset.sig = fhtml; }
  }

  // --------------------------------------------------------------- Score tab
  function renderScore(freshIds) {
    const rs = S.results || [];
    const has = rs.length > 0;
    $('#scoreWrap').classList.toggle('hidden', !has);
    $('#scoreEmpty').classList.toggle('hidden', has);
    if (!has) return;
    const pts = rs.reduce((a, r) => a + (r.points || 0), 0);
    const max = rs.reduce((a, r) => a + (r.max || 0), 0);
    const cl = S.classifier;
    const stats = [`<div class="stat stat-done"><span class="stat-ic" aria-hidden="true">${icon('i-done')}</span><span class="stat-n">${pts}<span class="of"> / ${max}</span></span><span class="stat-l">checks passed across ${plural(rs.length, 'scenario')}${S.demoRunning ? ' so far' : ''}</span></div>`];
    if (cl && cl.total) stats.push(`<div class="stat stat-held"><span class="stat-ic" aria-hidden="true">${icon('i-file')}</span><span class="stat-n">${cl.correct}<span class="of"> / ${cl.total}</span></span><span class="stat-l">studio files given the right privacy level by the classifier</span></div>`);
    $('#scoreStats').innerHTML = stats.join('');
    const chk = (ok, lbl, miss) => `<td class="chk ${ok ? 'pass' : 'fail'}" data-lbl="${lbl}"><span class="chk-v">${icon(ok ? 'i-done' : 'i-cross-circle')}${ok ? 'Yes' : 'No'}${!ok && miss ? `<span class="miss">${esc(miss)}</span>` : ''}</span></td>`;
    const rows = rs.map((r) => {
      const c = r.checks || {};
      const decMiss = `Expected ${r.expected_decision}, got ${r.got_decision}`;
      const ruleMiss = `Expected ${(r.expected_rules || []).join(', ')}`;
      const evMiss = (r.failed_evidence || []).length ? `Missing: ${(r.failed_evidence || []).map((x) => x.file || x).join(', ')}` : '';
      return `<tr${freshIds && freshIds.has(r.id) ? ' class="fresh"' : ''}><th class="sit" scope="row"><strong>${esc(r.name)}</strong><span class="sid">${esc(r.id)}</span></th>${chk(c.decision, 'Right decision', decMiss)}${chk(c.rules, 'Right rule', ruleMiss)}${chk(c.evidence, 'Evidence cited', evMiss)}<td class="num" data-lbl="Score">${r.points}/${r.max}</td></tr>`;
    }).join('');
    $('#scoreGrid').innerHTML = `<table class="score"><caption>Each scenario replays one real kind of mistake. A check passes only if Chaperone's live answer matches the expected one.</caption><thead><tr><th scope="col">Situation</th><th scope="col">Right decision</th><th scope="col">Right rule</th><th scope="col">Evidence cited</th><th scope="col" class="num">Score</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ---------------------------------------------------------------- progress
  const prog = { hideTimer: null };
  function renderProgress() {
    const el = $('#progress');
    const segs = $('#progressSegs');
    const ids = S.scenarioIds;
    if (!S.demoRunning && !ids.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.dataset.live = S.demoRunning ? 'true' : 'false';
    segs.innerHTML = ids.map((id) => {
      const s = S.scen.get(id) || {};
      const cls = s.status === 'running' ? 'run' : s.status === 'done' ? (s.points != null && s.max != null && s.points < s.max ? 'part' : 'ok') : '';
      return `<li class="${cls}" title="${esc(id)}"></li>`;
    }).join('');
    const running = ids.find((id) => (S.scen.get(id) || {}).status === 'running');
    const doneN = ids.filter((id) => (S.scen.get(id) || {}).status === 'done').length;
    const txt = $('#progressText');
    if (S.demoRunning) {
      if (running) {
        const i = ids.indexOf(running) + 1;
        txt.textContent = `Replaying situation ${i} of ${ids.length}: ${S.scen.get(running).name || running}`;
      } else txt.textContent = doneN ? `Finishing up: ${doneN} of ${ids.length} situations replayed` : 'Your agents are starting work…';
    }
  }
  function finishProgress(error) {
    const txt = $('#progressText');
    const rs = S.results || [];
    const pts = rs.reduce((a, r) => a + (r.points || 0), 0);
    const max = rs.reduce((a, r) => a + (r.max || 0), 0);
    $('#progress').dataset.live = 'false';
    if (error) {
      txt.textContent = `The demo stopped early: ${error}`;
      announce('The demo stopped early.');
      return;
    }
    txt.textContent = max ? `Demo complete: ${pts} of ${max} checks passed.` : 'Demo complete.';
    const c = counts();
    announce(`Demo complete. ${plural(c.pending, 'item')} waiting for your yes, ${c.stopped} risky actions stopped.${max ? ` ${pts} of ${max} checks passed.` : ''}`);
    clearTimeout(prog.hideTimer);
    prog.hideTimer = setTimeout(() => { if (!S.demoRunning) { S.scenarioIds = []; renderProgress(); } }, 8000);
  }
  function renderRunButton() {
    const b = $('#runDemo');
    const busy = S.demoRunning;
    b.setAttribute('aria-disabled', busy ? 'true' : 'false');
    b.innerHTML = busy
      ? `${icon('i-spin', 'spin')}<span class="run-label">Running…</span>`
      : `${icon('i-play')}<span class="run-label">${S.log.length ? 'Run it again' : 'Run the demo'}</span>`;
    $('#demoStatus').textContent = busy ? 'The demo is running.' : '';
    for (const x of $$('[data-run]')) x.setAttribute('aria-disabled', busy ? 'true' : 'false');
  }

  // ----------------------------------------------------------------- render
  const dirty = new Set();
  let raf = 0;
  function schedule(...parts) {
    for (const p of parts) dirty.add(p);
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const d = new Set(dirty); dirty.clear();
      if (d.has('filters')) { renderFilters(); applyFilters(); }
      if (d.has('queue')) renderQueue();
      if (d.has('today')) renderToday();
      if (d.has('facts')) renderFacts();
      if (d.has('lineage')) renderLineage();
      if (d.has('score')) renderScore();
      if (d.has('progress')) renderProgress();
      if (d.has('run')) renderRunButton();
    });
  }
  function renderQueueAndToday() { renderQueue(); renderToday(); }
  function renderAll() {
    rebuildLog(); renderQueue(); renderToday(); renderFacts(); renderLineage(); renderScore(); renderProgress(); renderRunButton();
  }

  // --------------------------------------------------------------- data in
  function loadState(st) {
    S.log = Array.isArray(st.log) ? st.log.slice() : [];
    S.byId = new Map(S.log.map((e) => [e.id, e]));
    const keep = new Map(S.pending);
    S.queue = new Map((st.queue || []).map((q) => [q.queue_id, q]));
    for (const [qid, p] of keep) { const q = S.queue.get(qid); if (!q || q.status !== 'pending') clearPending(qid); }
    S.results = st.scenarioResults || [];
    S.classifier = st.classifierReport || null;
    S.briefing = st.briefing || null;
    S.lineage = st.lineage || [];
    S.demoRunning = !!st.demoRunning;
    if (!S.demoRunning && !S.scenarioIds.length) S.scen.clear();
    renderAll();
  }
  async function fetchState() {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      loadState(await r.json());
    } catch (_) {
      toast('Could not load the latest state.', 'info', 'Chaperone will try again when the connection comes back.');
    }
  }
  function addEntry(e) {
    if (!e || e.id == null || S.byId.has(e.id)) return;
    S.log.push(e);
    S.byId.set(e.id, e);
    prependRow(e);
    countForAnnounce(e.decision);
    schedule('filters', 'today', 'facts', 'lineage', 'queue');
  }
  function resetAll() {
    for (const qid of [...S.pending.keys()]) clearPending(qid);
    S.log = []; S.byId = new Map(); S.queue = new Map(); S.results = []; S.briefing = null; S.lineage = [];
    S.errors.clear(); S.open.clear();
    for (const sel of ['#briefSections', '#factList', '#lineageList', '#filesByLevel', '#lanes']) { const el = $(sel); if (el) delete el.dataset.sig; }
    renderAll();
  }

  function setConn(state) {
    const c = $('#conn');
    c.dataset.state = state;
    $('#connLbl').textContent = state === 'live' ? 'Live' : state === 'lost' ? 'Reconnecting' : 'Connecting';
  }
  function connect() {
    if (!('EventSource' in window)) { setConn('lost'); return; }
    const es = new EventSource('/api/events');
    const on = (ev, fn) => es.addEventListener(ev, (m) => { let d = {}; try { d = JSON.parse(m.data || '{}'); } catch (_) { return; } fn(d); });
    es.onopen = () => setConn('live');
    es.onerror = () => setConn(es.readyState === EventSource.CLOSED ? 'lost' : 'lost');
    on('hello', () => { setConn('live'); fetchState(); });
    on('action', addEntry);
    on('queue', (q) => {
      const isNew = !S.queue.has(q.queue_id);
      upsertQueue(q);
      if (isNew && q.status === 'pending') countForAnnounce(null);
      schedule('queue', 'today', 'filters');
    });
    on('scorecard', (r) => {
      const prev = new Set((S.results || []).map((x) => x.id));
      S.results = Array.isArray(r) ? r : (r && r.results) || [];
      for (const x of S.results) { const s = S.scen.get(x.id); if (s) s.max = x.max; }
      renderScore(new Set(S.results.map((x) => x.id).filter((id) => !prev.has(id))));
      schedule('progress');
    });
    on('briefing', (b) => { S.briefing = b; schedule('today'); });
    on('reset', () => resetAll());
    on('demo', (d) => {
      S.demoRunning = !!d.running;
      if (d.running) { clearTimeout(prog.hideTimer); announce('The demo has started.'); }
      schedule('run', 'progress', 'today', 'score');
      if (!d.running) requestAnimationFrame(() => finishProgress(d.error));
    });
    on('scenario', (s) => {
      if (!S.scenarioIds.includes(s.id)) S.scenarioIds.push(s.id);
      const prev = S.scen.get(s.id) || {};
      S.scen.set(s.id, Object.assign(prev, { name: s.name, status: s.status, points: s.points != null ? s.points : prev.points }));
      schedule('progress');
    });
  }

  // ----------------------------------------------------------------- actions
  async function runDemo() {
    if (S.demoRunning) return;
    S.demoRunning = true;
    renderRunButton();
    try {
      const r = await fetch('/api/demo/run', { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (r.status === 409) { toast('The demo is already running.', 'info'); return; }
      if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
      clearTimeout(prog.hideTimer);
      S.scenarioIds = Array.isArray(body.scenarios) ? body.scenarios.slice() : [];
      S.scen = new Map(S.scenarioIds.map((id) => [id, { status: 'queued' }]));
      renderProgress();
    } catch (_) {
      S.demoRunning = false;
      renderRunButton();
      toast('Could not start the demo.', '', 'Check that the Chaperone server is running, then try again.');
    }
  }

  // -------------------------------------------------------------------- tabs
  function selectTab(name, opts) {
    if (!TABS.includes(name)) name = 'today';
    S.tab = name;
    for (const t of TABS) {
      const b = $('#tabbtn-' + t);
      const on = t === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('active', on);
      $('#tab-' + t).classList.toggle('active', on);
    }
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (opts && opts.focusTab) $('#tabbtn-' + name).focus();
    if (opts && opts.focusPanel) { $('#tab-' + name).focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
  }
  function wire() {
    const tl = $('#tabs');
    tl.addEventListener('click', (ev) => { const b = ev.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); });
    tl.addEventListener('keydown', (ev) => {
      const i = TABS.indexOf(S.tab);
      let n = null;
      if (ev.key === 'ArrowRight') n = TABS[(i + 1) % TABS.length];
      else if (ev.key === 'ArrowLeft') n = TABS[(i - 1 + TABS.length) % TABS.length];
      else if (ev.key === 'Home') n = TABS[0];
      else if (ev.key === 'End') n = TABS[TABS.length - 1];
      if (n) { ev.preventDefault(); selectTab(n, { focusTab: true }); }
    });
    window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
    $('#runDemo').addEventListener('click', runDemo);

    document.addEventListener('click', (ev) => {
      const run = ev.target.closest('[data-run]');
      if (run) { ev.preventDefault(); runDemo(); return; }
      const go = ev.target.closest('[data-goto]');
      if (go) { ev.preventDefault(); selectTab(go.dataset.goto, { focusPanel: true }); return; }
      const act = ev.target.closest('button[data-act]');
      if (act) {
        const qid = act.dataset.q;
        if (act.dataset.act === 'undo') undoDecision(qid);
        else startDecision(qid, act.dataset.act);
        return;
      }
      const dec = ev.target.closest('#decFilter button[data-dec]');
      if (dec) { S.filters.dec = dec.dataset.dec; renderFilters(); applyFilters(); $(`#decFilter [data-dec="${CSS.escape(S.filters.dec)}"]`).focus(); return; }
      const ag = ev.target.closest('#agentFilter button[data-agent]');
      if (ag) { S.filters.agent = ag.dataset.agent; renderFilters(); applyFilters(); $(`#agentFilter [data-agent="${CSS.escape(S.filters.agent)}"]`).focus(); return; }
    });
    $('#clearFilters').addEventListener('click', () => { S.filters = { dec: 'all', agent: 'all' }; renderFilters(); applyFilters(); $('#decFilter button').focus(); });
    // remember which disclosures are open so live re-renders never collapse them
    document.addEventListener('toggle', (ev) => {
      const d = ev.target;
      if (!(d instanceof HTMLDetailsElement) || !d.id) return;
      if (d.open) S.open.add(d.id); else S.open.delete(d.id);
    }, true);
    const v = $('#briefVideo');
    if (v) v.addEventListener('error', () => { S.videoOk = false; $('#videoWrap').classList.add('hidden'); });
  }
  async function probeVideo() {
    try {
      const r = await fetch('/assets/briefing-60s.mp4', { method: 'HEAD' });
      S.videoOk = r.ok;
    } catch (_) { S.videoOk = false; }
    $('#videoWrap').classList.toggle('hidden', !S.videoOk || !S.log.length);
  }

  // -------------------------------------------------------------------- boot
  wire();
  selectTab((location.hash || '#today').slice(1));
  renderAll();
  probeVideo();
  connect();
})();

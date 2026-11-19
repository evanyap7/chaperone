// Chaperone UI — plain words for Mei. Rule IDs live only in the details lines.
const $ = (s) => document.querySelector(s);
const state = { log: [], queue: [], results: [], classifier: null, briefing: null, lineage: [] };

const ACTION_WORDS = {
  read_file: 'Read a file', list_dir: 'Listed a folder', write_file: 'Wrote a new file',
  send_email: 'Drafted an email', upload_to_external_tool: 'Tried to upload to an external tool',
  quote_price: 'Quoted a price', accept_terms: 'Tried to accept changed terms',
  pay_supplier: 'Tried to pay a supplier', order_from_supplier: 'Tried to place an order',
  delete_file: 'Tried to delete a file', state_fact: 'Stated a fact',
};
const DECISION_WORDS = { BLOCK: 'Stopped', HOLD_FOR_APPROVAL: 'Waiting for you', ALLOW: 'Done' };
const LEVEL_WORDS = { public: 'public', internal: 'internal', 'client-confidential': 'client-confidential', regulated: 'regulated' };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function chip(cls, text) { return `<span class="chip ${esc(cls)}">${esc(text)}</span>`; }
function money(n) { return n == null ? '' : `SGD ${Number(n).toLocaleString()}`; }
function timeOf(ts) { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } }

function evidenceHtml(evidence) {
  if (!evidence?.length) return '';
  return `<ul class="evidence">${evidence.map((e) => `<li><span class="q">“${esc(e.quote)}”</span><span class="src">${esc(e.file)}${e.line ? `:${e.line}` : ''} — ${esc(e.why || '')}</span></li>`).join('')}</ul>`;
}

// ---- tabs -----------------------------------------------------------------
$('#tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-tab]');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${b.dataset.tab}`));
});

// ---- log ------------------------------------------------------------------
function logItemHtml(e) {
  const files = e.files_touched?.length ? e.files_touched.join(', ') : (e.params?.to ? `to ${e.params.to}` : '');
  const details = [];
  if (e.rules?.length) details.push(`Rules: ${e.rules.join(', ')}${e.never ? ' (NEVER — cannot be approved by anyone)' : ''}`);
  if (e.scope_creep?.length) details.push(`Outside the task scope: ${e.scope_creep.map((s) => `${s.file} (${s.level})`).join(', ')}`);
  if (e.injection?.flagged) details.push(`Prompt injection flagged in ${e.injection.file}: “${e.injection.quote}” — treated as data, not followed.`);
  return `<div class="item" id="log-${e.id}">
    <div class="loghead">
      <span class="time">${timeOf(e.ts)}</span>
      ${chip('agent', e.agent)}
      <span class="act">${esc(ACTION_WORDS[e.action] || e.action)}</span>
      ${chip(e.data_level, LEVEL_WORDS[e.data_level] || e.data_level)}
      ${chip(e.decision, DECISION_WORDS[e.decision] || e.decision)}
      ${e.scenario ? `<span class="time">${esc(e.scenario)}</span>` : ''}
    </div>
    <div class="logbody">${esc(e.owner_line || '')}</div>
    ${files ? `<div class="filelist">${esc(files)}</div>` : ''}
    <details><summary>Details &amp; evidence</summary>
      ${details.map((d) => `<div class="meta">${esc(d)}</div>`).join('')}
      ${evidenceHtml(e.evidence)}
    </details>
  </div>`;
}
function renderLog() {
  $('#logEmpty').classList.toggle('hidden', state.log.length > 0);
  $('#logList').innerHTML = state.log.map(logItemHtml).join('');
}
function appendLog(e) {
  state.log.push(e);
  $('#logEmpty').classList.add('hidden');
  $('#logList').insertAdjacentHTML('beforeend', logItemHtml(e));
  if (e.fact_check?.length) renderFacts();
  if (e.action === 'write_file' || e.lineage_chain?.length) {
    fetch('/api/lineage').then((r) => r.json()).then((l) => { state.lineage = l; renderLineage(); }).catch(() => {});
  }
}

// ---- queue ----------------------------------------------------------------
function queueHtml(q) {
  const decided = q.status !== 'pending';
  return `<div class="qitem" id="q-${esc(q.queue_id)}">
    <div class="sum">${esc(q.summary)}</div>
    <div class="meta">${chip('agent', q.agent)} ${q.money_at_stake ? `<span class="money">${money(q.money_at_stake)}</span>` : ''}</div>
    ${q.recommendation === 'deny' ? '<div class="rec deny">Chaperone recommends: no.</div>' : '<div class="rec review">Chaperone recommends: look closely.</div>'}
    ${decided
      ? `<div class="qstatus ${q.status}">${q.status === 'approved' ? 'You approved this' : 'You said no'} · ${timeOf(q.decided_at)}</div>`
      : `<div class="qactions"><button class="btn-approve" data-q="${esc(q.queue_id)}" data-d="approve">Approve</button><button class="btn-deny" data-q="${esc(q.queue_id)}" data-d="deny">Say no</button></div>`}
  </div>`;
}
function renderQueue() {
  const pending = state.queue.filter((q) => q.status === 'pending').length;
  $('#queueBadge').textContent = pending;
  $('#queueBadge').classList.toggle('hidden', pending === 0);
  $('#queueEmpty').classList.toggle('hidden', state.queue.length > 0);
  $('#queueList').innerHTML = state.queue.map(queueHtml).join('');
}
$('#queueList').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-q]');
  if (!b) return;
  b.disabled = true;
  const res = await fetch('/api/queue/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queue_id: b.dataset.q, decision: b.dataset.d }) });
  const out = await res.json();
  if (!out.ok) { alert(out.error || 'Could not record that.'); b.disabled = false; }
});
function upsertQueue(q) {
  const i = state.queue.findIndex((x) => x.queue_id === q.queue_id);
  if (i >= 0) state.queue[i] = q; else state.queue.push(q);
  renderQueue();
}

// ---- fact check -----------------------------------------------------------
function renderFacts() {
  const withFacts = state.log.filter((e) => e.fact_check?.length);
  $('#factEmpty').classList.toggle('hidden', withFacts.length > 0);
  $('#factList').innerHTML = withFacts.map((e) => `<div class="factcard">
    <h3>${chip('agent', e.agent)} ${esc(e.owner_line || 'Figures checked')}</h3>
    ${e.fact_check.map((f) => `<div class="factrow">
      <div class="factcell ${f.status === 'ok' ? 'ok' : 'claimed'}"><span class="lbl">Agent claimed</span><span class="val">${esc(f.claimed)}</span></div>
      <div class="factcell real"><span class="lbl">${f.status === 'ok' ? 'Matches the file' : 'Actually on file'}</span><span class="val">${f.real == null ? 'no source found' : esc(typeof f.real === 'number' ? f.real.toLocaleString() : f.real)}</span>
        ${f.source_file ? `<span class="src">“${esc(f.source_quote)}” — ${esc(f.source_file)}${f.source_line ? `:${f.source_line}` : ''}</span>` : '<span class="src">No file supports this figure.</span>'}</div>
    </div>`).join('')}
  </div>`).join('');
}

// ---- lineage --------------------------------------------------------------
function renderLineage() {
  const outputs = state.lineage.filter((n) => n.kind === 'output');
  $('#lineageEmpty').classList.toggle('hidden', outputs.length > 0);
  const byId = Object.fromEntries(state.lineage.map((n) => [n.id, n]));
  const chainOf = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const n = byId[id];
    if (!n) return [{ id, level: null }];
    const out = [];
    for (const d of n.derived_from) out.push(...chainOf(d, seen));
    out.push(n);
    return out;
  };
  $('#lineageList').innerHTML = outputs.map((o) => {
    const chain = chainOf(o.id);
    return `<div class="chain">${chain.map((n, i) => `${i ? '<span class="arrow">→</span>' : ''}<div class="node ${esc(n.level || '')}"><span class="nl">${esc(n.level || 'unknown')}${n.kind === 'output' ? ' · derived' : ' · source'}</span>${esc(n.id)}${n.unannounced ? '<span class="unannounced">carries unannounced client news</span>' : ''}</div>`).join('')}</div>`;
  }).join('');
}

// ---- briefing -------------------------------------------------------------
function renderBriefing() {
  const b = state.briefing;
  $('#briefEmpty').classList.toggle('hidden', !!b);
  $('#briefWrap').classList.toggle('hidden', !b);
  if (!b) return;
  const s = b.stats;
  $('#statrow').innerHTML = `
    <div class="stat stopped"><div class="n">${s.blocked}</div><div class="l">risky actions stopped</div></div>
    <div class="stat waiting"><div class="n">${s.held}</div><div class="l">waiting for your yes${s.held_money ? ` · ${money(s.held_money)}` : ''}</div></div>
    <div class="stat done"><div class="n">${s.allowed}</div><div class="l">routine actions done</div></div>
    <div class="stat fyi"><div class="n">${s.scope_reads + s.injections}</div><div class="l">things you should know</div></div>`;
  $('#briefSections').innerHTML = b.sections.filter((sec) => sec.items.length).map((sec) => `<div class="briefsec">
    <h2><span class="dot ${sec.tone}"></span>${esc(sec.title)}</h2>
    ${sec.items.map((it) => `<div class="item">
      <div class="text">${esc(it.text)} ${it.money ? `<span class="money">${money(it.money)}</span>` : ''}</div>
      <div class="meta">${it.agent ? chip('agent', it.agent) : ''} ${it.rules?.length ? `rules ${it.rules.join(', ')}` : ''}</div>
      ${it.evidence?.length || it.fact_check?.length ? `<details><summary>Details &amp; evidence</summary>${evidenceHtml(it.evidence)}${it.fact_check?.length ? `<div class="meta">Claimed vs real: ${it.fact_check.map((f) => `${f.claimed} → ${f.real ?? 'no source'} (${f.source_file || 'no file'})`).join('; ')}</div>` : ''}</details>` : ''}
      ${it.quote ? `<div class="meta">Quoted: “${esc(it.quote)}”</div>` : ''}
    </div>`).join('')}
  </div>`).join('');
  $('#briefText').textContent = b.text;
}

// ---- scorecard ------------------------------------------------------------
function renderScore() {
  const has = state.results.length > 0 || state.classifier;
  $('#scoreEmpty').classList.toggle('hidden', has);
  $('#scoreWrap').classList.toggle('hidden', !has);
  if (!has) return;
  const total = state.results.reduce((a, r) => a + r.points, 0);
  const max = state.results.length * 3;
  const c = state.classifier;
  $('#scoreStats').innerHTML = `
    ${c ? `<div class="stat done"><div class="n">${c.correct}/${c.total}</div><div class="l">files classified correctly (${(c.accuracy * 100).toFixed(0)}%)</div></div>` : ''}
    ${state.results.length ? `<div class="stat ${total === max ? 'done' : 'waiting'}"><div class="n">${total}/${max}</div><div class="l">scenario checks passed</div></div>` : ''}`;
  $('#scoreGrid').innerHTML = state.results.map((r) => `<div class="scorecard">
    <span class="pts">${r.points}/3</span>
    <h3>${esc(r.id)} · ${esc(r.name)}</h3>
    <div class="checks">
      <span class="check ${r.checks.decision ? 'pass' : 'fail'}">decision ${r.checks.decision ? '✓' : '✗'} ${esc(r.got_decision)}</span>
      <span class="check ${r.checks.rules ? 'pass' : 'fail'}">rules ${r.checks.rules ? '✓' : '✗'}</span>
      <span class="check ${r.checks.evidence ? 'pass' : 'fail'}">evidence ${r.checks.evidence ? '✓' : '✗'}</span>
    </div>
    ${r.failed_evidence?.length ? `<div class="miss">missing: ${esc(r.failed_evidence.join('; '))}</div>` : ''}
  </div>`).join('');
}

// ---- demo + SSE -----------------------------------------------------------
$('#runDemo').addEventListener('click', async () => {
  $('#runDemo').disabled = true;
  const res = await fetch('/api/demo/run', { method: 'POST' });
  if (!res.ok) { $('#runDemo').disabled = false; alert('Demo is already running.'); }
});

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('action', (ev) => appendLog(JSON.parse(ev.data)));
  es.addEventListener('queue', (ev) => upsertQueue(JSON.parse(ev.data)));
  es.addEventListener('scorecard', (ev) => { state.results = JSON.parse(ev.data); renderScore(); });
  es.addEventListener('briefing', (ev) => { state.briefing = JSON.parse(ev.data); renderBriefing(); });
  es.addEventListener('reset', () => {
    state.log = []; state.queue = []; state.results = []; state.briefing = null;
    renderLog(); renderQueue(); renderFacts(); renderBriefing(); renderScore();
  });
  es.addEventListener('demo', (ev) => {
    const d = JSON.parse(ev.data);
    $('#runDemo').disabled = d.running;
    $('#demoStatus').textContent = d.running ? 'Agents working…' : '';
  });
  es.addEventListener('scenario', (ev) => {
    const d = JSON.parse(ev.data);
    $('#demoStatus').textContent = d.status === 'running' ? `Agents working… ${d.id} ${d.name}` : '';
  });
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}

async function init() {
  const res = await fetch('/api/state');
  const s = await res.json();
  state.log = s.log || []; state.queue = s.queue || []; state.results = s.scenarioResults || [];
  state.classifier = s.classifierReport; state.briefing = s.briefing; state.lineage = s.lineage || [];
  renderLog(); renderQueue(); renderFacts(); renderLineage(); renderBriefing(); renderScore();
  $('#runDemo').disabled = !!s.demoRunning;
  // show the video panel only if the file exists
  fetch('/assets/briefing-60s.mp4', { method: 'HEAD' }).then((r) => {
    if (r.ok) $('#videoWrap').classList.remove('hidden');
  }).catch(() => {});
  connect();
}
init();
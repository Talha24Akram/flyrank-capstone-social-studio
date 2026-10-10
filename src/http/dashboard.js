export const dashboardHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Social Studio</title>
<style>
:root{--bg:#0f172a;--card:#1e293b;--fg:#e2e8f0;--mut:#94a3b8;--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444;--q:#64748b}
body{margin:0;font:15px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:20px}
h1{margin:0 0 4px}.sub{color:var(--mut);margin-bottom:16px}
.counts{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.pill{background:var(--card);border-radius:10px;padding:10px 16px;min-width:110px}.pill b{font-size:26px;display:block}
.queued b{color:var(--q)}.publishing b{color:var(--warn)}.published b{color:var(--ok)}.failed b{color:var(--bad)}
.camp{background:var(--card);border-radius:12px;padding:14px;margin-bottom:14px}
.camp h3{margin:0 0 8px}.row{display:flex;gap:12px;align-items:flex-start;border-top:1px solid #334155;padding:10px 0}
.row img{width:96px;height:96px;object-fit:cover;border-radius:8px;background:#0b1222}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#06240f}
.badge.published{background:var(--ok)}.badge.publishing{background:var(--warn)}.badge.queued{background:var(--q);color:#fff}.badge.failed{background:var(--bad);color:#fff}
.cap{white-space:pre-wrap;color:var(--mut);font-size:13px;margin-top:4px}
.meta{color:var(--mut);font-size:12px}
</style></head><body>
<h1>Social Studio</h1><div class="sub" id="sub">loading…</div>
<div class="counts" id="counts"></div><div id="camps"></div>
<script>
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function tick(){
  try{
    const d=await (await fetch('/dashboard.json')).json();
    document.getElementById('sub').textContent='app time '+new Date(d.now).toISOString()+(d.clockOffsetMs?' (clock +'+Math.round(d.clockOffsetMs/1000)+'s)':'')+' · auto-refresh 2s';
    document.getElementById('counts').innerHTML=['queued','publishing','published','failed'].map(k=>'<div class="pill '+k+'"><b>'+(d.counts[k]||0)+'</b>'+k+'</div>').join('');
    document.getElementById('camps').innerHTML=d.campaigns.map(c=>'<div class="camp"><h3>'+esc(c.name)+' <span class="meta">'+esc(c.id)+'</span></h3>'+
      c.entries.map(e=>'<div class="row"><img src="'+e.imageUrl+'" alt="'+e.platform+'"><div><span class="badge '+e.status+'">'+e.status+'</span> <b>'+e.platform+'</b>'+
      ' <span class="meta">attempts '+e.attempts+(e.externalId?' · '+esc(e.externalId):'')+(e.lastError?' · '+esc(e.lastError):'')+'</span><div class="cap">'+esc(e.caption)+'</div></div></div>').join('')+'</div>').join('');
  }catch(e){document.getElementById('sub').textContent='offline: '+e.message}
}
tick();setInterval(tick,2000);
</script></body></html>`;

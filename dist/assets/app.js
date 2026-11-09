'use strict';
const $ = s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const API_BASE = (window.P911_CONFIG?.apiBase || '').replace(/\/$/, '');
let sessionToken='',simulationCsv='';
let csrf='', statusData=null, activePage='overview', reportData=[], currentNumbers=[], currentVariant='4', currentRows=[];
const PERIOD_PAGE_SIZE=60;
let periodsGeneration=0,periodsBusy=false,periodsHasMore=true,periodsKey='',overviewGeneration=0;
const pages={overview:['运行总览','LIVE OVERVIEW','看清每一次变化','两套方案独立运行，开奖后按规则自动切换。'],reports:['每日回测','DAILY REPORTS','用数据还原每一天','五套统计分别展示，连续未中按恰好段长计数。'],numbers:['号码生成','NUMBER GENERATOR','生成一份清楚的号码表','选择方案，复制或下载全部有序三位号码。'],settings:['提醒设置','NOTIFICATIONS','让提醒按你的规则到达','每日飞书报告，实时飞书与Bark连续未中提醒。'],staking:['自动投注','PLAN & EXECUTION','把计划接到真实下单','云端出计划与台账，本机执行器完成登录后的逐号下单。']};
const fmt=n=>n==null?'—':Number(n).toLocaleString('zh-CN');
const rate=n=>n==null?'—':(n*100).toFixed(2)+'%';
const mode=m=>m==='no_double'?'无对子':'有兄弟';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayNow=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
let toastTimer;
function toast(message,error=false){$('#toast').textContent=message;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6500)}
async function request(path,options={}){return fetch(API_BASE+path,{...options,credentials:API_BASE?'omit':'same-origin',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{}),...(sessionToken?{'Authorization':'Bearer '+sessionToken}:{}),...options.headers}})}
async function api(path,options={}){const response=await request(path,options);let data;try{data=await response.json()}catch{throw Error('服务器响应暂不可用')}if(!response.ok){if(response.status===401){$('#app').hidden=true;$('#login').hidden=false}throw Error(typeof data.detail==='string'?data.detail:'输入格式不正确，请检查')}return data}
async function action(button,fn){button.disabled=true;try{await fn()}catch(e){toast(e.message,true)}finally{button.disabled=false}}
function showPage(page){if(!pages[page])page='overview';activePage=page;const [name,kicker,title,desc]=pages[page];$('#page-breadcrumb').textContent=name;$('#page-kicker').textContent=kicker;$('#page-title').textContent=title;$('#page-description').textContent=desc;$$('.page').forEach(x=>x.hidden=x.id!=='page-'+page);$$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));location.hash=page;if(page==='reports')loadReports().catch(e=>toast(e.message,true));if(page==='numbers')loadNumbers(currentVariant).catch(e=>toast(e.message,true));if(page==='settings')loadSettings().catch(e=>toast(e.message,true));if(page==='staking'){loadStake().catch(e=>toast(e.message,true)).then(()=>{renderSwitchRule();renderSwitchLive()});loadAutobet().catch(e=>toast(e.message,true));loadSite()}}
function renderStatus(s){statusData=s;const warn=[];if(s.conflict)warn.push('数据冲突待核对：策略已暂停新数据合并。');if(s.gap)warn.push(`缺少 ${s.gap.missing} 期（${s.gap.before}—${s.gap.after}），等待补采后继续计算。`);if(s.collector_error)warn.push(s.collector_error);if(!s.configured.feishu||!s.configured.bark_devices)warn.push('通知待配置：请在提醒设置中填写飞书与Bark连接。');if(s.time_warning)warn.push('历史源有时间倒序记录；保留来源时间，回测按连续期号执行。');$('#system-banner').hidden=!warn.length;$('#system-banner').textContent=warn.join('　');const good=s.last_sync&&!s.collector_error&&!s.gap&&!s.conflict;$('#aside-health').textContent=good?'采集运行中':'采集待就绪';$('#sync-label').textContent=s.last_sync?'同步 '+s.last_sync.slice(11,19)+' 北京':'尚未完成在线同步';if(s.latest){$('#latest-code').textContent=s.latest.code;$('#latest-issue').textContent='第 '+s.latest.issue+' 期';$('#latest-time').textContent=s.latest.time.replace('T',' ')}$('#daily-clock').textContent=s.settings.daily_enabled?'每日 '+s.settings.daily_time:'日报已暂停';const channels=[['飞书日报',s.configured.feishu?'已配置':'待配置'],['Bark实时提醒',s.configured.bark_devices?s.configured.bark_devices+'台设备':'待配置'],['报警阈值','连续'+s.settings.alarm_threshold+'次未中'],['历史记录',fmt(s.history.records)+'期']];$('#channel-status').innerHTML=channels.map(([a,b])=>`<div class="status-line"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}
function renderCards(report){$('#strategy-cards').innerHTML=['auto4','auto5'].map((id,i)=>{const c=report.cases[id],s=statusData?.states[id]||{},v=i?'5':'4';return `<article class="strategy-card ${i?'five':''}"><div class="card-top"><div class="case-label"><span class="case-number">${v}</span><div><b>自动方案 ${v}</b><small>${i?'516组 · 包含1 / 9':'480组 · 包含0 / 9'}</small></div></div><span class="badge ${s.mode==='no_double'?'warn':''}">下期 · ${mode(s.mode)}</span></div><div class="card-middle"><strong>${rate(c.hit_rate)}</strong><span>所选日命中率</span></div><div class="card-progress"><i style="width:${(c.hit_rate||0)*100}%"></i></div><div class="card-bottom"><div><span>✅ 命中 / ❌ 未中</span><b>${fmt(c.hits)} / ${fmt(c.misses)}</b></div><div><span>当前连续未中</span><b>${s.loss_streak??'—'} <small>次</small></b></div><div><span>当日最长错</span><b>${c.daily_max_loss} <small>次</small></b></div></div></article>`}).join('')}
function drawChart(rows4,rows5){const hours=Array.from({length:24},(_,h)=>h),all=[rows4,rows5];const lines=all.map((rows,index)=>{const pts=[];for(const h of hours){const rs=rows.filter(r=>Number(r.time.slice(11,13))===h);if(rs.length)pts.push([32+h*24,145-100*rs.reduce((a,r)=>a+r.hit,0)/rs.length])}const d=pts.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ');return `<path d="${d}" fill="none" stroke="${index?'#ad8c52':'#457755'}" stroke-width="2.2" ${index?'stroke-dasharray="5 4"':''}/>${pts.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="2.2" fill="${index?'#ad8c52':'#457755'}"/>`).join('')}`}).join('');$('#hourly-chart').innerHTML=`<svg viewBox="0 0 610 177" role="img" aria-label="所选日两套方案每小时命中率"><g stroke="#e8ede2" stroke-dasharray="3 4">${[45,95,145].map(y=>`<line x1="32" y1="${y}" x2="585" y2="${y}"/>`).join('')}</g><text x="0" y="49">100</text><text x="5" y="99">50</text><text x="12" y="149">0</text>${[0,4,8,12,16,20,23].map(h=>`<text x="${25+h*24}" y="171">${String(h).padStart(2,'0')}</text>`).join('')}${lines}</svg>`}
function periodSelection(){return {day:$('#overview-day').value,selected:$('#period-case').value,history:$('#period-scope').value==='history'}}
function periodSelectionKey(){return JSON.stringify(periodSelection())}
function periodRow(r){return `<tr><td>${r.issue}<small>${esc(r.time.replace('T',' '))}</small></td><td><span class="code">${esc(r.code)}</span><span class="mark">${r.hit?'✅':'❌'}</span></td><td><span class="badge ${r.mode==='no_double'?'neutral':''}">${mode(r.mode)}</span></td><td>${r.group_count}</td><td>${r.loss_streak} <small>${r.segment_start?'起于 '+r.segment_start:'本期命中'}</small></td><td>${mode(r.next_mode)}${r.mode!==r.next_mode?' ↗':''}</td></tr>`}
function updatePeriodControls(){
 const n=currentRows.length;
 $('#more-periods').hidden=!periodsHasMore;
 $('#more-periods').disabled=periodsBusy;
 $('#more-periods').textContent=periodsBusy?'正在加载…':`继续加载 ${PERIOD_PAGE_SIZE} 期 ↓`;
 $('#period-count').textContent=n?`已加载 ${fmt(n)} 期 · ${currentRows[0].issue}—${currentRows.at(-1).issue}${periodsHasMore?'':' · 已到最早记录'}`:(periodsBusy?'正在加载开奖记录…':'当前范围暂无记录');
}
function renderPeriods(added=null){
 if(added&&currentRows.length>added.length){$('#period-rows').insertAdjacentHTML('beforeend',added.map(periodRow).join(''))}
 else{$('#period-rows').innerHTML=currentRows.length?currentRows.map(periodRow).join(''):`<tr><td colspan="6" class="empty">${periodsBusy?'正在加载…':'当前范围暂无已处理开奖记录。'}</td></tr>`}
 $('#period-export').href=`/api/export/periods.csv?day=${$('#overview-day').value}&case=${$('#period-case').value}`;
 updatePeriodControls();
}
async function loadPeriods(append=false){
 const selection=periodSelection(),key=JSON.stringify(selection);
 if(append&&(periodsBusy||!periodsHasMore||key!==periodsKey))return;
 const generation=append?periodsGeneration:++periodsGeneration;
 if(!append){periodsKey=key;currentRows=[];periodsHasMore=true;$('#new-periods').hidden=true}
 periodsBusy=true;
 if(!append)renderPeriods();else updatePeriodControls();
 const before=append&&currentRows.length?currentRows.at(-1).issue:null;
 try{
  const rows=await api(`/api/periods?day=${selection.day}&case=${selection.selected}&history=${selection.history}&limit=${PERIOD_PAGE_SIZE}${before?'&before='+before:''}`);
  if(generation!==periodsGeneration||key!==periodSelectionKey())return;
  const seen=new Set(currentRows.map(r=>r.issue));
  const added=rows.filter(r=>(before===null||r.issue<before)&&!seen.has(r.issue)&&seen.add(r.issue));
  currentRows.push(...added);periodsHasMore=rows.length===PERIOD_PAGE_SIZE&&added.length>0;
  if(added.length||!append)renderPeriods(append?added:null);
 }finally{
  if(generation===periodsGeneration){periodsBusy=false;updatePeriodControls()}
 }
}
function indicateNewPeriods(s){
 const selection=periodSelection(),latest=s.latest;
 $('#new-periods').hidden=!(latest&&latest.time.slice(0,10)===selection.day&&latest.issue>(currentRows[0]?.issue||0));
}
async function loadOverview({refreshRows=false}={}){
 const day=$('#overview-day').value,generation=++overviewGeneration;
 const [s,r,a,b]=await Promise.all([api('/api/status'),api('/api/report?day='+day),api('/api/periods?day='+day+'&case=auto4&limit=500'),api('/api/periods?day='+day+'&case=auto5&limit=500')]);
 if(generation!==overviewGeneration||day!==$('#overview-day').value)return;
 renderStatus(s);renderCards(r);drawChart(a,b);
 if(refreshRows||!periodsKey)await loadPeriods();else if(periodsKey===periodSelectionKey())indicateNewPeriods(s);
}
async function loadReports(){const start=$('#report-start').value,end=$('#report-end').value;if(!start||!end)return;reportData=await api(`/api/reports?start=${start}&end=${end}`);renderReports();$('#daily-export').href=`/api/export/daily.csv?start=${start}&end=${end}`;$('#png-export').href='/api/report.png?day='+end}
function renderReports(){const key=$('#report-case').value,stats=reportData.map(r=>r.cases[key]);let hits=0,n=0,max=0;for(const s of stats){hits+=s.hits;n+=s.periods;max=Math.max(max,s.cross_max_loss)}const totals=[['实际期数',fmt(n)],['✅ 命中 / ❌ 未中',fmt(hits)+' / '+fmt(n-hits)],['所选范围命中率',rate(n?hits/n:null)],['跨日最长未中',max+' 次']];$('#report-totals').innerHTML=totals.map(([a,b])=>`<div class="total"><small>${a}</small><b>${b}</b></div>`).join('');let longest=Math.max(8,...stats.map(s=>s.daily_max_loss));const lengths=Array.from({length:longest-1},(_,i)=>longest-i);$('#report-head').innerHTML='<tr>'+['日期','期数','✅','❌','命中率','当日最长错','跨日最长错',...lengths.map(i=>'连'+i+'错')].map(s=>'<th>'+s+'</th>').join('')+'</tr>';$('#report-rows').innerHTML=reportData.map(r=>{const s=r.cases[key];return `<tr><td>${r.date}${r.complete?'':'<span class="incomplete">未完整</span>'}</td>${[s.periods,s.hits,s.misses,rate(s.hit_rate),s.daily_max_loss,s.cross_max_loss,...lengths.map(i=>s.loss_runs[i]||0)].map(v=>'<td>'+v+'</td>').join('')}</tr>`}).join('')||'<tr><td class="empty">尚无统计</td></tr>'}
async function loadNumbers(v){currentVariant=v;const data=await api('/api/numbers/'+v);currentNumbers=data.numbers;$$('[data-variant]').forEach(b=>b.classList.toggle('active',b.dataset.variant===v));$('#numbers-title').textContent=(v==='720'?'无对子':'号码'+v)+' · '+data.count+'组';$('#number-export').href='/api/export/numbers/'+v;$('#number-search').value='';renderNumbers()}
function renderNumbers(){const search=$('#number-search').value,rows=currentNumbers.filter(n=>n.includes(search));$('#number-grid').innerHTML=rows.map(n=>'<span>'+n+'</span>').join('');$('#number-count').textContent=`显示 ${rows.length} / ${currentNumbers.length} 组`}
function renderConfigured(c){$('#credentials-status').innerHTML=[['飞书',c.feishu],['图片',c.images],['Bark '+c.bark_devices+'台',c.bark_devices>0]].map(([n,ok])=>`<span class="badge ${ok?'':'neutral'}">${n} · ${ok?'已配置':'待配置'}</span>`).join('')}
async function loadSettings(){const {settings:s,configured:c}=await api('/api/settings');$('#alarm-enabled').checked=s.alarm_enabled;$('#daily-enabled').checked=s.daily_enabled;$('#alarm-threshold').value=s.alarm_threshold;$('#daily-time').value=s.daily_time;$('#bark-cooldown').value=s.bark_cooldown;$('#bark-critical').checked=s.bark_critical;$$('[name="alarm-case"]').forEach(x=>x.checked=s.alarm_cases.includes(x.value));renderConfigured(c);await loadDeliveries()}
async function loadDeliveries(){const rows=await api('/api/deliveries');const statuses={pending:'待发送',blocked:'待配置 / 未补发',sending:'发送中',sent:'接口确认接收',failed:'接口拒绝',uncertain:'结果待核实',expired:'已过期'};const kinds={daily:'日报/号码表',alarm:'连续未中',test:'手动测试',chart:'日报图片'};$('#delivery-rows').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.created.slice(0,19).replace('T',' '))}</td><td>${r.channel==='bark'?'Bark':'飞书'}</td><td>${kinds[r.kind]||esc(r.kind)}</td><td><span class="badge ${r.status==='sent'?'':'neutral'}">${statuses[r.status]||esc(r.status)}</span></td><td>${esc(r.error||'—')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">尚无发送记录。填写配置后可手动测试。</td></tr>'}
function stakeBase(){
  const first=$('.stake-row');
  const a=first?Number(first.querySelector('[name=amount]').value):0;
  return Number.isFinite(a)&&a>0?a:0.1;
}
function addStake(round='',amount='0.1',groups=480){
 const div=document.createElement('div');div.className='stake-row';
 const base=stakeBase();
 const multiple=(Number(amount)/base)||1;
 div.innerHTML=`<label>第几把<input name="round" type="number" min="1" max="100" value="${esc(round)}" required></label><label>号码组合<select name="group_count">${[[480,'480组 · 有兄弟'],[516,'516组 · 有兄弟（含1/9）'],[720,'720组 · 无对子']].map(([n,label])=>`<option value="${n}"${n===Number(groups)?' selected':''}>${label}</option>`).join('')}</select></label><label class="amount-cell">每组金额<input name="amount" type="number" min="0.1" max="1000000" step="0.1" value="${esc(amount)}" required><small>这一把每个号码下多少</small></label><label class="mult-cell">倍数<input name="multiple" type="number" min="0.1" step="0.1" value="${Number(multiple.toFixed(2))}"><small>= 第1把金额 × 倍数</small></label><div class="stake-subtotal"><span>本把合计</span><output></output></div><button type="button" class="remove" aria-label="移除此把">移除</button>`;
 const amountEl=div.querySelector('[name=amount]'), multEl=div.querySelector('[name=multiple]');
 const update=()=>{const n=Number(div.querySelector('[name=group_count]').value),a=Number(amountEl.value);div.querySelector('output').textContent=a>=0.1&&Number.isFinite(a)?(n*a).toFixed(1):'—'};
 multEl.oninput=()=>{const m=Number(multEl.value);if(m>0){amountEl.value=(stakeBase()*m).toFixed(2);update();invalidateSimulation()}};
 amountEl.oninput=()=>{const a=Number(amountEl.value),b=stakeBase();if(b>0&&a>0)multEl.value=Number((a/b).toFixed(2));update()};
 div.onchange=update;div.querySelector('button').onclick=()=>{div.remove();invalidateSimulation()};$('#stake-rows').append(div);update();
}
async function loadStake(){const s=await api('/api/v1/staking/schema');$('#stake-rows').innerHTML='';(s.rows.length?s.rows:[{round:1,group_count:480,amount:'0.1'}]).forEach(r=>addStake(r.round,r.amount,r.group_count));const rule=s.switch_rule||{enabled:true,loss_trigger:5,high_amount:'10',brother_hit_target:5};$('#switch-enabled').checked=rule.enabled;$('#switch-loss').value=rule.loss_trigger;$('#switch-amount').value=rule.high_amount;$('#switch-target').value=rule.brother_hit_target;renderSwitchRule();renderSwitchLive();if(!$('#simulation-end').value){const end=new Date(dayNow()+'T12:00:00+08:00');end.setDate(end.getDate()-1);$('#simulation-end').value=end.toISOString().slice(0,10);end.setDate(end.getDate()-6);$('#simulation-start').value=end.toISOString().slice(0,10)}}
function stakePayload(){return {rows:$$('.stake-row').map(x=>({round:Number(x.querySelector('[name=round]').value),group_count:Number(x.querySelector('[name=group_count]').value),amount:x.querySelector('[name=amount]').value})),switch_rule:{enabled:$('#switch-enabled').checked,loss_trigger:Number($('#switch-loss').value),high_amount:$('#switch-amount').value,brother_hit_target:Number($('#switch-target').value)}}}
function renderSimulation(r){simulationCsv=r.csv;$('#download-simulation').hidden=false;const s=r.summary;$('#simulation-summary').innerHTML=[['实际模拟期数',fmt(s.periods)],['兄弟✅ / 无对子✅',fmt(s.brother_hits)+' / '+fmt(s.no_double_hits)],['高金额阶段兄弟✅',fmt(s.high_brother_hits)],['进入 / 完成高金额轮次',s.high_entries+' / '+s.high_exits],['最长连续未中',s.max_loss+'期'],['累计模拟净值',fmt(s.net)]].map(([a,b])=>`<div class="total"><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('');$('#simulation-rows').innerHTML=r.rows.map(x=>`<tr><td>${x.issue}<small>${esc(x.time.replace('T',' '))}</small></td><td>${esc(x.code)} ${x.hit?'✅':'❌'}</td><td>${x.phase} / 第${x.round}把</td><td>${x.group_count} / ${esc(x.amount)}</td><td>${x.high_brother_hits}</td><td>${x.next_phase} / 第${x.next_round}把</td><td>${esc(x.net)}<small>${esc(x.balance)}</small></td><td>${esc(x.event||'—')}</td></tr>`).join('');$('#simulation-note').textContent=`显示最后${r.rows.length}期，CSV包含本次全部${s.periods}期。使用区间内已采集数据；期末阶段：${s.ending_phase}，本轮高金额兄弟累计命中${s.ending_high_brother_hits}。`}
$('#run-simulation').onclick=()=>action($('#run-simulation'),async()=>{if(!$('#stake-form').reportValidity())return;const start=$('#simulation-start').value,end=$('#simulation-end').value;if(!start||!end){toast('请选择完整的起止日期',true);return}const r=await api('/api/v1/staking/simulate',{method:'POST',body:JSON.stringify({...stakePayload(),start,end})});renderSimulation(r);toast('历史模拟完成')});
$('#download-simulation').onclick=()=>{const url=URL.createObjectURL(new Blob([simulationCsv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='历史模拟明细.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

async function start(){const session=await api('/api/session');csrf=session.csrf;$('#login').hidden=true;$('#app').hidden=false;const day=dayNow();$('#overview-day').value=day;$('#report-end').value=day;const date=new Date(day+'T12:00:00+08:00');date.setDate(date.getDate()-6);$('#report-start').value=date.toISOString().slice(0,10);showPage(location.hash.slice(1)||'overview');await loadOverview()}
$('#login-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{try{const r=await api('/api/login',{method:'POST',body:JSON.stringify({password:new FormData(e.target).get('password')})});csrf=r.csrf;sessionToken=r.token||'';e.target.reset();$('#login-error').textContent='';await start()}catch(err){$('#login-error').textContent=err.message}})};
$$('[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$$('[data-jump]').forEach(b=>b.onclick=()=>showPage(b.dataset.jump));$('#logout').onclick=()=>action($('#logout'),async()=>{await api('/api/logout',{method:'POST'});location.reload()});$('#refresh').onclick=()=>action($('#refresh'),async()=>{toast((await api('/api/collector/refresh',{method:'POST'})).message)});
$('#overview-day').onchange=()=>{loadPeriods().catch(e=>toast(e.message,true));loadOverview().catch(e=>toast(e.message,true))};$('#period-case').onchange=()=>loadPeriods().catch(e=>toast(e.message,true));$('#period-scope').onchange=()=>loadPeriods().catch(e=>toast(e.message,true));$('#more-periods').onclick=()=>loadPeriods(true).catch(e=>toast(e.message,true));$('#new-periods').onclick=()=>action($('#new-periods'),async()=>{await loadPeriods();$('#period-panel').scrollIntoView({block:'start'})});$('#load-reports').onclick=()=>action($('#load-reports'),loadReports);$('#report-case').onchange=renderReports;$('#send-report').onclick=()=>action($('#send-report'),async()=>toast((await api('/api/reports/send',{method:'POST',body:JSON.stringify({date:$('#report-end').value})})).message));
$$('[data-variant]').forEach(b=>b.onclick=()=>action(b,()=>loadNumbers(b.dataset.variant)));$('#number-search').oninput=renderNumbers;$('#copy-numbers').onclick=()=>action($('#copy-numbers'),async()=>{await navigator.clipboard.writeText(currentNumbers.join('\n'));toast('已复制 '+currentNumbers.length+'组号码')});
$('#settings-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{const s={alarm_enabled:$('#alarm-enabled').checked,alarm_cases:$$('[name="alarm-case"]:checked').map(x=>x.value),alarm_threshold:Number($('#alarm-threshold').value),daily_enabled:$('#daily-enabled').checked,daily_time:$('#daily-time').value,bark_cooldown:Number($('#bark-cooldown').value),bark_critical:$('#bark-critical').checked};await api('/api/settings',{method:'PUT',body:JSON.stringify(s)});toast('提醒设置已保存');renderStatus(await api('/api/status'))})};
$('#credentials-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{const f=new FormData(e.target),body={clear:f.getAll('clear')};for(const key of ['feishu_webhook','feishu_signing_secret','feishu_app_id','feishu_app_secret'])if(f.get(key).trim())body[key]=f.get(key).trim();if(f.get('bark_urls').trim())body.bark_urls=f.get('bark_urls').split('\n').map(x=>x.trim()).filter(Boolean);const r=await api('/api/credentials',{method:'PUT',body:JSON.stringify(body)});e.target.reset();renderConfigured(r.configured);toast('连接配置已保存，密钥不回显');renderStatus(await api('/api/status'))})};
$$('[data-test]').forEach(b=>b.onclick=()=>action(b,async()=>toast((await api('/api/notifications/test/'+b.dataset.test,{method:'POST'})).message)));$('#reload-deliveries').onclick=()=>action($('#reload-deliveries'),loadDeliveries);$('#add-stake').onclick=()=>{invalidateSimulation();const round=Math.max(0,...$$('.stake-row').map(x=>Number(x.querySelector('[name=round]').value)))+1;if(round>100){toast('最多设置到第100把',true);return}addStake(round)};$('#stake-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{await api('/api/v1/staking/draft',{method:'PUT',body:JSON.stringify(stakePayload())});toast('号码组合与金额草稿已保存，执行未启用')})};
start().catch(e=>{if(!/请先登录/.test(e.message))$('#login-error').textContent=e.message});setInterval(()=>{if(!$('#app').hidden&&activePage==='overview')loadOverview().catch(()=>{});if(!$('#app').hidden&&activePage==='settings')loadDeliveries().catch(()=>{})},15000);
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!$('#app').hidden&&activePage==='overview'&&periodsKey&&periodsHasMore&&!periodsBusy)loadPeriods(true).catch(e=>toast(e.message,true))},{rootMargin:'0px 0px 180px 0px'});observer.observe($('#period-sentinel'))}
$('#logout-mobile').onclick=()=>action($('#logout-mobile'),async()=>{await api('/api/logout',{method:'POST'});location.reload()});

// Exports from Pages use the in-memory authenticated session; tokens never enter URLs.
document.addEventListener('click',event=>{const a=event.target.closest('a');if(!API_BASE||!a)return;const path=a.getAttribute('href');if(!path?.startsWith('/api/'))return;event.preventDefault();const tab=a.target==='_blank'?window.open('about:blank','_blank'):null;(async()=>{try{const response=await request(path);if(!response.ok)throw Error('导出失败，请重新登录后重试');const blob=await response.blob(),url=URL.createObjectURL(blob);if(tab){tab.location=url}else{const link=document.createElement('a');link.href=url;const m=(response.headers.get('Content-Disposition')||'').match(/filename="([^"\r\n]+)"/);link.download=m?m[1]:'report';document.body.append(link);link.click();link.remove()}setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){if(tab)tab.close();toast(e.message,true)}})()});

function invalidateSimulation(){if(!simulationCsv)return;simulationCsv='';$('#download-simulation').hidden=true;$('#simulation-summary').innerHTML='';$('#simulation-rows').innerHTML='';$('#simulation-note').textContent='配置或日期已更改，请重新运行模拟。'}
$('#stake-form').addEventListener('input',invalidateSimulation);$('#stake-form').addEventListener('change',invalidateSimulation);$('#simulation-start').onchange=invalidateSimulation;$('#simulation-end').onchange=invalidateSimulation;

/* ---------- 自动投注（云端计划 + 本机执行器） ---------- */
let autobetData=null;
function autobetBadge(text,kind){const el=$('#autobet-badge');if(!el)return;el.textContent=text;el.className='badge '+(kind||'neutral')}
function renderAutobetStatus(s){
  const on=s.enabled;
  const dot=$('#ab-dot');
  dot.className='ab-dot '+(on?(s.dry_run?'':'run'):'stop');
  $('#ab-state-text').textContent = on ? (s.dry_run?'模拟运行中':'自动投注运行中') : (s.stop_requested?'已停止':'待启动');
  const stop=s.stop;
  const modeText = s.mode==='continuous' ? '连续运行' : '只跑本期';
  $('#ab-state-sub').textContent = on
    ? (modeText + (s.stop_requested?' · 已请求停止（本期后不再开新期）':' · 每 20 秒检查新一期'))
    : (stop? '停止于 '+String(stop.at).slice(5,19).replace('T',' ') : '未运行');
  const n=s.next||{};
  $('#ab-kpi-plan').textContent = n.blocked? '待配置计划' : ('第 '+n.round+' 把 · '+n.group_count+' 组');
  $('#ab-kpi-amount').textContent = n.blocked? '—' : (n.amount+' × '+n.count+' 注 ≈ '+(Number(n.amount)*n.count).toFixed(2));
  const last=(s.orders||[])[0];
  $('#ab-kpi-placed').textContent = last? (last.placed+' 注 · 第'+last.issue+'期') : '—';
  $('#ab-kpi-spent').textContent = s.stake_total? (s.stake_total+' 元') : '0 元';
  $('#ab-kpi-left').textContent = s.budget_left!=null? (s.budget_left+' 元') : '—';
  $('#ab-stop').disabled = !on;
}
function renderAutobet(s){
  autobetData=s;
  renderAutobetStatus(s);
  const on=s.enabled;
  autobetBadge(on?(s.dry_run?'模拟运行中':'真实投注已开启'):'已停止',on?(s.dry_run?'warn':''):'neutral');
  $('#stake-exec-state').textContent=on?(s.dry_run?'模拟中':'真实投注'):'未启用';
  if(!$('#autobet-site').value)$('#autobet-site').value=s.site||'https://s4.sd3568.xyz';
  if(!$('#autobet-account').value)$('#autobet-account').value=s.account||'';
  $('#autobet-dry').checked=!!s.dry_run;
  $('#autobet-lead').value=s.lead_seconds||90;
  const n=s.next;
  $('#autobet-plan').innerHTML = (!n||n.blocked)
    ? `<p class="field-note">${esc(n?.blocked||'先在下方保存一份金额计划草稿')}</p>`
    : `<div class="plan-grid">
        <div><small>第几把</small><b>第 ${n.round} 把</b></div>
        <div><small>号码组合</small><b>${n.group_count} 组</b></div>
        <div><small>每组金额</small><b>${esc(n.amount)}</b></div>
        <div><small>本期合计</small><b>${esc(n.planned_stake)}</b></div>
        <div><small>金额阶段</small><b>${n.phase}</b></div>
        <div><small>连续未中</small><b>${s.state.loss} 次</b></div>
      </div><p class="field-note">执行器会把 ${n.count} 个号码逐个下注，每个 ${esc(n.amount)}；本期计划注数 ${n.count}。上次投注期号：${s.state.last_issue??'—'}。</p>`;
  $('#autobet-orders').innerHTML = s.orders.length ? s.orders.map(o=>`<tr>
     <td>${o.issue}</td><td>第${o.round}把</td><td>${o.group_count}</td><td>${esc(o.amount)}</td>
     <td>${o.placed}</td>
     <td><span class="badge ${o.status==='settled'?'':(o.status==='partial'?'warn':'neutral')}">${o.status==='settled'?'已结算':(o.status==='partial'?'部分注单':'待结算')}</span></td>
     <td>${o.code?esc(o.code)+(o.hit?' ✅':' ❌'):'—'}</td>
     <td>${esc((o.created||'').slice(5,19).replace('T',' '))}</td></tr>`).join('')
    : '<tr><td colspan="8" class="empty">尚无注单。启用后由本机执行器每期回报一条。</td></tr>';
}
async function loadAutobet(){const s=await api('/api/v1/autobet/status');renderAutobet(s)}
function autobetSettingsBody(base){
  return {...base,autobet_enabled:autobetData?autobetData.enabled:false,
    autobet_dry_run:$('#autobet-dry').checked,
    autobet_site:$('#autobet-site').value.trim()||'https://s4.sd3568.xyz',
    autobet_lead_seconds:Number($('#autobet-lead').value)||90,
    autobet_account:$('#autobet-account').value.trim()};
}
$('#autobet-save').onclick=()=>action($('#autobet-save'),async()=>{
  const {settings:s}=await api('/api/settings');
  const {alarm_enabled,alarm_cases,alarm_threshold,daily_enabled,daily_time,bark_cooldown,bark_critical}=s;
  await api('/api/settings',{method:'PUT',body:JSON.stringify(autobetSettingsBody({alarm_enabled,alarm_cases,alarm_threshold,daily_enabled,daily_time,bark_cooldown,bark_critical}))});
  const cookie=$('#autobet-cookie').value.trim();
  if(cookie){await api('/api/credentials',{method:'PUT',body:JSON.stringify({autobet_cookie:cookie})});$('#autobet-cookie').value=''}
  await loadAutobet();toast(cookie?'连接设置与会话已保存':'连接设置已保存');
});
$('#autobet-check').onclick=()=>action($('#autobet-check'),async()=>{
  const cookie=$('#autobet-cookie').value.trim();
  if(cookie){await api('/api/credentials',{method:'PUT',body:JSON.stringify({autobet_cookie:cookie})});$('#autobet-cookie').value=''}
  const r=await api('/api/v1/autobet/session/read',{method:'POST'});
  toast(r.cookie?`已保存会话：${r.cookie.slice(0,12)}… · 账号 ${r.account||'未填写'}`:'尚未保存会话');
});
async function startRun(mode,btn){
  await action(btn,async()=>{
    const {settings:s}=await api('/api/settings');
    const {alarm_enabled,alarm_cases,alarm_threshold,daily_enabled,daily_time,bark_cooldown,bark_critical}=s;
    await api('/api/settings',{method:'PUT',body:JSON.stringify(autobetSettingsBody({alarm_enabled,alarm_cases,alarm_threshold,daily_enabled,daily_time,bark_cooldown,bark_critical}))});
    await api('/api/v1/autobet/start',{method:'POST',body:JSON.stringify({mode})});
    await loadAutobet();
    toast(mode==='single'?'已启动：只跑下一期':'已启动：连续运行');
  });
}
$('#autobet-start-once').onclick=()=>startRun('single',$('#autobet-start-once'));
$('#autobet-start-cont').onclick=()=>startRun('continuous',$('#autobet-start-cont'));
$('#autobet-stop-soft').onclick=()=>action($('#autobet-stop-soft'),async()=>{
  await api('/api/v1/autobet/stop_soft',{method:'POST'});
  await loadAutobet();
  toast('已请求停止：当前批次跑完、本期后不再开新期');
});

$('#autobet-reload').onclick=()=>action($('#autobet-reload'),async()=>{await loadAutobet();await loadSite()});

/* 通用下单脚本：在投注站页面内执行，任何设备可用 */
function buildBetScript(token, csrf, base, budgetLeft){
  const cfg={B:base,T:token,C:csrf,left:Number(budgetLeft)||10};
  const code = `javascript:(async()=>{try{
const CFG=${JSON.stringify(cfg)};
const H={'Authorization':'Bearer '+CFG.T,'X-CSRF-Token':CFG.C,'Content-Type':'application/json'};
const LS='p911DoneIssue';
const pad=n=>String(n);
const once=async()=>{
 const p=await (await fetch(CFG.B+'/api/v1/autobet/plan',{headers:H})).json();
 if(p.blocked){console.warn('计划未就绪',p.blocked);return}
 const st=await (await fetch(CFG.B+'/api/v1/autobet/status',{headers:H})).json();
 if(!st.enabled){console.warn('自动投注已暂停');return}
 const unit=parseFloat(p.amount), left=parseFloat(st.budget_left||'0');
 const cap=Math.max(0,Math.floor(left/unit));
 if(cap<1){console.warn('预算不足一注',left);return}
 const h=await (await fetch('/initHome?awaken=180')).json();
 const ltn=(h.lottry||{}).ltn; if(!ltn){console.warn('取不到期号，请确认已登录');return}
 if(localStorage.getItem(LS)==String(ltn))return;
 const nums=p.numbers.slice(0,Math.min(cap,p.numbers.length));
 const am=Math.round(unit*10000); let ok=0,fail=0,msg='';
 for(let i=0;i<nums.length;i+=80){
   const chunk=nums.slice(i,i+80).map(n=>({nm:n}));
   const body=new URLSearchParams({'paramMap.nms':JSON.stringify(chunk),'paramMap.bw':'1','paramMap.ltn':String(ltn),'paramMap.am':String(am),'paramMap.ock':(Date.now().toString(16)+Math.random().toString(16).slice(2,12))});
   const r=await (await fetch('/lot/beting',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body})).json();
   ok+=r.scc||0; fail+=r.fdc||0; if(r.msg)msg=String(r.msg).slice(0,60);
 }
 await fetch(CFG.B+'/api/v1/autobet/report',{method:'POST',headers:H,body:JSON.stringify({issue:+ltn,round:p.round,group_count:p.group_count,amount:p.amount,placed:ok,note:'web '+msg})});
 localStorage.setItem(LS,String(ltn));
 console.log('第'+ltn+'期 成功'+ok+' 失败'+fail,msg);
 if(window.__p911First){alert('已开始自动下单\n第'+ltn+'期：成功'+ok+'注，失败'+fail+'注\n每20秒检查新一期，保持本页面打开。');window.__p911First=false}
};
window.__p911First=true;
await once();
if(window.__p911Timer)clearInterval(window.__p911Timer);
window.__p911Timer=setInterval(()=>once().catch(e=>console.warn(e)),20000);
}catch(e){alert('执行失败：'+(e&&e.message||e))}})()`;
  return code;
}
$('#autobet-make').onclick=()=>action($('#autobet-make'),async()=>{
  const r=await api('/api/v1/autobet/token',{method:'POST'});
  const st=await api('/api/v1/autobet/status');
  const base=(window.P911_CONFIG?.apiBase||location.origin).replace(/\/$/,'');
  $('#autobet-script').value=buildBetScript(r.token,r.csrf,base,st.budget_left);
  toast('脚本已生成，12 小时内有效');
});
$('#autobet-copy').onclick=()=>action($('#autobet-copy'),async()=>{
  const v=$('#autobet-script').value;
  if(!v){toast('先生成脚本',true);return}
  try{await navigator.clipboard.writeText(v);toast('已复制')}catch{ $('#autobet-script').select();toast('已选中，请手动复制') }
});


/* 紧急停止：立刻关闭开关，执行器下一批前中止 */
$('#ab-stop').onclick=()=>action($('#ab-stop'),async()=>{
  if(!confirm('确认紧急停止？\n将立刻停止自动投注，执行器在当前批次结束后中止。')) return;
  const r=await api('/api/v1/autobet/stop',{method:'POST'});
  await loadAutobet();
  toast('已紧急停止：'+String(r.stopped_at).slice(11,19));
});

/* 金额切换规则：实时预览 + 当前运行状态 */
function switchPlanText(){
  const rows=$$('.stake-row').map(x=>({count:x.querySelector('[name=group_count]').value,amount:x.querySelector('[name=amount]').value}));
  if(!rows.length) return '';
  const seq=rows.map(r=>r.count).join(' → ');
  const loss=Number($('#switch-loss').value)||0, high=Number($('#switch-amount').value)||0, target=Number($('#switch-target').value)||0;
  const on=$('#switch-enabled').checked;
  if(!on) return `当前计划 <b>${seq}</b>，未启用切换：每期按各把原金额循环。`;
  return `当前计划 <b>${seq}</b>。<br>连续 <b>${loss}</b> 把 ❌ 后，<b>下一把从第 1 把（${rows[0].count} 组）重新开始</b>，每组改按高金额 <b>${high}</b> 元；`
       + `高金额阶段累计 <b>${target}</b> 把兄弟命中（480/516，720 不算）后，<b>下一把恢复正常金额</b>。`;
}
function renderSwitchRule(){
  if(!$('#switch-preview')) return;
  $('#switch-preview').innerHTML = switchPlanText();
}
async function renderSwitchLive(){
  const box=$('#switch-live'); if(!box) return;
  try{
    const s=await api('/api/v1/autobet/status');
    const st=s.state||{};
    const phase = st.phase==='high' ? '高金额' : '正常';
    box.innerHTML = `<span class="chip ${st.phase==='high'?'hot':''}">当前阶段：${phase}</span>`
      + `<span class="chip">连续❌：${st.loss??0} 把</span>`
      + `<span class="chip">高金额阶段兄弟累计✅：${st.brother_hits??0} 把</span>`
      + `<span class="chip">下一把：第 ${(s.next&&s.next.round)||st.round||1} 把</span>`
      + `<span class="chip">单期金额：${s.next&&!s.next.blocked ? (Number(s.next.amount)*s.next.count).toFixed(2)+' 元' : '—'}</span>`;
  }catch(e){ box.textContent=''; }
}
['#switch-loss','#switch-amount','#switch-target','#switch-enabled'].forEach(sel=>{
  const el=$(sel); if(el){ el.addEventListener('input',()=>{renderSwitchRule();invalidateSimulation();}); el.addEventListener('change',renderSwitchRule); }
});
$('#stake-rows').addEventListener('input',()=>{renderSwitchRule();});
$('#stake-rows').addEventListener('change',()=>{renderSwitchRule();});

/* 投注站账户与盈亏 */
function renderSite(v){
  const money=n=>n==null?'—':Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})+' 元';
  $('#site-account').textContent=v.account||'—';
  $('#site-balance').textContent=money(v.balance);
  $('#site-credit').textContent=money(v.credit);
  const s=v.summary||{};
  $('#site-stake').textContent=money(s.stake);
  $('#site-bonus').textContent=money(s.bonus);
  const net=$('#site-net'); net.textContent=money(s.net);
  net.className=(s.net||0)>=0?'pos':'neg';
  $('#site-sync-at').textContent=v.at? '同步于 '+String(v.at).slice(5,19).replace('T',' '):'尚未同步';
  $('#site-bills').innerHTML=(v.bills||[]).length? v.bills.map(b=>{
    const cls=(b.net||0)>=0?'pos':'neg';
    return `<tr><td>${b.issue}</td><td>${esc(b.day||'—')}</td><td>${fmt(b.count)}</td>
      <td>${(b.stake||0).toFixed(2)}</td><td>${(b.bonus||0).toFixed(2)}</td>
      <td class="${cls}">${(b.net||0)>=0?'+':''}${(b.net||0).toFixed(2)}</td></tr>`}).join('')
    : '<tr><td colspan="6" class="empty">执行器会在 60 秒内同步一次；若长时间为空，检查会话是否失效。</td></tr>';
}
async function loadSite(){ try{ renderSite(await api('/api/v1/autobet/site')); }catch(e){} }

/* 特殊把与当天翻倍（仅模拟） */
let specialCsv='';
$('#sp-run').onclick=()=>action($('#sp-run'),async()=>{
  const start=$('#sp-start').value,end=$('#sp-end').value;
  if(!start||!end){toast('请选择起止日期',true);return}
  const body={...stakePayload(),start,end,rule:{
    loss_trigger:Number($('#sp-loss').value),special_mode:$('#sp-mode').value,
    special_amount:$('#sp-amount').value,double_losses:Number($('#sp-dloss').value),
    double_within:Number($('#sp-within').value),double_factor:$('#sp-factor').value}};
  const r=await api('/api/v1/staking/simulate_special',{method:'POST',body:JSON.stringify(body)});
  const s=r;
  $('#sp-summary').innerHTML=[['模拟期数',fmt(s.periods)],['总命中',fmt(s.hits)],
    ['特殊把次数',fmt(s.specials)],['特殊把命中',fmt(s.special_hits)],
    ['翻倍天数',fmt(s.double_days)],['总投入',s.stake],['总返还',s.gross],['净值',s.net]]
    .map(([a,b])=>`<div class="total"><small>${esc(a)}</small><b>${esc(String(b))}</b></div>`).join('');
  $('#sp-daily').innerHTML=(s.daily||[]).map(d=>`<tr><td>${esc(d.date)}</td><td>${d.periods}</td><td>${d.hits}</td>
     <td>${d.specials}</td><td>${d.special_hits}</td><td>${d.doubled?'是':'否'}</td>
     <td>${esc(d.stake)}</td><td>${esc(d.gross)}</td><td>${esc(d.net)}</td></tr>`).join('');
  $('#sp-rows').innerHTML=(s.rows||[]).slice(0,120).map(x=>`<tr><td>${x.issue}<small>${esc(x.time.replace('T',' '))}</small></td>
     <td>${esc(x.code)} ${x.hit?'✅':'❌'}</td><td>${x.kind}</td><td>${x.groups}</td><td>${esc(x.amount)}</td>
     <td>${esc(x.factor)}</td><td>${esc(x.stake)}</td><td>${esc(x.gross)}</td></tr>`).join('');
  specialCsv=[['期号','时间','号码','类型','组数','每组金额','倍数','命中','投入','返还','净值'].join(',')]
    .concat((s.rows||[]).map(x=>[x.issue,x.time,x.code,x.kind,x.groups,x.amount,x.factor,x.hit,x.stake,x.gross,x.net].join(','))).join('\n');
  $('#sp-csv').hidden=false;
  toast('特殊规则模拟完成（未产生任何真实注单）');
});
$('#sp-csv').onclick=()=>{const url=URL.createObjectURL(new Blob(["\ufeff"+specialCsv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='特殊把模拟明细.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

/* 保存特殊规则（用于真实下单状态机） */
$('#sp-save').onclick=()=>action($('#sp-save'),async()=>{
  const rule={loss_trigger:Number($('#sp-loss').value),special_mode:$('#sp-mode').value,
    special_amount:$('#sp-amount').value,double_losses:Number($('#sp-dloss').value),
    double_within:Number($('#sp-within').value),double_factor:$('#sp-factor').value};
  await api('/api/v1/staking/special',{method:'PUT',body:JSON.stringify(rule)});
  // 同时打开状态机里的特殊规则开关（云端执行时生效）
  toast('特殊规则已保存；执行器会按此规则下单（模拟模式下不会真实提交）');
});

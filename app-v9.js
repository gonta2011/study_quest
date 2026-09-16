const STORAGE_KEY="study-quest-v1";

const SYNC_CONFIG_KEY="study-quest-sync-config-v1";
function loadSyncConfig(){
  try{return JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY)||"{}")}catch(e){return{}}
}
function saveSyncConfig(cfg){localStorage.setItem(SYNC_CONFIG_KEY,JSON.stringify(cfg||{}))}
function hasSyncConfig(){
  const c=loadSyncConfig();
  return Boolean(c.endpoint&&c.key);
}
function syncConfig(){return loadSyncConfig()}
function formatSyncTime(v){
  if(!v)return"未同期";
  const d=new Date(v); if(Number.isNaN(d.getTime()))return"未同期";
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function setSyncStatus(kind,text){
  const el=document.querySelector("#syncStatus"); if(!el)return;
  el.className=`pill sync-status ${kind}`; el.textContent=text;
}
function renderSyncUI(){
  const cfg=syncConfig();
  const ep=document.querySelector("#syncEndpoint"),key=document.querySelector("#syncKey"),last=document.querySelector("#lastSyncLabel");
  if(ep&&document.activeElement!==ep)ep.value=cfg.endpoint||"";
  if(key&&document.activeElement!==key)key.value=cfg.key||"";
  if(last)last.textContent=formatSyncTime(cfg.lastSyncAt);
  if(!cfg.endpoint||!cfg.key)setSyncStatus("off","未設定");
  else setSyncStatus("ready","接続設定済");
}
function jsonpPull_(endpoint,key){
  return new Promise((resolve,reject)=>{
    const callback=`__sqcb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script=document.createElement("script");
    let timer=null;
    const cleanup=()=>{if(timer)clearTimeout(timer);delete window[callback];script.remove()};
    window[callback]=(data)=>{cleanup();resolve(data)};
    try{
      const u=new URL(endpoint);
      u.searchParams.set("action","pull");
      u.searchParams.set("key",key);
      u.searchParams.set("prefix",callback);
      u.searchParams.set("_",String(Date.now()));
      script.src=u.toString();
      script.onerror=()=>{cleanup();reject(new Error("Apps Scriptへ接続できません"))};
      timer=setTimeout(()=>{cleanup();reject(new Error("同期がタイムアウトしました"))},60000);
      document.head.appendChild(script);
    }catch(err){cleanup();reject(err)}
  });
}
async function postToSheets_(payload){
  const cfg=syncConfig();
  if(!cfg.endpoint||!cfg.key)throw new Error("Google Sheets連携が未設定です");
  const body=JSON.stringify({...payload,key:cfg.key});
  await fetch(cfg.endpoint,{
    method:"POST",
    mode:"no-cors",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body
  });
  return true;
}
function sheetTaskToLocal_(t){
  return{
    id:Number(t.id),
    subject:t.subject||"",
    book:t.book||"",
    round:t.round||"",
    unit:t.unit||"",
    level:t.level||"A",
    number:t.number||"",
    startDate:t.startDate||todayKey(),
    nextReviewDate:t.nextReviewDate||t.startDate||todayKey(),
    reviewStage:Number.isFinite(Number(t.reviewStage))?Number(t.reviewStage):-1,
    status:t.status||"未着手",
    priority:Number.isFinite(Number(t.priority))?Number(t.priority):(t.level==="A"?70:t.level==="B"?50:30),
    miss:t.miss||"",
    mastered:Boolean(t.mastered),
    lastResult:t.lastResult||null,
    lastStudyDate:t.lastStudyDate||null,
    note:t.note||"",
    enabled:t.enabled!==false
  };
}
function sheetHistoryToLocal_(h){
  return{
    taskId:Number(h.taskId),
    date:h.date||"",
    result:h.result||"",
    xp:Number(h.xp||0),
    beforeStage:Number.isFinite(Number(h.beforeStage))?Number(h.beforeStage):null,
    reviewStage:Number.isFinite(Number(h.afterStage))?Number(h.afterStage):null,
    nextReviewDate:h.nextReviewDate||null,
    deviceTime:h.deviceTime||""
  };
}
async function pullFromSheets(opts={}){
  const cfg=syncConfig();
  if(!cfg.endpoint||!cfg.key){if(!opts.silent)showToast("連携設定を入力してください");return false}
  setSyncStatus("syncing","同期中…");
  const btn=document.querySelector("#syncNowBtn"); if(btn)btn.disabled=true;
  try{
    const data=await jsonpPull_(cfg.endpoint,cfg.key);
    if(!data||data.ok!==true)throw new Error((data&&data.error)||"同期に失敗しました");
    const keepCelebrated=Array.isArray(state.celebratedDates)?state.celebratedDates:[];
    state=migrateState({
      xp:Number(data.settings?.xp||0),
      streak:Number(data.settings?.streak||0),
      lastStudyDate:data.settings?.lastStudyDate||"",
      tasks:(data.tasks||[]).map(sheetTaskToLocal_),
      history:(data.history||[]).map(sheetHistoryToLocal_),
      weaknesses:Array.isArray(data.weaknesses)?data.weaknesses:[],
      attentionUnits:Array.isArray(data.attentionUnits)?data.attentionUnits:[],
      dailyPlan:null,
      celebratedDates:keepCelebrated
    });
    state.tasks=state.tasks.filter(t=>t.enabled!==false&&Number.isFinite(Number(t.id)));
    saveState();
    const nextCfg={...cfg,lastSyncAt:new Date().toISOString()};
    saveSyncConfig(nextCfg);
    render();
    renderSyncUI();
    setSyncStatus("ok","同期済");
    if(!opts.silent)showToast(`Google Sheetsから ${state.tasks.length}問 読み込みました`);
    return true;
  }catch(err){
    setSyncStatus("error","同期エラー");
    if(!opts.silent)alert(`Google Sheetsと同期できませんでした。\n${err.message||err}`);
    return false;
  }finally{
    if(btn)btn.disabled=false;
  }
}
async function pushResultToSheets_(task,historyEntry,beforeStage){
  if(!hasSyncConfig())return;
  try{
    await postToSheets_({
      action:"save_result",
      task:{
        id:task.id,
        nextReviewDate:task.nextReviewDate,
        reviewStage:task.reviewStage,
        status:task.status,
        priority:task.priority,
        miss:task.miss||"",
        mastered:Boolean(task.mastered),
        lastResult:task.lastResult||"",
        lastStudyDate:task.lastStudyDate||"",
        note:task.note||""
      },
      history:{
        date:historyEntry.date,
        result:historyEntry.result,
        xp:historyEntry.xp,
        beforeStage,
        afterStage:task.reviewStage,
        nextReviewDate:task.nextReviewDate,
        deviceTime:new Date().toISOString()
      },
      settings:{xp:state.xp,streak:state.streak,lastStudyDate:state.lastStudyDate||""}
    });
  }catch(err){
    showToast("端末には保存済み／シート送信は再確認してください");
  }
}


function localISODate(date=new Date()){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,"0");
  const d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function todayKey(){return localISODate(new Date())}
function parseLocalDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||""))) return null;
  const [y,m,d]=iso.split("-").map(Number);
  const dt=new Date(y,m-1,d,12,0,0,0);
  return Number.isNaN(dt.getTime())?null:dt;
}
function addDaysISO(baseIso,days){
  const d=parseLocalDate(baseIso)||new Date();
  d.setDate(d.getDate()+days);
  return localISODate(d);
}
function diffDays(fromIso,toIso){
  const a=parseLocalDate(fromIso), b=parseLocalDate(toIso);
  if(!a||!b) return 0;
  return Math.round((b-a)/86400000);
}
function formatJPDate(iso,withYear=false){
  const d=parseLocalDate(iso); if(!d) return "—";
  return withYear?`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`:`${d.getMonth()+1}/${d.getDate()}`;
}
function inferOldStage(status){
  if(status==="定着") return 4;
  if(status==="2週間後確認"||status==="定着確認待ち") return 3;
  if(status==="1週間後確認") return 2;
  if(status==="3日後確認") return 1;
  if(status==="翌日確認"||status==="直し待ち"||status==="理解不十分"||status==="再確認") return 0;
  return -1;
}
function futureDateFromOldStatus(status){
  const t=todayKey();
  if(status==="3日後確認") return addDaysISO(t,3);
  if(status==="1週間後確認") return addDaysISO(t,7);
  if(status==="2週間後確認"||status==="定着確認待ち") return addDaysISO(t,14);
  return addDaysISO(t,7);
}

const seed={xp:120,streak:2,lastStudyDate:"",tasks:[
{id:1,subject:"算数",book:"テーマ教材",unit:"単位換算",level:"A",number:"No.8",priority:93,status:"直し待ち",nextReviewDate:todayKey(),reviewStage:0,mastered:false,lastResult:null,miss:"単位",lastStudyDate:null},
{id:2,subject:"算数",book:"演習教材",unit:"約数",level:"A",number:"No.4",priority:90,status:"理解不十分",nextReviewDate:todayKey(),reviewStage:0,mastered:false,lastResult:null,miss:"同じ誤り",lastStudyDate:null},
{id:3,subject:"国語",book:"国語テキスト",unit:"物語文・心情",level:"A",number:"問3",priority:82,status:"再確認",nextReviewDate:todayKey(),reviewStage:0,mastered:false,lastResult:null,miss:"根拠不足",lastStudyDate:null},
{id:4,subject:"算数",book:"演習教材",unit:"図形",level:"B",number:"No.13",priority:68,status:"再確認",nextReviewDate:todayKey(),reviewStage:0,mastered:false,lastResult:null,miss:"図・条件整理",lastStudyDate:null},
{id:5,subject:"理科",book:"理科テキスト",unit:"人体",level:"A",number:"No.7",priority:61,status:"3日後確認",nextReviewDate:addDaysISO(todayKey(),3),reviewStage:1,mastered:false,lastResult:null,miss:"知識不足",lastStudyDate:todayKey()},
{id:6,subject:"国語",book:"国語テキスト",unit:"物語文・理由説明",level:"A",number:"問4",priority:52,status:"1週間後確認",nextReviewDate:addDaysISO(todayKey(),7),reviewStage:2,mastered:false,lastResult:null,miss:"自分の解釈優先",lastStudyDate:todayKey()},
{id:7,subject:"社会",book:"社会テキスト",unit:"地理",level:"B",number:"No.15",priority:39,status:"2週間後確認",nextReviewDate:addDaysISO(todayKey(),14),reviewStage:3,mastered:false,lastResult:null,miss:"知識不足",lastStudyDate:todayKey()},
{id:8,subject:"算数",book:"演習教材",unit:"速さ",level:"A",number:"No.6",priority:25,status:"定着",nextReviewDate:null,reviewStage:4,mastered:true,lastResult:"excellent",miss:"ケアレス",lastStudyDate:todayKey()}
],history:[]};

function cloneSeed(){return JSON.parse(JSON.stringify(seed))}
function migrateState(input){
  const st=input&&typeof input==="object"?input:cloneSeed();
  st.xp=Number.isFinite(Number(st.xp))?Number(st.xp):0;
  st.streak=Number.isFinite(Number(st.streak))?Number(st.streak):0;
  st.lastStudyDate=st.lastStudyDate||"";
  st.history=Array.isArray(st.history)?st.history:[];
  st.tasks=Array.isArray(st.tasks)?st.tasks:[];
  st.weaknesses=Array.isArray(st.weaknesses)?st.weaknesses:[];
  st.attentionUnits=Array.isArray(st.attentionUnits)?st.attentionUnits:[];
  if(!st.dailyPlan||typeof st.dailyPlan!=="object")st.dailyPlan=null;
  if(!Array.isArray(st.celebratedDates))st.celebratedDates=[];
  st.tasks=st.tasks.map(t=>{
    const x={...t};
    x.mastered=Boolean(x.mastered||x.status==="定着");
    if(!Number.isInteger(x.reviewStage)) x.reviewStage=inferOldStage(x.status);
    if(x.mastered){x.reviewStage=4;x.nextReviewDate=null;x.status="定着";}
    else if(!parseLocalDate(x.nextReviewDate)){
      if(x.nextReview==="today") x.nextReviewDate=todayKey();
      else if(x.nextReview==="future") x.nextReviewDate=futureDateFromOldStatus(x.status);
      else x.nextReviewDate=todayKey();
    }
    if(!x.lastStudyDate){
      const hist=st.history.filter(h=>h.taskId===x.id&&parseLocalDate(h.date)).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
      x.lastStudyDate=hist?hist.date:null;
    }
    delete x.nextReview;
    return x;
  });
  return st;
}
function loadState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    const migrated=migrateState(raw?JSON.parse(raw):cloneSeed());
    localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));
    return migrated;
  }catch(e){return cloneSeed()}
}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}

let state=loadState(),activeTaskId=null,filterSubject="すべて";
function getLevel(){return Math.max(1,Math.floor(state.xp/100)+1)}
function isDue(t,iso=todayKey()){return !t.mastered&&parseLocalDate(t.nextReviewDate)&&t.nextReviewDate<=iso}
function todaysTasks(){return state.tasks.filter(t=>isDue(t))}
function scheduledCount(iso){return state.tasks.filter(t=>!t.mastered&&t.nextReviewDate===iso).length}
function overdueCount(){const today=todayKey();return state.tasks.filter(t=>!t.mastered&&parseLocalDate(t.nextReviewDate)&&t.nextReviewDate<today).length}
function weekCount(){const today=todayKey(),end=addDaysISO(today,7);return state.tasks.filter(t=>!t.mastered&&parseLocalDate(t.nextReviewDate)&&t.nextReviewDate>today&&t.nextReviewDate<=end).length}
function overdueDays(t){return t.mastered||!t.nextReviewDate?0:Math.max(0,diffDays(t.nextReviewDate,todayKey()))}
function effectivePriority(t){return Number(t.priority||0)+Math.min(20,overdueDays(t)*2)}

function sundayOrdinal(date){return Math.floor((date.getDate()-1)/7)+1}
function getLoadProfile(date=parseLocalDate(todayKey())||new Date()){
  const dow=date.getDay();
  if(dow===1)return{key:"mon",day:"月曜日",label:"ふつう",schedule:"ピアノ 16:40–17:30",maxTasks:5,minutes:30,note:"通塾がないので、Aレベルの直しと再確認をバランスよく進める日です。",mascot:"assets/bunny-cheer.png"};
  if(dow===2)return{key:"tue",day:"火曜日",label:"かなり軽め",schedule:"国語 17:00–18:50／算数2nd 19:10–21:00",maxTasks:2,minutes:15,note:"授業が長い日。期限到来の中から最優先だけに絞ります。",mascot:"assets/panda-calm.png"};
  if(dow===3)return{key:"wed",day:"水曜日",label:"しっかり復習",schedule:"通塾なし",maxTasks:6,minutes:40,note:"前日の直しや、3日後・7日後確認を進める中心日です。",mascot:"assets/bunny-happy.png"};
  if(dow===4)return{key:"thu",day:"木曜日",label:"かなり軽め",schedule:"理科 17:00–18:50／社会 19:10–21:00",maxTasks:2,minutes:15,note:"授業が長いので、Aレベルの未直しを優先して少量にします。",mascot:"assets/panda-calm.png"};
  if(dow===5)return{key:"fri",day:"金曜日",label:"最小限",schedule:"最レ算数 17:30–21:10",maxTasks:1,minutes:10,note:"負荷が最も高い日。復習は最優先の1問だけで十分です。",mascot:"assets/panda-worried.png"};
  if(dow===6)return{key:"sat",day:"土曜日",label:"軽め",schedule:"算数1st",maxTasks:3,minutes:20,note:"授業日に合わせ、未直しと定着確認を少量だけ進めます。",mascot:"assets/bunny-calm.png"};
  const nth=sundayOrdinal(date);
  if(nth===2)return{key:"sun-public",day:"日曜日",label:"最小限",schedule:"公開 13:35–16:55／バド 17:30–18:30",maxTasks:1,minutes:10,note:"公開の日はテストを最優先。復習は最重要の1問だけにします。",mascot:"assets/panda-worried.png"};
  if(nth===1||nth===3)return{key:"sun-saile",day:"日曜日",label:"かなり軽め",schedule:"最レ国語 10:00–12:00／バド 17:30–18:30",maxTasks:2,minutes:15,note:"最レ国語のある日は、期限到来の上位2問までに絞ります。",mascot:"assets/bunny-calm.png"};
  return{key:"sun-light",day:"日曜日",label:"軽め",schedule:"バド 17:30–18:30",maxTasks:4,minutes:25,note:"通塾の少ない日曜なので、積み残しを少し回収できます。",mascot:"assets/bunny-happy.png"};
}
function ensureDailyPlan(){
  const today=todayKey(),profile=getLoadProfile();
  let changed=false;
  if(!state.dailyPlan||state.dailyPlan.date!==today){
    state.dailyPlan={date:today,profileKey:profile.key,capacity:profile.maxTasks,minutes:profile.minutes,taskIds:[]};
    changed=true;
  }
  state.dailyPlan.capacity=profile.maxTasks;
  state.dailyPlan.minutes=profile.minutes;
  state.dailyPlan.profileKey=profile.key;
  const validIds=new Set(state.tasks.map(t=>t.id));
  const before=state.dailyPlan.taskIds.length;
  state.dailyPlan.taskIds=state.dailyPlan.taskIds.filter(id=>validIds.has(id));
  if(before!==state.dailyPlan.taskIds.length)changed=true;
  const existing=new Set(state.dailyPlan.taskIds);
  const candidates=state.tasks.filter(t=>isDue(t)&&!existing.has(t.id)).sort((a,b)=>effectivePriority(b)-effectivePriority(a)||String(a.nextReviewDate).localeCompare(String(b.nextReviewDate)));
  while(state.dailyPlan.taskIds.length<profile.maxTasks&&candidates.length){
    state.dailyPlan.taskIds.push(candidates.shift().id);changed=true;
  }
  if(changed)saveState();
  return state.dailyPlan;
}
function plannedTasksForToday(){
  const plan=ensureDailyPlan();
  return plan.taskIds.map(id=>state.tasks.find(t=>t.id===id)).filter(Boolean);
}

function escapeHTML(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]))}
function dueInfo(t){
  if(t.mastered)return{label:"定着",cls:"mastered"};
  if(!t.nextReviewDate)return{label:"日付未設定",cls:""};
  const today=todayKey(),tomorrow=addDaysISO(today,1);
  if(t.nextReviewDate<today)return{label:`${formatJPDate(t.nextReviewDate)}・${overdueDays(t)}日超過`,cls:"overdue"};
  if(t.nextReviewDate===today)return{label:`今日 ${formatJPDate(t.nextReviewDate)}`,cls:"today"};
  if(t.nextReviewDate===tomorrow)return{label:`明日 ${formatJPDate(t.nextReviewDate)}`,cls:"tomorrow"};
  return{label:`次回 ${formatJPDate(t.nextReviewDate)}`,cls:""};
}
function taskCard(t,compact=false){
  const doneToday=state.history.some(h=>h.taskId===t.id&&h.date===todayKey());
  const due=dueInfo(t);
  return `<div class="task card"><div class="task-main"><div class="task-topline"><span class="subject ${t.subject}">${t.subject}</span><span class="level">${t.level}レベル</span><span class="priority">優先 ${effectivePriority(t)}</span><span class="due-badge ${due.cls}">${due.label}</span></div><p class="task-title">${escapeHTML(t.unit)} ${escapeHTML(t.number)}</p><div class="task-meta">${escapeHTML(t.book||"")} ・ ${escapeHTML(t.status)}</div></div>${doneToday?`<span class="done-tag">今日できた</span>`:`<button class="start-btn" data-task="${t.id}">${compact?"やる":"結果"}</button>`}</div>`;
}
function todayCompletedTaskIds(){return new Set(state.history.filter(h=>h.date===todayKey()).map(h=>h.taskId))}
function render(){
  const dueAll=todaysTasks();
  const profile=getLoadProfile();
  const plan=ensureDailyPlan();
  const planned=plannedTasksForToday();
  const completedIds=todayCompletedTaskIds();
  const doneCount=planned.filter(t=>completedIds.has(t.id)).length;
  const total=planned.length;
  const planIds=new Set(plan.taskIds);
  const backlog=dueAll.filter(t=>!planIds.has(t.id)).length;
  document.querySelector("#todayDone").textContent=doneCount;
  document.querySelector("#todayTotal").textContent=total;
  document.querySelector("#todayProgress").style.width=`${total?(doneCount/total)*100:100}%`;
  const overdue=overdueCount();
  document.querySelector("#homeMessage").textContent=total===0?"今日のおすすめ復習はありません。":doneCount===total?"今日のおすすめクエスト、ぜんぶクリア！":backlog>0?`期限到来は ${dueAll.length} 問。今日は上位 ${total} 問に絞ります。`:"上から1問ずつでOK。";
  document.querySelector("#level").textContent=getLevel();
  document.querySelector("#xp").textContent=state.xp;
  document.querySelector("#streak").textContent=state.streak;
  document.querySelector("#roomLevel").textContent=`Lv.${getLevel()}`;
  document.querySelector("#currentDateLabel").textContent=formatJPDate(todayKey(),true);
  document.querySelector("#scheduleToday").textContent=dueAll.length;
  document.querySelector("#scheduleTomorrow").textContent=scheduledCount(addDaysISO(todayKey(),1));
  document.querySelector("#scheduleWeek").textContent=weekCount();
  document.querySelector("#scheduleOverdue").textContent=overdue;
  document.querySelector("#loadDayLabel").textContent=profile.day;
  document.querySelector("#loadLabel").textContent=profile.label;
  document.querySelector("#loadSchedule").textContent=profile.schedule;
  document.querySelector("#loadTarget").textContent=`上限 ${profile.maxTasks}問`;
  document.querySelector("#loadPlanCount").textContent=`${total}問`;
  document.querySelector("#loadMinutes").textContent=`${profile.minutes}分`;
  document.querySelector("#loadBacklog").textContent=`${backlog}問`;
  document.querySelector("#loadNote").textContent=profile.note;
  const mascot=document.querySelector("#dailyLoadMascot");if(mascot)mascot.src=profile.mascot;
  document.querySelector("#topTasks").innerHTML=planned.map(t=>taskCard(t,true)).join("")||`<div class="empty card">今日のおすすめ復習はありません。</div>`;
  const filtered=state.tasks.filter(t=>filterSubject==="すべて"||t.subject===filterSubject).sort((a,b)=>(a.mastered-b.mastered)||String(a.nextReviewDate||"9999").localeCompare(String(b.nextReviewDate||"9999"))||effectivePriority(b)-effectivePriority(a));
  document.querySelector("#allTasks").innerHTML=filtered.map(t=>taskCard(t,false)).join("")||`<div class="empty card">まだ問題がありません。</div>`;
  renderGrowth();renderParent();bindTaskButtons();
}

function growthStats(){
  const hist=Array.isArray(state.history)?state.history:[];
  let bunny=0,panda=0;
  hist.forEach(h=>{
    if(h.result==="excellent"){bunny+=14;panda+=8}
    else if(h.result==="good"){bunny+=10;panda+=8}
    else if(h.result==="hint"){bunny+=6;panda+=12}
    else if(h.result==="wrong"){bunny+=4;panda+=10}
  });
  const mastered=state.tasks.filter(t=>t.mastered).length;
  bunny+=mastered*8;
  panda+=Math.max(0,Number(state.streak||0))*5;
  const perLevel=100;
  const levelOf=p=>Math.floor(p/perLevel)+1;
  const pctOf=p=>Math.min(100,(p%perLevel));
  const nextOf=p=>perLevel-(p%perLevel||0);
  const friendshipPoints=Math.floor((bunny+panda)/2)+Math.max(0,Number(state.streak||0))*6;
  const friendshipLevel=Math.floor(friendshipPoints/120)+1;
  const friendshipPct=Math.min(100,Math.round((friendshipPoints%120)/120*100));
  return{bunny,panda,bunnyLevel:levelOf(bunny),pandaLevel:levelOf(panda),bunnyPct:pctOf(bunny),pandaPct:pctOf(panda),bunnyNext:nextOf(bunny),pandaNext:nextOf(panda),friendshipPoints,friendshipLevel,friendshipPct,friendshipNext:120-(friendshipPoints%120||0),mastered,historyCount:hist.length};
}
function collectionItems(stats=growthStats()){
  return[
    {id:"first",icon:"🌟",name:"はじめの星",detail:"最初の1問を記録",unlocked:stats.historyCount>=1},
    {id:"ribbon",icon:"🎀",name:"3日リボン",detail:"3日れんぞく",unlocked:Number(state.streak||0)>=3},
    {id:"book",icon:"📚",name:"定着ブック",detail:"3問を定着",unlocked:stats.mastered>=3},
    {id:"flower",icon:"🌷",name:"努力のお花",detail:"300 XP",unlocked:Number(state.xp||0)>=300},
    {id:"crown",icon:"👑",name:"7日クラウン",detail:"7日れんぞく",unlocked:Number(state.streak||0)>=7},
    {id:"moon",icon:"🌙",name:"ひみつの月",detail:"10問を定着",unlocked:stats.mastered>=10}
  ];
}
function maybeCelebrateDailyPlan(){
  const plan=ensureDailyPlan();
  if(!plan||!plan.taskIds||plan.taskIds.length===0)return;
  const today=todayKey();
  const completed=todayCompletedTaskIds();
  const allDone=plan.taskIds.every(id=>completed.has(id));
  if(!allDone)return;
  if(!Array.isArray(state.celebratedDates))state.celebratedDates=[];
  if(state.celebratedDates.includes(today))return;
  state.celebratedDates.push(today);
  if(state.celebratedDates.length>60)state.celebratedDates=state.celebratedDates.slice(-60);
  saveState();
  const dlg=document.querySelector("#celebrationDialog");
  if(dlg&&!dlg.open)setTimeout(()=>dlg.showModal(),180);
}

function renderGrowth(){
  const level=getLevel(),stats=growthStats(),items=collectionItems(stats);
  document.querySelector("#bunnyLevel").textContent=`Lv.${stats.bunnyLevel}`;
  document.querySelector("#pandaLevel").textContent=`Lv.${stats.pandaLevel}`;
  document.querySelector("#bunnyProgress").style.width=`${stats.bunnyPct}%`;
  document.querySelector("#pandaProgress").style.width=`${stats.pandaPct}%`;
  document.querySelector("#bunnyNext").textContent=`次のLv.まで あと ${stats.bunnyNext} pt`;
  document.querySelector("#pandaNext").textContent=`次のLv.まで あと ${stats.pandaNext} pt`;
  document.querySelector("#friendshipLevel").textContent=`Lv.${stats.friendshipLevel}`;
  document.querySelector("#friendshipProgress").style.width=`${stats.friendshipPct}%`;
  document.querySelector("#friendshipNext").textContent=`次のなかよしLv.まで あと ${stats.friendshipNext} pt`;
  const hearts=Math.max(1,Math.min(5,Math.ceil(stats.friendshipPct/20)));
  document.querySelector("#friendshipHearts").textContent="♥".repeat(hearts)+"♡".repeat(5-hearts);
  const msg=stats.friendshipLevel>=5?"ふたりは最高の勉強仲間！これからも一緒に進もう。":stats.friendshipLevel>=3?"かなり仲良しになってきたよ。毎日のコツコツが効いてる！":"一問ずつ進めるたびに、ふたりも少しずつ仲良くなるよ。";
  document.querySelector("#friendshipMessage").textContent=msg;

  const unlocked=items.filter(i=>i.unlocked);
  document.querySelector("#collectionCount").textContent=`${unlocked.length}/${items.length}`;
  document.querySelector("#collectionGrid").innerHTML=items.map(i=>`<div class="collection-item ${i.unlocked?"unlocked":"locked"}"><div class="collection-icon">${i.unlocked?i.icon:"🔒"}</div><strong>${i.name}</strong><small>${i.detail}</small></div>`).join("");
  document.querySelector("#roomDecorations").innerHTML=unlocked.map(i=>`<span title="${i.name}">${i.icon}</span>`).join("");

  const next=items.find(i=>!i.unlocked);
  const nextUnlock=document.querySelector("#nextUnlock");
  if(next){
    nextUnlock.innerHTML=`<div class="unlock-row"><div class="unlock-icon">🎁</div><div class="unlock-bar"><strong>${next.name}</strong><div class="progress"><div style="width:${Math.min(92,unlocked.length/items.length*100)}%"></div></div><div class="mini-copy">条件：${next.detail}</div></div></div>`;
  }else{
    nextUnlock.innerHTML=`<div class="unlock-row"><div class="unlock-icon">💝</div><div class="unlock-bar"><strong>ぜんぶ集まった！</strong><div class="mini-copy">すごい！ おへやのごほうびをコンプリート。</div></div></div>`;
  }
  const hasHistory=stats.historyCount>0,aExcellent=state.tasks.some(t=>t.level==="A"&&(t.mastered||t.lastResult==="excellent"));
  const badgeFirst=document.querySelector("#badgeFirst"),badgeStreak=document.querySelector("#badgeStreak"),badgeMaster=document.querySelector("#badgeMaster");
  if(badgeFirst)badgeFirst.classList.toggle("unlocked",hasHistory);
  if(badgeStreak)badgeStreak.classList.toggle("unlocked",state.streak>=3);
  if(badgeMaster)badgeMaster.classList.toggle("unlocked",aExcellent);
}
function renderParent(){
  const redo=state.tasks.filter(t=>!t.mastered&&["直し待ち","理解不十分","翌日確認"].includes(t.status)).length;
  const aPending=state.tasks.filter(t=>t.level==="A"&&!t.mastered).length,mastered=state.tasks.filter(t=>t.mastered).length;
  document.querySelector("#metricRedo").textContent=redo;document.querySelector("#metricA").textContent=aPending;document.querySelector("#metricToday").textContent=plannedTasksForToday().length;document.querySelector("#metricOverdue").textContent=overdueCount();document.querySelector("#metricMastered").textContent=mastered;

  const integrated=Array.isArray(state.attentionUnits)?state.attentionUnits.filter(x=>Number(x.score)>0).slice(0,5):[];
  if(integrated.length){
    document.querySelector("#weakUnits").innerHTML=integrated.map(w=>{
      const subject=escapeHTML(w.subject||"");
      const label=escapeHTML(w.label||w.subcategory||w.category||"未分類");
      const score=Math.round(Number(w.score||0)*10)/10;
      const past=Math.round(Number(w.pastScore||0)*10)/10;
      const current=Math.round(Number(w.currentAdjustment||0)*10)/10;
      const currentText=current>0?`+${current}`:`${current}`;
      const taskCount=Number(w.currentTaskCount||0);
      const parts=[];
      if(past>0)parts.push(`公開テスト ${past}`);
      if(current!==0)parts.push(`現在 ${currentText}`);
      if(taskCount>0)parts.push(`学習中 ${taskCount}問`);
      const reasons=(Array.isArray(w.reasons)?w.reasons:[]).slice(0,2).map(escapeHTML).join("・");
      return `<div class="weak-row"><div><strong>${subject}・${label}</strong><div class="mini-copy">${parts.join(" ／ ")||"現在の学習状況から算出"}</div>${reasons?`<div class="mini-copy weak-reason">${reasons}</div>`:""}</div><div class="weak-score">${score}</div></div>`;
    }).join("");
  }else{
    // Offline / old API fallback: preserve the previous behavior.
    const groups={};state.tasks.filter(t=>!t.mastered).forEach(t=>{const key=`${t.subject}・${t.unit}`;if(!groups[key])groups[key]={count:0,score:0};groups[key].count++;groups[key].score+=effectivePriority(t)});
    const weak=Object.entries(groups).map(([name,v])=>({name,score:Math.round(v.score/v.count),count:v.count})).sort((a,b)=>b.score-a.score).slice(0,5);
    document.querySelector("#weakUnits").innerHTML=weak.length?weak.map(w=>`<div class="weak-row"><div><strong>${escapeHTML(w.name)}</strong><div class="mini-copy">未完了 ${w.count}問</div></div><div class="weak-score">${w.score}</div></div>`).join(""):`<div class="empty">要注意単元はありません。</div>`;
  }
  renderSyncUI();
}
function bindTaskButtons(){document.querySelectorAll("[data-task]").forEach(btn=>{btn.onclick=()=>{activeTaskId=Number(btn.dataset.task);const t=state.tasks.find(x=>x.id===activeTaskId);document.querySelector("#resultTaskTitle").textContent=`${t.subject} ${t.unit} ${t.number}`;document.querySelector("#resultDialog").showModal()}})}

document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));btn.classList.add("active");document.querySelector(`#${btn.dataset.view}`).classList.add("active");window.scrollTo({top:0,behavior:"smooth"})}));
document.querySelectorAll("#subjectFilters .chip").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll("#subjectFilters .chip").forEach(b=>b.classList.remove("active"));btn.classList.add("active");filterSubject=btn.dataset.subject;render()}));
document.querySelectorAll("[data-result]").forEach(btn=>btn.addEventListener("click",e=>{e.preventDefault();applyResult(btn.dataset.result);document.querySelector("#resultDialog").close();maybeCelebrateDailyPlan()}));

function nextReviewForSuccess(t){
  const stage=Number.isInteger(t.reviewStage)?t.reviewStage:-1;
  if(stage<0)return{stage:0,days:1,status:"翌日確認"};
  if(stage===0)return{stage:1,days:3,status:"3日後確認"};
  if(stage===1)return{stage:2,days:7,status:"1週間後確認"};
  if(stage===2)return{stage:3,days:14,status:"2週間後確認"};
  return{stage:4,days:null,status:"定着"};
}
function applyResult(result){
  const t=state.tasks.find(x=>x.id===activeTaskId);if(!t)return;
  const xpMap={excellent:20,good:15,hint:8,wrong:3};
  const today=todayKey(),beforeStage=Number.isInteger(t.reviewStage)?t.reviewStage:-1;
  if(result==="wrong"||result==="hint"){
    t.reviewStage=0;t.nextReviewDate=addDaysISO(today,1);t.status="翌日確認";t.mastered=false;
  }else{
    const next=nextReviewForSuccess(t);
    t.reviewStage=next.stage;t.status=next.status;
    if(next.stage>=4){t.mastered=true;t.nextReviewDate=null}else{t.mastered=false;t.nextReviewDate=addDaysISO(today,next.days)}
  }
  t.lastResult=result;t.lastStudyDate=today;
  const bonus=t.level==="A"&&result==="excellent"?5:0;
  state.xp+=xpMap[result]+bonus;
  const historyEntry={taskId:t.id,date:today,result,xp:xpMap[result]+bonus,nextReviewDate:t.nextReviewDate,reviewStage:t.reviewStage,beforeStage};
  state.history.push(historyEntry);
  updateStreak();saveState();
  pushResultToSheets_(t,historyEntry,beforeStage);
  const nextMsg=t.mastered?"定着！":`次回 ${formatJPDate(t.nextReviewDate)}`;
  showToast(`+${xpMap[result]+bonus} XP！ ${nextMsg}`);render();
}
function updateStreak(){const today=todayKey();if(state.lastStudyDate===today)return;if(!state.lastStudyDate){state.streak=Math.max(1,state.streak)}else{const diff=diffDays(state.lastStudyDate,today);state.streak=diff===1?state.streak+1:1}state.lastStudyDate=today}

const addTaskBtn=document.querySelector("#addTaskBtn");
addTaskBtn.onclick=()=>{const dateInput=document.querySelector("#taskStartDate");if(dateInput)dateInput.value=todayKey();document.querySelector("#taskDialog").showModal()};
document.querySelector("#taskForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(hasSyncConfig()){
    alert("Google Sheets連携中は、問題の追加・教材名・レベルなどの編集はスプレッドシートの「問題台帳」で行ってください。\n入力後、このアプリの「スプレッドシートから同期」を押すと反映されます。");
    return;
  }
  const fd=new FormData(e.currentTarget),newId=Math.max(0,...state.tasks.map(t=>Number(t.id)||0))+1;
  const startDate=fd.get("startDate")||todayKey();
  state.tasks.push({id:newId,subject:fd.get("subject"),book:fd.get("book")||"",unit:fd.get("unit"),level:fd.get("level"),number:fd.get("number"),priority:fd.get("level")==="A"?70:fd.get("level")==="B"?50:30,status:"未着手",nextReviewDate:startDate,reviewStage:-1,mastered:false,lastResult:null,miss:"",lastStudyDate:null});
  saveState();e.currentTarget.reset();document.querySelector("#taskDialog").close();render();showToast(`${formatJPDate(startDate)} に追加しました`);
});

const saveSyncBtn=document.querySelector("#saveSyncBtn");
if(saveSyncBtn)saveSyncBtn.addEventListener("click",()=>{
  const endpoint=(document.querySelector("#syncEndpoint")?.value||"").trim();
  const key=(document.querySelector("#syncKey")?.value||"").trim();
  if(!endpoint||!key){alert("WebアプリURLと連携キーの両方を入力してください。");return}
  try{new URL(endpoint)}catch(e){alert("WebアプリURLの形式を確認してください。");return}
  const old=syncConfig();saveSyncConfig({...old,endpoint,key});renderSyncUI();showToast("連携設定をこのiPhoneに保存しました");
});
const syncNowBtn=document.querySelector("#syncNowBtn");
if(syncNowBtn)syncNowBtn.addEventListener("click",()=>pullFromSheets());

document.querySelector("#installHelpBtn").onclick=()=>document.querySelector("#helpDialog").showModal();
document.querySelector("#exportBtn").onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`study-quest-backup-${todayKey()}.json`;a.click();URL.revokeObjectURL(a.href)};
document.querySelector("#importInput").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{const parsed=JSON.parse(await f.text());if(!parsed.tasks||!Array.isArray(parsed.tasks))throw new Error("invalid");state=migrateState(parsed);saveState();render();showToast("バックアップを読み込みました")}catch(err){alert("バックアップファイルを読み込めませんでした。")}e.target.value=""});
document.querySelector("#resetBtn").onclick=()=>{if(confirm("試作データに戻します。現在の記録は消えます。よろしいですか？")){state=cloneSeed();saveState();render();showToast("試作データに戻しました")}};
function showToast(msg){const el=document.querySelector("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(showToast.t);showToast.t=setTimeout(()=>el.classList.remove("show"),2300)}
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
render();
renderSyncUI();
if(hasSyncConfig())setTimeout(()=>pullFromSheets({silent:true}),350);

// Dialog close buttons must never trigger form validation.
document.querySelectorAll(".close-x").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const dialog=btn.closest("dialog");
    if(dialog) dialog.close();
  });
});

const celebrationOk=document.querySelector("#celebrationOk");if(celebrationOk)celebrationOk.addEventListener("click",()=>{const d=document.querySelector("#celebrationDialog");if(d)d.close()});

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
function normalizeStudyType_(value,t={}){
  const v=String(value||"").trim();
  if(["毎日","宿題","復テ直し","公開・模試直し"].includes(v))return v;
  if(v==="復習テスト直し"||v==="復テ")return "復テ直し";
  if(v==="公開"||v==="模試"||v==="公開・模試")return "公開・模試直し";
  return String(t.book||"")==="公開学力テスト"?"公開・模試直し":"宿題";
}
function normalizeWorkload_(value,fallback=1){
  const n=Number(value);
  if(Number.isFinite(n)&&n>0)return Math.max(1,Math.min(3,Math.round(n)));
  const f=Number(fallback);
  return Number.isFinite(f)&&f>0?Math.max(1,Math.min(3,Math.round(f))):1;
}
function sheetTaskToLocal_(t){
  const studyType=t.studyType??t.learningType??t.taskType??t["学習種別"];
  const workload=t.workload??t.workloadPoints??t.loadPoints??t["負荷ポイント"];
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
    studyType:normalizeStudyType_(studyType,t),
    workload:(workload===null||workload===undefined||String(workload).trim()==="")?null:normalizeWorkload_(workload,1),
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
      appSettings:(data.settings&&typeof data.settings==="object")?data.settings:{},
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
  st.appSettings=(st.appSettings&&typeof st.appSettings==="object")?st.appSettings:{};
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
    x.studyType=normalizeStudyType_(x.studyType,x);
    x.workload=normalizeWorkload_(x.workload,settingNumber_("default_workload",1,st.appSettings));
    if(x.studyType==="毎日"){
      x.mastered=false;
      if(!parseLocalDate(x.nextReviewDate))x.nextReviewDate=todayKey();
      if(x.status==="定着")x.status="翌日確認";
      if(x.reviewStage>=4)x.reviewStage=0;
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

let state=loadState(),activeTaskId=null,questFilter="today";
const PUBLIC_TEST_BOOK="公開学力テスト";
const STUDY_TYPE_ORDER=["毎日","宿題","復テ直し","公開・模試直し"];
const DEFAULT_APP_SETTINGS={
  study_points_mon:8,study_points_tue:3,study_points_wed:12,study_points_thu:3,
  study_points_fri:2,study_points_sat:9,study_points_sun:6,study_points_second_sun:2,
  default_workload:1,auto_rebalance_public:true,
  priority_daily_base:100,priority_homework_base:90,priority_reviewtest_base:80,priority_mock_base:70
};
function settingRaw_(key,settings=null){
  const src=settings&&typeof settings==="object"?settings:(state&&state.appSettings)||{};
  return Object.prototype.hasOwnProperty.call(src,key)?src[key]:DEFAULT_APP_SETTINGS[key];
}
function settingNumber_(key,fallback,settings=null){
  const n=Number(settingRaw_(key,settings));
  return Number.isFinite(n)?n:fallback;
}
function settingBool_(key,fallback=true){
  const v=settingRaw_(key);
  if(typeof v==="boolean")return v;
  if(typeof v==="number")return v!==0;
  if(typeof v==="string"){
    const x=v.trim().toLowerCase();
    if(["true","1","yes","on","はい"].includes(x))return true;
    if(["false","0","no","off","いいえ"].includes(x))return false;
  }
  return fallback;
}
function studyTypeBase_(t){
  const key={"毎日":"priority_daily_base","宿題":"priority_homework_base","復テ直し":"priority_reviewtest_base","公開・模試直し":"priority_mock_base"}[normalizeStudyType_(t.studyType,t)];
  return settingNumber_(key,0);
}
function workloadPoints_(t){return normalizeWorkload_(t&&t.workload,settingNumber_("default_workload",1))}
function getLevel(){return Math.max(1,Math.floor(state.xp/100)+1)}
function isDue(t,iso=todayKey()){return !t.mastered&&parseLocalDate(t.nextReviewDate)&&t.nextReviewDate<=iso}
function todaysTasks(){return state.tasks.filter(t=>isDue(t))}
function scheduledCount(iso){return state.tasks.filter(t=>!t.mastered&&t.nextReviewDate===iso).length}
function isPublicTestTask(t){return String(t&&t.book||"")===PUBLIC_TEST_BOOK}
function hasActualStudyEvidence(t){
  return !!(
    (t&&t.lastStudyDate)||
    String(t&&t.lastResult||"").trim()||
    state.history.some(h=>Number(h.taskId)===Number(t&&t.id))
  );
}
function isUntouchedPublicTask(t){return isPublicTestTask(t)&&!hasActualStudyEvidence(t)}
function overdueCount(){
  const today=todayKey();
  return state.tasks.filter(t=>
    !t.mastered&&
    !isUntouchedPublicTask(t)&&
    parseLocalDate(t.nextReviewDate)&&
    t.nextReviewDate<today
  ).length;
}
function weekCount(){const today=todayKey(),end=addDaysISO(today,7);return state.tasks.filter(t=>!t.mastered&&parseLocalDate(t.nextReviewDate)&&t.nextReviewDate>today&&t.nextReviewDate<=end).length}
function overdueDays(t){
  if(t.mastered||!t.nextReviewDate||isUntouchedPublicTask(t))return 0;
  return Math.max(0,diffDays(t.nextReviewDate,todayKey()));
}
function effectivePriority(t){
  return Math.min(100,Math.max(0,Number(t.priority||0)+Math.min(20,overdueDays(t)*2)));
}

function sundayOrdinal(date){return Math.floor((date.getDate()-1)/7)+1}
function getLoadProfile(date=parseLocalDate(todayKey())||new Date()){
  const dow=date.getDay(),nth=sundayOrdinal(date);
  const cfg={
    1:{key:"mon",day:"月曜日",label:"ふつう",schedule:"ピアノ 16:40–17:30",pointsKey:"study_points_mon",minutes:30,note:"毎日タスクと宿題を優先し、余力で復テ・公開模試の直しを進めます。",mascot:"assets/bunny-cheer.png"},
    2:{key:"tue",day:"火曜日",label:"かなり軽め",schedule:"国語 17:00–18:50／算数2nd 19:10–21:00",pointsKey:"study_points_tue",minutes:15,note:"授業が長い日。毎日タスクと宿題を中心に、ポイント上限までにします。",mascot:"assets/panda-calm.png"},
    3:{key:"wed",day:"水曜日",label:"しっかり回収",schedule:"通塾なし",pointsKey:"study_points_wed",minutes:45,note:"回収日。毎日→宿題→復テ直し→公開・模試直しの順に進めます。",mascot:"assets/bunny-happy.png"},
    4:{key:"thu",day:"木曜日",label:"かなり軽め",schedule:"理科 17:00–18:50／社会 19:10–21:00",pointsKey:"study_points_thu",minutes:15,note:"授業が長いので、優先順位を守ってポイント上限までにします。",mascot:"assets/panda-calm.png"},
    5:{key:"fri",day:"金曜日",label:"最小限",schedule:"最レ算数 17:30–21:10",pointsKey:"study_points_fri",minutes:10,note:"負荷が最も高い日。毎日タスクなど最優先分だけに絞ります。",mascot:"assets/panda-worried.png"},
    6:{key:"sat",day:"土曜日",label:"しっかり回収",schedule:"算数1st",pointsKey:"study_points_sat",minutes:35,note:"回収日。宿題と復テ直しを中心に、余力で公開・模試直しを進めます。",mascot:"assets/bunny-happy.png"}
  };
  if(dow!==0){
    const p=cfg[dow];
    return{...p,maxPoints:Math.max(1,settingNumber_(p.pointsKey,DEFAULT_APP_SETTINGS[p.pointsKey]))};
  }
  if(nth===2)return{key:"sun-public",day:"第2日曜日",label:"最小限",schedule:"公開 13:35–16:55／バド 17:30–18:30",maxPoints:Math.max(1,settingNumber_("study_points_second_sun",2)),minutes:10,note:"公開の日は負荷を抑え、毎日タスクなど最優先分だけにします。",mascot:"assets/panda-worried.png"};
  const saile=nth===1||nth===3;
  return{key:saile?"sun-saile":"sun-light",day:"日曜日",label:saile?"軽め":"ふつう",schedule:saile?"最レ国語 10:00–12:00／バド 17:30–18:30":"バド 17:30–18:30",maxPoints:Math.max(1,settingNumber_("study_points_sun",6)),minutes:saile?25:30,note:"毎日→宿題→復テ直し→公開・模試直しの順に、ポイント上限まで進めます。",mascot:saile?"assets/bunny-calm.png":"assets/bunny-happy.png"};
}
function comparePlanCandidates_(a,b){
  const baseDiff=studyTypeBase_(b)-studyTypeBase_(a);
  if(baseDiff!==0)return baseDiff;
  const typeDiff=STUDY_TYPE_ORDER.indexOf(normalizeStudyType_(a.studyType,a))-STUDY_TYPE_ORDER.indexOf(normalizeStudyType_(b.studyType,b));
  if(typeDiff!==0)return typeDiff;
  return effectivePriority(b)-effectivePriority(a)||String(a.nextReviewDate||"").localeCompare(String(b.nextReviewDate||""))||Number(a.id)-Number(b.id);
}
function planPoints_(tasks){return tasks.reduce((sum,t)=>sum+workloadPoints_(t),0)}
function ensureDailyPlan(){
  const today=todayKey(),profile=getLoadProfile();
  let changed=false;
  const model="points-v1";
  if(!state.dailyPlan||state.dailyPlan.date!==today||state.dailyPlan.model!==model){
    // 同期や再読み込みでプランが作り直されても、今日すでに実施した分は
    // 今日のポイントとして残し、追加クエストが勝手に増えないようにする。
    const doneIds=new Set(state.history.filter(h=>h.date===today).map(h=>Number(h.taskId)));
    const doneToday=state.tasks.filter(t=>doneIds.has(Number(t.id))).sort(comparePlanCandidates_).map(t=>t.id);
    state.dailyPlan={date:today,model,profileKey:profile.key,capacityPoints:profile.maxPoints,minutes:profile.minutes,taskIds:doneToday};
    changed=true;
  }
  state.dailyPlan.capacityPoints=profile.maxPoints;
  state.dailyPlan.minutes=profile.minutes;
  state.dailyPlan.profileKey=profile.key;
  const validIds=new Set(state.tasks.map(t=>t.id));
  const before=state.dailyPlan.taskIds.length;
  state.dailyPlan.taskIds=state.dailyPlan.taskIds.filter(id=>validIds.has(id));
  if(before!==state.dailyPlan.taskIds.length)changed=true;

  const completed=todayCompletedTaskIds();
  const existingTasks=state.dailyPlan.taskIds.map(id=>state.tasks.find(t=>t.id===id)).filter(Boolean);
  let used=planPoints_(existingTasks);
  const existing=new Set(state.dailyPlan.taskIds);
  const candidates=state.tasks.filter(t=>isDue(t)&&!existing.has(t.id)&&!completed.has(t.id)).sort(comparePlanCandidates_);

  // 優先順位を守りつつ、残りポイントに収まる問題を順番に採用する。
  // auto_rebalance_public=TRUE の場合、公開・模試直しは上位3種を配置した後の余剰枠でのみ採用する。
  const autoRebalance=settingBool_("auto_rebalance_public",true);
  const groups=autoRebalance?[candidates.filter(t=>normalizeStudyType_(t.studyType,t)!=="公開・模試直し"),candidates.filter(t=>normalizeStudyType_(t.studyType,t)==="公開・模試直し")]:[candidates];
  groups.forEach(group=>{
    for(const t of group){
      const pts=workloadPoints_(t);
      if(used+pts>profile.maxPoints)continue;
      state.dailyPlan.taskIds.push(t.id);existing.add(t.id);used+=pts;changed=true;
      if(used>=profile.maxPoints)break;
    }
  });
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
  if(!t.nextReviewDate)return{label:isUntouchedPublicTask(t)?"未着手":"日付未設定",cls:isUntouchedPublicTask(t)?"initial":""};
  const today=todayKey(),tomorrow=addDaysISO(today,1);

  // 公開テストから自動登録された未実施問題は、初回学習までは
  // 「復習期限超過」と扱わず、初回予定日として表示する。
  if(isUntouchedPublicTask(t)){
    if(t.nextReviewDate<today)return{label:`初回予定 ${formatJPDate(t.nextReviewDate)}`,cls:"initial"};
    if(t.nextReviewDate===today)return{label:`今日・初回 ${formatJPDate(t.nextReviewDate)}`,cls:"today"};
    if(t.nextReviewDate===tomorrow)return{label:`明日・初回 ${formatJPDate(t.nextReviewDate)}`,cls:"tomorrow"};
    return{label:`初回 ${formatJPDate(t.nextReviewDate)}`,cls:"initial"};
  }

  if(t.nextReviewDate<today)return{label:`${formatJPDate(t.nextReviewDate)}・${overdueDays(t)}日超過`,cls:"overdue"};
  if(t.nextReviewDate===today)return{label:`今日 ${formatJPDate(t.nextReviewDate)}`,cls:"today"};
  if(t.nextReviewDate===tomorrow)return{label:`明日 ${formatJPDate(t.nextReviewDate)}`,cls:"tomorrow"};
  return{label:`次回 ${formatJPDate(t.nextReviewDate)}`,cls:""};
}
function taskCard(t,compact=false){
  const doneToday=state.history.some(h=>h.taskId===t.id&&h.date===todayKey());
  const due=dueInfo(t);
  const isPublic=isPublicTestTask(t);
  const type=normalizeStudyType_(t.studyType,t),pts=workloadPoints_(t);
  const publicBadges=isPublic?`<span class="source-badge public">公開</span>${t.round?`<span class="round-badge">${escapeHTML(t.round)}</span>`:""}`:"";
  const typeBadge=`<span class="study-type-badge" data-type="${escapeHTML(type)}">${escapeHTML(type)}</span><span class="workload-badge">${pts}pt</span>`;
  const meta=(isPublic?[t.status]:[t.book,t.round,t.status]).filter(Boolean).map(escapeHTML).join(" ・ ");
  return `<div class="task card${isPublic?" public-task":""}"><div class="task-main"><div class="task-topline"><span class="subject ${t.subject}">${t.subject}</span>${publicBadges}${typeBadge}<span class="level">${t.level}レベル</span><span class="priority">優先 ${effectivePriority(t)}</span><span class="due-badge ${due.cls}">${due.label}</span></div><p class="task-title">${escapeHTML(t.unit)} ${escapeHTML(t.number)}</p><div class="task-meta">${meta}</div></div>${doneToday?`<span class="done-tag">今日できた</span>`:`<button class="start-btn" data-task="${t.id}">${compact?"やる":"結果"}</button>`}</div>`;
}
function todayCompletedTaskIds(){return new Set(state.history.filter(h=>h.date===todayKey()).map(h=>h.taskId))}
function questFilteredTasks(){
  if(questFilter==="today")return plannedTasksForToday();
  let list=state.tasks.slice();
  if(questFilter==="public")list=list.filter(isPublicTestTask);
  else if(["算数","国語","理科","社会"].includes(questFilter))list=list.filter(t=>t.subject===questFilter);
  return list.sort((a,b)=>(a.mastered-b.mastered)||String(a.nextReviewDate||"9999").localeCompare(String(b.nextReviewDate||"9999"))||effectivePriority(b)-effectivePriority(a));
}
function questFilterLabel(count){
  if(questFilter==="today"){
    const list=plannedTasksForToday();
    return `今日やる ${count}件・合計 ${planPoints_(list)}ポイント`;
  }
  if(questFilter==="public")return `公開学力テストの復習 ${count}問`;
  if(["算数","国語","理科","社会"].includes(questFilter))return `${questFilter} ${count}問`;
  return `全 ${count}問`;
}
function render(){
  const dueAll=todaysTasks();
  const profile=getLoadProfile();
  const plan=ensureDailyPlan();
  const planned=plannedTasksForToday();
  const completedIds=todayCompletedTaskIds();
  const doneCount=planned.filter(t=>completedIds.has(t.id)).length;
  const total=planned.length;
  const donePoints=planned.filter(t=>completedIds.has(t.id)).reduce((sum,t)=>sum+workloadPoints_(t),0);
  const totalPoints=planPoints_(planned);
  const planIds=new Set(plan.taskIds);
  const backlogTasks=dueAll.filter(t=>!planIds.has(t.id));
  const backlog=backlogTasks.length,backlogPoints=planPoints_(backlogTasks);
  document.querySelector("#todayDone").textContent=donePoints;
  document.querySelector("#todayTotal").textContent=totalPoints;
  document.querySelector("#todayProgress").style.width=`${totalPoints?(donePoints/totalPoints)*100:100}%`;
  const overdue=overdueCount();
  document.querySelector("#homeMessage").textContent=total===0?"今日のおすすめクエストはありません。":doneCount===total?"今日のおすすめクエスト、ぜんぶクリア！":backlog>0?`今日は ${totalPoints}/${profile.maxPoints}ポイント。残りは優先順位に従って翌日以降へ回します。`:"毎日 → 宿題 → 復テ直し → 公開・模試直しの順で進めよう。";
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
  document.querySelector("#loadTarget").textContent=`上限 ${profile.maxPoints}pt`;
  document.querySelector("#loadPlanCount").textContent=`${totalPoints}pt・${total}件`;
  document.querySelector("#loadMinutes").textContent=`${profile.minutes}分`;
  document.querySelector("#loadBacklog").textContent=backlog?`${backlogPoints}pt・${backlog}件`:"0pt";
  document.querySelector("#loadNote").textContent=profile.note;
  const mascot=document.querySelector("#dailyLoadMascot");if(mascot)mascot.src=profile.mascot;
  document.querySelector("#topTasks").innerHTML=planned.map(t=>taskCard(t,true)).join("")||`<div class="empty card">今日のおすすめ復習はありません。</div>`;
  const filtered=questFilteredTasks();
  const summary=document.querySelector("#questFilterSummary");if(summary)summary.textContent=questFilterLabel(filtered.length);
  document.querySelector("#allTasks").innerHTML=filtered.map(t=>taskCard(t,false)).join("")||`<div class="empty card">この条件の問題はありません。</div>`;
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
function bindTaskButtons(){document.querySelectorAll("[data-task]").forEach(btn=>{btn.onclick=()=>{activeTaskId=Number(btn.dataset.task);const t=state.tasks.find(x=>x.id===activeTaskId);const round=t.round?` ${t.round}`:"";document.querySelector("#resultTaskTitle").textContent=`${t.subject}${round} ${t.unit} ${t.number}`;document.querySelector("#resultDialog").showModal()}})}

document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));btn.classList.add("active");document.querySelector(`#${btn.dataset.view}`).classList.add("active");window.scrollTo({top:0,behavior:"smooth"})}));
document.querySelectorAll("#questFilters .chip").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("#questFilters .chip").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  questFilter=btn.dataset.filter;
  render();
}));
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
  if(normalizeStudyType_(t.studyType,t)==="毎日"){
    // 毎日タスクは結果にかかわらず翌日に再登場し、定着終了にはしない。
    t.reviewStage=0;t.nextReviewDate=addDaysISO(today,1);t.status="翌日確認";t.mastered=false;
  }else if(result==="wrong"||result==="hint"){
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
    alert("Google Sheets連携中は、問題の追加・教材名・レベルなどの編集はスプレッドシートの「学習・復習台帳」で行ってください。\n入力後、このアプリの「スプレッドシートから同期」を押すと反映されます。");
    return;
  }
  const fd=new FormData(e.currentTarget),newId=Math.max(0,...state.tasks.map(t=>Number(t.id)||0))+1;
  const startDate=fd.get("startDate")||todayKey();
  state.tasks.push({id:newId,subject:fd.get("subject"),book:fd.get("book")||"",unit:fd.get("unit"),level:fd.get("level"),number:fd.get("number"),priority:fd.get("level")==="A"?70:fd.get("level")==="B"?50:30,studyType:"宿題",workload:normalizeWorkload_(settingNumber_("default_workload",1),1),status:"未着手",nextReviewDate:startDate,reviewStage:-1,mastered:false,lastResult:null,miss:"",lastStudyDate:null});
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

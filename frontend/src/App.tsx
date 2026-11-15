import {cleanContext,courseEvents,executionEvents,storedActivity,type ActivityEntry,type EventContext,type EventResult} from "./activity";
import {useRuntimeTasks} from "./runtimeTasks";
import {RuntimeTaskList} from "./components/RuntimeTaskList";
import {ZhidaoPlayerSettingsPanel} from "./components/ZhidaoPlayerSettingsPanel";
import {YuketangContentPanel} from "./components/YuketangContentPanel";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {
  Activity,ArrowLeft,BookOpen,CheckCircle2,ChevronRight,CircleGauge,GraduationCap,
  History,ListChecks,RefreshCw,Search,SlidersHorizontal
} from "lucide-react";
import {initialPlatforms} from "./platforms";
import {invalidateCourseSync,newCourseSyncCheckpoint,shouldStartCourseSync} from "./courseAutoSync";
import ZhidaoQrDialog from "./ZhidaoQrDialog";
import {LegacyPlaybackPanel} from "./components/LegacyPlaybackPanel";
import {YuketangTaskArea} from "./components/YuketangTaskArea";
import {YuketangCourseDetailPanel} from "./components/YuketangCourseDetailPanel";
import {UpdatePanel} from "./components/UpdatePanel";
import {ZhidaoProgressPanel} from "./components/ZhidaoProgressPanel";
import {ZhidaoOfficialPlayerPanel} from "./components/ZhidaoOfficialPlayerPanel";
import {ZhidaoAccountTools} from "./components/ZhidaoAccountTools";
import {ZhidaoCourseDetailPanel} from "./components/ZhidaoCourseDetailPanel";
import {StudyFlowConsentGate} from "./components/StudyFlowConsentGate";
import {ZhidaoActivityPanel} from "./components/ZhidaoActivityPanel";
import {ZhidaoPlayerMonitor} from "./components/ZhidaoPlayerMonitor";
import {ZhidaoLoginPanel} from "./components/ZhidaoMigration";
import {YuketangLoginPanel} from "./components/YuketangLoginPanel";
import {
  fetchStatuses,fetchCoursesFromDesktop,friendlyBridgeError,isDesktop,request
} from "./bridge";
import type {Config,Video,ZhidaoPlayerSettings,YuketangScope} from "./bridge";
import type {Course,Platform,PlatformState} from "./types";
import {AppShell,type Page} from "./ui/AppShell";
import {CollapsibleSection} from "./ui/CollapsibleSection";
import {presentCourse,courseMetric,platformNames,selectedSessionCourse} from "./presentation";
import {CourseCard} from "./ui/CourseCard";
import {PlatformCard} from "./ui/PlatformCard";
import {platformInfo,platformRegistry} from "./ui/registry";
import {useAppearance} from "./ui/useAppearance";
import {ThemeModeSelector} from "./ui/ThemeModeSelector";
import {Switch} from "./ui/Switch";
import {EmptyState} from "./ui/EmptyState";
import {ConfirmDialog} from "./ui/ConfirmDialog";
import {SettingsDialog} from "./ui/SettingsDialog";

const emptyConfiguration:Config={session_id:"",csrf_token:"",classroom_id:"",university_id:"",sign:""};
const ACTIVITY_KEY="studyflow.activity.v1";
const PLATFORM_LOGIN_EXPANDED_KEY="studyflow.platform-login.expanded.v1";
type CourseSyncPhase="idle"|"syncing"|"synced"|"failed";
type PlatformSettingsSection="account"|"parameters"|"advanced";
type CourseSyncFeedback={phase:CourseSyncPhase;error:string};
function readPlatformLoginExpanded():Record<Platform,boolean>{
  try{
    const saved=JSON.parse(window.localStorage.getItem(PLATFORM_LOGIN_EXPANDED_KEY)||"{}");
    return {zhidao:saved.zhidao===true,yuketang:saved.yuketang===true};
  }catch{return {zhidao:false,yuketang:false};}
}

function readActivity():ActivityEntry[]{
  try{
    const value=JSON.parse(window.localStorage.getItem(ACTIVITY_KEY)||"[]");
    return storedActivity(value);
  }catch{return [];}
}

export default function App(){
  const [page,setPage]=useState<Page>("home");
  const {dark,mode,setMode,toggleTheme}=useAppearance();
  const [compactCards,setCompactCards]=useState(()=>{
    try{return window.localStorage.getItem("studyflow.cards.compact")==="true";}
    catch{return false;}
  });
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.cards.compact",String(compactCards));}
    catch{/* Preference remains available for this session. */}
  },[compactCards]);

  const [platforms,setPlatforms]=useState<Record<Platform,PlatformState>>(initialPlatforms);
  const platformsRef=useRef(platforms);
  platformsRef.current=platforms;
  const syncCheckpoints=useRef({zhidao:newCourseSyncCheckpoint(),yuketang:newCourseSyncCheckpoint()});
  const [syncFeedback,setSyncFeedback]=useState<Record<Platform,CourseSyncFeedback>>({
    zhidao:{phase:"idle",error:""},yuketang:{phase:"idle",error:""}
  });
  const [statusCheckRevision,setStatusCheckRevision]=useState(0);
  const [busy,setBusy]=useState("");
  const [selectedCourse,setSelectedCourse]=useState<Course|null>(null);
  const [notice,setNotice]=useState("");
  const [scopeDirty,setScopeDirty]=useState(false);
  const [hasYuketangSession,setHasYuketangSession]=useState(false);
  const [hasYuketangSign,setHasYuketangSign]=useState(false);
  const [signDirty,setSignDirty]=useState(false);
  const configurationRevision=useRef(0);
  const [courseModes,setCourseModes]=useState<Record<string,"official"|"zhs-original">>({});
  const [clearDialogOpen,setClearDialogOpen]=useState(false);
  const [qrOpen,setQrOpen]=useState(false);
  const [videos,setVideos]=useState<Video[]>([]);
  const [config,setConfig]=useState<Config>(emptyConfiguration);
  const [query,setQuery]=useState("");
  const [activity,setActivity]=useState<ActivityEntry[]>(readActivity);
  const [zhidaoPlaybackMode,setZhidaoPlaybackMode]=useState<"official"|"zhs-original">("official");
  const [platformSettingsOpen,setPlatformSettingsOpen]=useState<Platform|null>(null);
  const [platformSettingsSection,setPlatformSettingsSection]=useState<PlatformSettingsSection>("parameters");
  const [courseLogsOpen,setCourseLogsOpen]=useState(false);
  const [platformLoginExpanded,setPlatformLoginExpanded]=useState<Record<Platform,boolean>>(readPlatformLoginExpanded);
  useEffect(()=>{
    try{window.localStorage.setItem(PLATFORM_LOGIN_EXPANDED_KEY,JSON.stringify(platformLoginExpanded));}
    catch{/* Local visual preference only. */}
  },[platformLoginExpanded]);
  const initialized=useRef(false);
  const desktop=isDesktop();
  const [consentAccepted,setConsentAccepted]=useState(!desktop);
  const runtime=useRuntimeTasks(desktop&&consentAccepted);
  useEffect(()=>{
    if(!desktop)return;
    let live=true;
    void request<ZhidaoPlayerSettings>({operation:"zhidao.player.settings.get"})
      .then(settings=>{if(live&&settings.mode)setZhidaoPlaybackMode(settings.mode);})
      .catch(()=>{});
    return ()=>{live=false;};
  },[desktop]);

  async function changeZhidaoPlaybackMode(mode:"official"|"zhs-original"){
    const previous=zhidaoPlaybackMode;
    setZhidaoPlaybackMode(mode);
    try{
      const current=await request<ZhidaoPlayerSettings>({operation:"zhidao.player.settings.get"});
      await request<ZhidaoPlayerSettings>({operation:"zhidao.player.settings.save",settings:{...current,mode}});
    }catch(error){
      setZhidaoPlaybackMode(previous);
      setNotice(friendlyBridgeError(error));
    }
  }

  const recordEvent=useCallback((platform:string,action:string,result:EventResult,detail:string,context:EventContext={})=>{
    const item:ActivityEntry={
      id:Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7),
      at:new Date().toISOString(),platform,action,result,detail,...cleanContext(context)
    };
    setActivity(previous=>{
      const next=[item,...previous].slice(0,100);
      try{window.localStorage.setItem(ACTIVITY_KEY,JSON.stringify(next));}
      catch{/* Activity history is best-effort and contains no credentials. */}
      return next;
    });
  },[]);

  const courses=useMemo(()=>Object.values(platforms).flatMap(item=>item.courses),[platforms]);
  useEffect(()=>{
    if(!selectedCourse)return;
    if(!selectedSessionCourse(courses,selectedCourse))setSelectedCourse(null);
  },[courses,selectedCourse]);
  const verifiedCourses=useMemo(()=>courses.filter(course=>
    !course.stale&&course.progress_evidence==="server_verified"&&typeof course.verified_at==="string"&&
    course.verified_at.length>0&&course.progress_percent!==null
  ),[courses]);
  const learningCount=verifiedCourses.filter(course=>
    course.progress_percent!==null&&course.progress_percent>0&&course.progress_percent<100).length;
  const completedCount=verifiedCourses.filter(course=>
    course.progress_percent!==null&&course.progress_percent>=100).length;


  const refresh=useCallback(async()=>{
    if(!desktop)return;
    setBusy("status");setNotice("");
    try{
      const statuses=await fetchStatuses();
      // A signed-out platform must invalidate older asynchronous course responses.
      for(const status of statuses){
        if(platformInfo(status.platform)&&status.status!=="connected"){
          invalidateCourseSync(syncCheckpoints.current[status.platform]);
        }
      }
      setSyncFeedback(previous=>{
        const next={...previous};
        for(const status of statuses){
          if(platformInfo(status.platform)&&status.status!=="connected"){
            next[status.platform]={phase:"idle",error:""};
          }
        }
        return next;
      });
      setPlatforms(previous=>{
        const next={...previous};
        for(const status of statuses){
          if(!platformInfo(status.platform))continue;
          next[status.platform]={...status,courses:status.status==="connected"&&previous[status.platform].status==="connected"?previous[status.platform].courses:[]};
        }
        return next;
      });
      setStatusCheckRevision(previous=>previous+1);
      recordEvent("系统","检测平台连接","success","已读取平台真实登录状态");
    }catch(error){
      const message=friendlyBridgeError(error);
      setNotice(message);recordEvent("系统","检测平台连接","warning",message);
    }finally{setBusy("");}
  },[desktop,recordEvent]);

  useEffect(()=>{
    if(!consentAccepted||initialized.current)return;
    initialized.current=true;
    void refresh();
    if(desktop){
      const revision=configurationRevision.current;
      void request<YuketangScope>({operation:"yuketang.scope.get"}).then(scope=>{
        if(revision!==configurationRevision.current||typeof scope.classroom_id!=="string"||typeof scope.university_id!=="string")return;
        setConfig(previous=>({...previous,classroom_id:scope.classroom_id,university_id:scope.university_id}));
        setHasYuketangSession(scope.has_session===true);setHasYuketangSign(scope.has_sign===true);
      }).catch(()=>{});
    }
  },[refresh,consentAccepted]);

  function updateVerifiedZhidaoCourse(course:Course) {
    if (course.platform !== "zhidao") return;
    setPlatforms(previous=>({
      ...previous,zhidao:{
        ...previous.zhidao,
        courses:previous.zhidao.courses.map(item=>
          item.platform==="zhidao"&&item.course_id===course.course_id?course:item)
      }
    }));
  }

  const sync=useCallback(async(platform:Platform,manual=false)=>{
    if(!desktop||!consentAccepted||!platformInfo(platform))return;
    if(platformsRef.current[platform].status!=="connected")return;
    const checkpoint=syncCheckpoints.current[platform];
    if(!shouldStartCourseSync(checkpoint,Date.now(),manual))return;
    const name=platformNames[platform]??platform;
    const epoch=checkpoint.epoch;
    checkpoint.inFlight=true;
    checkpoint.lastAttempt=Date.now();
    setSyncFeedback(previous=>({...previous,[platform]:{phase:"syncing",error:""}}));
    if(manual){setBusy(platform);setNotice("");}
    try{
      const list=await fetchCoursesFromDesktop(platform);
      if(checkpoint.epoch!==epoch||platformsRef.current[platform].status!=="connected")return;
      checkpoint.lastSuccess=Date.now();
      setPlatforms(previous=>({...previous,[platform]:{...previous[platform],courses:list}}));
      setSyncFeedback(previous=>({...previous,[platform]:{phase:"synced",error:""}}));
      if(manual)setNotice(name+"已同步 "+list.length+" 门真实课程");
      recordEvent(name,manual?"同步课程":"自动同步课程","success","读取到 "+list.length+" 门真实课程");
    }catch(error){
      if(checkpoint.epoch!==epoch)return;
      const message=friendlyBridgeError(error);
      setSyncFeedback(previous=>({...previous,[platform]:{phase:"failed",error:message}}));
      if(manual)setNotice(message);
      recordEvent(name,manual?"同步课程":"自动同步课程","warning",message);
    }finally{
      if(checkpoint.epoch===epoch)checkpoint.inFlight=false;
      // Even a superseded manual request must release its own button lock.
      if(manual)setBusy(previous=>previous===platform?"":previous);
    }
  },[desktop,consentAccepted,recordEvent]);

  // Startup/status recheck: load both connected platforms. Entering or focusing
  // a platform only refreshes stale data; the gate prevents duplicate requests.
  const lastObservedStatusCheck=useRef(0);
  useEffect(()=>{
    if(!desktop||!consentAccepted)return;
    const newStatusCheck=statusCheckRevision!==lastObservedStatusCheck.current;
    lastObservedStatusCheck.current=statusCheckRevision;
    for(const platform of ["zhidao","yuketang"] as const){
      if(platforms[platform].status!=="connected")continue;
      if(newStatusCheck||page==="platform-"+platform)void sync(platform);
    }
  },[desktop,consentAccepted,page,platforms.zhidao.status,platforms.yuketang.status,statusCheckRevision,sync]);

  useEffect(()=>{
    if(!desktop||!consentAccepted||typeof window.addEventListener!=="function")return;
    const onFocus=()=>{
      const platform=page==="platform-zhidao"?"zhidao":page==="platform-yuketang"?"yuketang":null;
      if(platform&&platformsRef.current[platform].status==="connected")void sync(platform);
    };
    window.addEventListener("focus",onFocus);
    return ()=>window.removeEventListener("focus",onFocus);
  },[desktop,consentAccepted,page,sync]);

  async function clear(){
    setBusy("clear");setNotice("");
    try{
      await request<{cleared:boolean}>({operation:"yuketang.clear"});
      invalidatePlatform("yuketang",true);
      configurationRevision.current++;
      setConfig(emptyConfiguration);setScopeDirty(false);setSignDirty(false);setHasYuketangSession(false);setHasYuketangSign(false);setClearDialogOpen(false);
      await refresh();
      setNotice("已清除学序保存的雨课堂凭据；原版客户端不受影响。");
      recordEvent("雨课堂","退出并清除凭据","success","已清除学序凭据");
    }catch(error){
      const message=friendlyBridgeError(error);
      setNotice(message);recordEvent("雨课堂","清除凭据","warning",message);
    }finally{setBusy("");}
  }

  async function showVideos(){
    setBusy("videos");setNotice("");
    try{
      const result=await request<Video[]>({operation:"videos.list",platform:"yuketang"});
      setVideos(result);
      setNotice(result.length===0?"未读取到章节视频，请检查当前课堂配置。":"已读取 "+result.length+" 条章节视频信息");
      recordEvent("雨课堂","读取章节视频","success","读取到 "+result.length+" 条元数据");
    }catch(error){
      const message=friendlyBridgeError(error);
      setNotice(message);recordEvent("雨课堂","读取章节视频","warning",message);
    }finally{setBusy("");}
  }

  function openPlatformSettings(platform:Platform,section:PlatformSettingsSection="parameters"){
    setCourseLogsOpen(false);
    setPlatformSettingsSection(section);
    setPlatformSettingsOpen(platform);
  }
  function enterCourses(platform:Platform){
    setCourseLogsOpen(false);
    setPlatformSettingsOpen(null);
    setSelectedCourse(null);
    setQuery("");
    setPage(platform==="zhidao"?"platform-zhidao":"platform-yuketang");
  }

  function goPlatform(platform:Platform,openLogin=false){
    enterCourses(platform);
    if(openLogin){
      setPlatformLoginExpanded(previous=>({...previous,[platform]:true}));
      openPlatformSettings(platform,"account");
    }
  }

  function updateConfiguration(field:keyof Config,value:string){
    configurationRevision.current++;
    setConfig(previous=>({...previous,[field]:value}));
    if(field==="classroom_id"||field==="university_id"||field==="sign"){setVideos([]);setScopeDirty(true);}
    if(field==="sign")setSignDirty(true);
  }
  function inspectCourse(course:Course){
    setPlatformSettingsOpen(null);setCourseLogsOpen(false);setSelectedCourse(course);setPage(course.platform==="zhidao"?"platform-zhidao":"platform-yuketang");
  }
  function courseMode(course:Course):"official"|"zhs-original"{
    const active=runtime.tasks.find(task=>task.platform==="zhidao"&&task.courseId===course.course_id&&task.state==="running"&&!task.unavailable);
    return active?.runner==="official"?"official":active?.runner==="zhs"?"zhs-original":courseModes[course.course_id]??zhidaoPlaybackMode;
  }
  function renderPlatformLogin(platform:Platform){
    if(platform==="zhidao")return <><ZhidaoLoginPanel desktop={desktop} busy={Boolean(busy)}
      onOpenNative={()=>setQrOpen(true)}
      onImported={()=>{invalidatePlatform("zhidao");recordEvent("知到","导入 Cookie","success","服务器已确认会话");void refresh();}}/><ZhidaoAccountTools desktop={desktop} dark={dark} onDataChanged={()=>{invalidatePlatform("zhidao",true);void refresh();}}/></>;
    if(platform==="yuketang")return <YuketangLoginPanel config={config}
      desktop={desktop} busy={Boolean(busy)}
      connected={platforms.yuketang.status==="connected"} videos={videos}
      onChange={updateConfiguration}
      onSubmit={()=>void configureFromPanel()} onClear={()=>setClearDialogOpen(true)}
      onShowVideos={()=>void showVideos()}/>;
    return null;
  }

  const renderPlatforms=()=> <section className="sf-platform-section">
    <div className="section-head">
      <h3>学习平台</h3>
      <button className="secondary sf-refresh" type="button" disabled={!desktop||Boolean(busy)}
        onClick={()=>void refresh()}><RefreshCw size={15}/>检测连接</button>
    </div>
    <div className="platform-grid sf-platform-grid">
      {platformRegistry.map(definition=><PlatformCard key={definition.id}
        definition={definition} state={platforms[definition.id]} desktop={desktop}
        busy={Boolean(busy)||syncFeedback[definition.id].phase==="syncing"} expanded={false}
        onSync={()=>void sync(definition.id,true)}
        onToggleLogin={()=>goPlatform(definition.id,true)}
        onEnterCourses={()=>enterCourses(definition.id)}>
        {null}
      </PlatformCard>)}
    </div>
  </section>;

  const renderZhidaoModeSwitch=(course?:Course)=>{
    const mode=course?courseMode(course):zhidaoPlaybackMode;
    const active=course&&runtime.tasks.some(task=>task.courseId===course.course_id&&task.platform==="zhidao"&&task.state==="running");
    const choose=(next:"official"|"zhs-original")=>course?setCourseModes(previous=>({...previous,[course.course_id]:next})):void changeZhidaoPlaybackMode(next);
    return <section className="sf-course-mode-bar" aria-label="知到运行方式">
      <strong>{course?(active?"本次运行方式":"本次启动方式"):"平台默认运行方式"}</strong>
      <div className="sf-zd-mode-options">{(["official","zhs-original"] as const).map(value=><button key={value} disabled={Boolean(active)} aria-pressed={mode===value} className={mode===value?"active":""} onClick={()=>choose(value)}>{value==="official"?"官方播放器":"ZHS 原版"}</button>)}</div>
    </section>;
  };
  const renderPlatformSettings=(platform:Platform)=> <section className="sf-platform-settings-view" aria-label={platformNames[platform]+"参数设置"}>
    <nav className="sf-settings-menu" aria-label="平台设置分类">
      {([["account","账号与连接"],["parameters","播放参数"],["advanced","高级管理"]] as const).map(([section,label])=>
        <button type="button" key={section} aria-pressed={platformSettingsSection===section}
          onClick={()=>setPlatformSettingsSection(section)}>{label}</button>)}
    </nav>
    <div className="sf-platform-settings-heading">
      <h3>{platformNames[platform]} · {platformSettingsSection==="account"?"账号与连接":platformSettingsSection==="parameters"?"播放参数":"高级管理"}</h3>
      <p>这些设置在二级页面中完成，不会替换当前课程的播放和进度视图。</p>
    </div>
    {platformSettingsSection==="account"&&<PlatformCard definition={platformInfo(platform)!} state={platforms[platform]}
      desktop={desktop} busy={Boolean(busy)||syncFeedback[platform].phase==="syncing"} variant="account"
      expanded={platformLoginExpanded[platform]} onSync={()=>void sync(platform,true)}
      onEnterCourses={()=>enterCourses(platform)}
      onToggleLogin={()=>setPlatformLoginExpanded(previous=>({...previous,[platform]:!previous[platform]}))}>
      {renderPlatformLogin(platform)}
    </PlatformCard>}
    {platformSettingsSection!=="account"&&(platform==="zhidao"?<>
      {platformSettingsSection==="parameters"&&<CollapsibleSection id="platform:zhidao:defaults" title="平台默认参数与环境" defaultExpanded={false}>
      {renderZhidaoModeSwitch()}
      <ZhidaoPlayerSettingsPanel desktop={desktop} onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
      <p className="sf-muted">ZHS 原版观看控制已移到课程播放区的独立参数弹窗；与官方播放器默认参数独立。</p>
      </CollapsibleSection>}
      {platformSettingsSection==="advanced"&&<>
      <CollapsibleSection id="platform:zhidao:progress" title="批量进度核验" defaultExpanded={false}>
      <ZhidaoProgressPanel courses={platforms.zhidao.courses} desktop={desktop} connected={platforms.zhidao.status==="connected"}
      onCoursesUpdated={list=>setPlatforms(previous=>({...previous,zhidao:{...previous.zhidao,courses:list}}))}
      onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
      </CollapsibleSection>
      <CollapsibleSection id="platform:zhidao:data" title="本地数据维护" defaultExpanded={false}>
      <ZhidaoAccountTools desktop={desktop} dark={dark} view="data" onDataChanged={()=>{invalidatePlatform("zhidao");void refresh();}}/>
      </CollapsibleSection>

      </>}
    </>:<>
      {platformSettingsSection==="parameters"&&<YuketangTaskArea courses={platforms.yuketang.courses} view="settings"
        desktop={desktop} connected={platforms.yuketang.status==="connected"&&!scopeDirty}
        events={activity} onEvent={(action,result,detail,context)=>recordEvent("雨课堂",action,result,detail,context)}/>}
      {platformSettingsSection==="advanced"&&<>
      <CollapsibleSection id="platform:yuketang:content" title="课堂范围与章节内容" defaultExpanded={false}>
        <YuketangContentPanel config={config} videos={videos} desktop={desktop}
          busy={Boolean(busy)} connected={platforms.yuketang.status==="connected"}
          dirty={scopeDirty} hasSession={hasYuketangSession} hasSign={hasYuketangSign}
          onChange={updateConfiguration} onSave={()=>void saveYuketangScope()}
          onShowVideos={()=>void showVideos()}/>
      </CollapsibleSection>

      </>}
    </>)}
    {platformSettingsSection==="advanced"&&<div className="actions">
      <button className="secondary" type="button" onClick={()=>{setPlatformSettingsOpen(null);setPage("tasks");}}>
        打开学习任务
      </button>
    </div>}
    <button className="text-button" type="button" onClick={()=>{setPlatformSettingsOpen(null);setPage("logs");}}>打开完整日志与诊断记录</button>
  </section>;

  // Platform configuration is a second-level overlay; the live course stays mounted.
  const renderPlatformDetail=(platform:Platform)=>{
    if(!platformInfo(platform))return null;
    const selected=activeSelectedCourse?.platform===platform?activeSelectedCourse:null;
    return <div className="sf-platform-workspace">
      {!selected&&<div className="sf-platform-toolbar actions" role="group" aria-label="平台操作">
        <button type="button" className="secondary" onClick={()=>{
          setPlatformLoginExpanded(previous=>({...previous,[platform]:true}));
          openPlatformSettings(platform,"account");
        }}>账号与连接</button>
        <button type="button" className="secondary sf-platform-settings-action"
          onClick={()=>openPlatformSettings(platform,"parameters")}>
          <SlidersHorizontal size={15}/>参数设置
        </button>
        <button type="button" className="secondary"
          disabled={!desktop||Boolean(busy)||syncFeedback[platform].phase==="syncing"||platforms[platform].status!=="connected"}
          onClick={()=>void sync(platform,true)}>{syncFeedback[platform].phase==="syncing"?"课程同步中…":"同步课程列表"}</button>
      </div>}
      {selected?renderCourseWorkspace(selected):renderCourses(platform)}
      <SettingsDialog open={platformSettingsOpen===platform} dark={dark}
        title={platformNames[platform]+" · 设置"} onClose={()=>setPlatformSettingsOpen(null)}>
        {platformSettingsOpen===platform&&renderPlatformSettings(platform)}
      </SettingsDialog>
    </div>;
  };

  async function configureFromPanel(){
    if(!config.classroom_id.trim()||!config.university_id.trim()){
      setNotice("请先在课堂范围与内容中填写课堂 ID 和学校 ID，再保存会话。");return;
    }
    setBusy("configure");setNotice("");
    try{
      await request<{saved:boolean}>({operation:"yuketang.configure",configuration:config});
      invalidatePlatform("yuketang");
      configurationRevision.current++;
      setHasYuketangSession(true);setHasYuketangSign(Boolean(config.sign));setSignDirty(false);
      setConfig(previous=>({...previous,session_id:"",csrf_token:"",sign:""}));
      recordEvent("雨课堂","保存登录会话","success","凭据已写入 Windows 凭据管理器");
      setScopeDirty(false);
      await refresh();
      setNotice("雨课堂会话已保存；连接验证通过后会自动同步真实课程。");
    }catch(error){
      const message=friendlyBridgeError(error);
      setNotice(message);recordEvent("雨课堂","保存登录会话","warning",message);
    }finally{setBusy("");}
  }

  async function saveYuketangScope(){
    setBusy("scope");setNotice("");
    try{
      const saved=await request<YuketangScope>({operation:"yuketang.scope.save",scope:{
        classroom_id:config.classroom_id,university_id:config.university_id,...(signDirty?{sign:config.sign}:{})
      }});
      configurationRevision.current++;
      invalidatePlatform("yuketang",true);
      setConfig(previous=>({...previous,classroom_id:saved.classroom_id,university_id:saved.university_id,sign:""}));
      setHasYuketangSession(saved.has_session);setHasYuketangSign(saved.has_sign);setSignDirty(false);setScopeDirty(false);
      recordEvent("雨课堂","保存课堂范围","success","已保存课堂范围并保留登录凭据");
      await refresh();setNotice("课堂范围已保存，将自动同步当前课程；也可读取章节视频。");
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy("");}
  }

  function invalidatePlatform(platform:Platform, resetStatus = false){
    invalidateCourseSync(syncCheckpoints.current[platform]);
    setSyncFeedback(previous=>({...previous,[platform]:{phase:"idle",error:""}}));
    setPlatforms(previous=>({...previous,[platform]:resetStatus
      ?initialPlatforms[platform]
      :{...previous[platform],courses:[]}}));
    setSelectedCourse(previous=>previous?.platform===platform?null:previous);
    if(platform==="yuketang")setVideos([]);
  }

  const renderMetrics=()=> <section className="sf-metrics-grid" aria-label="学习统计">
    <article className="sf-metric-card">
      <span className="sf-metric-icon"><BookOpen size={21}/></span>
      <div><small>全部课程</small><strong>{courses.length}<em>门</em></strong></div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon play"><ListChecks size={21}/></span>
      <div><small>部分内容已完成</small><strong>{learningCount}<em>门</em></strong>
</div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon done"><CheckCircle2 size={21}/></span>
      <div><small>内容全部完成</small><strong>{completedCount}<em>门</em></strong>
</div>
    </article>
    <article className="sf-metric-card"><span className="sf-metric-icon progress"><CircleGauge size={21}/></span><div><small>待核验课程</small><strong>{courses.length-verifiedCourses.length}<em>门</em></strong></div></article>
  </section>;

  const renderRecentCourses=()=> <section className="sf-recent-section">
    <div className="section-head">
      <h3>课程概览</h3>
      <button className="text-button" type="button" onClick={()=>setPage("platforms")}>
        查看学习平台<ChevronRight size={16}/>
      </button>
    </div>
    {courses.length===0
      ?<EmptyState icon={BookOpen} title="暂无已同步课程"
          description="先完成平台登录，连接验证通过后会自动同步真实课程。"
          action={<button className="secondary" type="button" onClick={()=>setPage("platforms")}>管理平台登录</button>}/>
      :<div className="sf-recent-list">
        {courses.slice(0,4).map(course=>{
          const data=presentCourse(course);
          return <article className="sf-recent-row" key={course.platform+":"+course.course_id}>
            <div className={"sf-recent-thumb "+course.platform}>
              {course.platform==="zhidao"?<GraduationCap size={27}/>:<BookOpen size={27}/>}
            </div>
            <div className="sf-recent-main">
              <div className="sf-recent-title-line">
                <span className={"sf-course-platform-tag "+course.platform}>{platformNames[course.platform]}</span>
                <strong title={course.title}>{course.title}</strong>
                {data.percent===100&&<span className="sf-completed-tag">内容全部完成</span>}
              </div>
              <div className="sf-recent-progress-label">
                <span>{data.percent===null?"暂无平台核验记录":courseMetric(course).label+"："+data.percent.toFixed(1)+"%"}</span>
                {course.stale&&<span>数据可能已过期</span>}
              </div>
              {data.percent!==null&&<div className="sf-recent-track" role="progressbar"
                aria-label="服务器已核验进度" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={data.percent}><span style={{width:data.percent+"%"}}/></div>}
            </div>
            <button className="secondary sf-recent-detail" type="button"
              onClick={()=>inspectCourse(course)}>
              课程详情
            </button>
          </article>;
        })}
      </div>}
  </section>;

  const renderCourseWorkspace=(course:Course)=>{
    const updateCourses=(list:Course[])=>setPlatforms(previous=>({...previous,[course.platform]:{...previous[course.platform],courses:list}}));
    const scope="course:"+course.platform+":"+course.course_id+":";
    const mode=courseMode(course);
    return <section className="sf-course-workspace" aria-label="课程播放工作台">
      <div className="sf-course-detail-topline">
        <button className="secondary" onClick={()=>enterCourses(course.platform)}><ArrowLeft size={15}/>返回课程列表</button>
        <div className="sf-course-top-actions">
          <button className="secondary" onClick={()=>openPlatformSettings(course.platform,"parameters")}>
            <SlidersHorizontal size={15}/>平台设置
          </button>
          <button className="secondary sf-course-logs-action" type="button"
            onClick={()=>{setPlatformSettingsOpen(null);setCourseLogsOpen(true);}}>日志与诊断</button>
          <button className="secondary" onClick={()=>{setCourseLogsOpen(false);setPage("tasks");}}>运行任务</button>
        </div>
      </div>
      <div className="sf-course-playback-heading">
        <span className="eyebrow">{platformNames[course.platform]} / 播放工作台</span>
        <h2>{course.title}</h2>
        <p>在这里管理播放与查看真实章节；平台账号、默认参数和历史记录不再占用首屏。</p>
      </div>
      <section className="sf-course-playback-stage" aria-label="播放控制">
        <div className="sf-course-player-heading">
          <h3>播放控制</h3>
          <span>运行状态与课程进度分别显示，互不替代</span>
        </div>
        {course.platform==="zhidao"?<>
          {renderZhidaoModeSwitch(course)}
          <div className="sf-runtime-mode" hidden={mode!=="official"}>
            <ZhidaoOfficialPlayerPanel courses={platforms.zhidao.courses} courseId={course.course_id} detailMode desktop={desktop} events={activity} onOpenTasks={()=>setPage("tasks")} onCoursesUpdated={updateCourses}
              onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
          </div>
          <div className="sf-runtime-mode" hidden={mode!=="zhs-original"}>
            <LegacyPlaybackPanel platform="zhidao" dark={dark} courses={platforms.zhidao.courses} courseId={course.course_id} detailMode onCourseVerified={updateVerifiedZhidaoCourse} desktop={desktop} connected={platforms.zhidao.status==="connected"} events={activity} onOpenTasks={()=>setPage("tasks")}
              onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
          </div>
        </>:<>
          <p className="sf-course-scope-note">
            雨课堂原版目前按已保存的课堂范围运行批量任务，<strong>并非只针对「{course.title}」播放</strong>。
            需要切换课堂范围或默认播放参数时，请使用右上方「平台设置」。
          </p>
          <YuketangTaskArea courses={platforms.yuketang.courses} view="player" detailMode
            desktop={desktop} connected={platforms.yuketang.status==="connected"&&!scopeDirty}
            events={activity}
            onEvent={(action,result,detail,context)=>recordEvent("雨课堂",action,result,detail,context)}/>
        </>}
      </section>
      {course.platform==="zhidao"?<>
        <CollapsibleSection id={scope+"chapters"} title="章节与学习记录" defaultExpanded={true}>
          <ZhidaoCourseDetailPanel course={course} desktop={desktop}/>
        </CollapsibleSection>
        <CollapsibleSection id={scope+"server"} title="服务器进度核验" defaultExpanded={false}>
          <ZhidaoProgressPanel courses={platforms.zhidao.courses} desktop={desktop} connected={platforms.zhidao.status==="connected"} onCoursesUpdated={updateCourses} courseId={course.course_id} courseTitle={course.title} detailMode
            onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
        </CollapsibleSection>
      </>:<>
        <CollapsibleSection id={scope+"chapters"} title="章节与学习进度" defaultExpanded={true}>
          <YuketangCourseDetailPanel course={course} desktop={desktop}
            connected={platforms.yuketang.status==="connected"} scopeDirty={scopeDirty}/>
        </CollapsibleSection>
      </>}
      <SettingsDialog open={courseLogsOpen} dark={dark} title={course.title+" · 日志与诊断"}
        onClose={()=>setCourseLogsOpen(false)}>
        <ZhidaoActivityPanel embedded events={courseEvents(activity,course.platform,course.course_id)}/>
        <button className="secondary" type="button" onClick={()=>{setCourseLogsOpen(false);setPage("logs");}}>
          查看平台与历史未归属记录
        </button>
      </SettingsDialog>
    </section>;
  };

  const activeSelectedCourse=selectedSessionCourse(courses,selectedCourse);
  const workspaceCourse=(page==="platform-zhidao"&&activeSelectedCourse?.platform==="zhidao"
    ||page==="platform-yuketang"&&activeSelectedCourse?.platform==="yuketang")
    ?activeSelectedCourse:null;
  const headerPlatform:Platform|null=page==="platform-zhidao"?"zhidao":page==="platform-yuketang"?"yuketang":null;
  const activeMetric=workspaceCourse?courseMetric(workspaceCourse):null;
  const activeCourseProgress=activeMetric?.percent??null;

  const renderCourses=(platform:Platform)=>{
    const platformCourses=platforms[platform].courses;
    const search=query.trim().toLocaleLowerCase();
    const visible=platformCourses.filter(course=>
      course.title.toLocaleLowerCase().includes(search)||
      course.course_id.toLocaleLowerCase().includes(search));
    return <section className="sf-platform-courses" aria-label={platformNames[platform]+"课程列表"}>
      <div className="section-head"><h3>课程列表</h3>
        <span className="sf-muted" role="status" aria-live="polite">
          {syncFeedback[platform].phase==="syncing"?"正在自动读取真实课程…":
           syncFeedback[platform].phase==="failed"?"课程同步失败，可点击刷新重试":
           syncFeedback[platform].phase==="synced"?"已同步真实课程":""}
        </span>
      </div>
      <div className="sf-search-toolbar">
        <label className="sf-search"><Search size={16}/><input type="search"
          placeholder="搜索当前平台课程名称或 ID" value={query} onChange={event=>setQuery(event.target.value)}
          aria-label="搜索当前平台课程"/></label>
      </div>
      {visible.length>0
        ?<div className="course-grid">{visible.map(course=>
          <CourseCard course={course} onInspect={inspectCourse} key={course.platform+":"+course.course_id}/>)}</div>
        :<EmptyState icon={BookOpen}
          title={platformCourses.length>0?"未找到匹配课程":"暂无真实课程数据"}
          description={platformCourses.length>0
            ?"可以更换搜索词。当前只显示"+platformNames[platform]+"课程。"
            :platforms[platform].status==="connected"
              ?syncFeedback[platform].phase==="syncing"?"正在自动读取课程，请稍候。"
              :syncFeedback[platform].phase==="failed"
                ?"读取失败："+syncFeedback[platform].error+"；请点击「同步课程列表」重试。"
                :"已自动尝试读取当前平台课程；如课程尚未出现，可点击「同步课程列表」重试。"
              :"请点击上方「账号与连接」登录当前平台，登录通过后会自动同步真实课程。"}
          action={platforms[platform].status!=="connected"
            ?<button className="secondary" type="button"
              onClick={()=>{
                setPlatformLoginExpanded(previous=>({...previous,[platform]:true}));
                openPlatformSettings(platform,"account");
              }}>
                前往账号登录
              </button>:undefined}/>}
    </section>;
  };

  const renderTasks=()=> <RuntimeTaskList loading={runtime.loading} tasks={runtime.tasks} courses={courses} events={activity} desktop={desktop} onRefresh={runtime.refresh} onInspect={inspectCourse}
    onEvent={(action,result,detail,context)=>recordEvent(context?.runner==="yuketang"?"雨课堂":"知到",action,result,detail,context)}/>;
  const renderRecords=()=> <section className="sf-section">
    <div className="section-head"><h3>执行与核验记录</h3></div>
    <p className="sf-muted">本机最近记录，进程结束不代表平台确认完成。</p>
    {executionEvents(activity).length===0?<EmptyState icon={History} title="暂无执行或核验记录" description="实际启动、停止和核验后会在这里留下记录。"/>:<div className="sf-history-list">{executionEvents(activity).map(event=>{
      const course=event.courseId?courses.find(course=>platformNames[course.platform]===event.platform&&course.course_id===event.courseId&&!course.stale):undefined;
      return <article key={event.id}><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time><div><strong>{event.action}</strong><span>{event.platform}{course?" · "+course.title:event.courseId?" · 历史课程":" · 平台记录"}</span><p>{event.detail}</p></div>{course&&<button className="secondary" onClick={()=>inspectCourse(course)}>查看课程</button>}</article>;
    })}</div>}
  </section>;

  const renderLogs=()=> <section>
    <div className="section-head"><h3>本机操作记录</h3>
      <button className="secondary" type="button" disabled={activity.length===0}
        onClick={()=>{setActivity([]);try{window.localStorage.removeItem(ACTIVITY_KEY);}catch{};}}>
        清空记录
      </button>
    </div>
    {activity.length===0
      ?<EmptyState icon={Activity} title="暂无操作记录" description="平台连接检测、课程同步和任务操作会显示在这里。"/>
      :<div className="sf-log-list">{activity.map(item=><article className="sf-log-row" key={item.id}>
        <span className={"sf-log-indicator "+item.result}/>
        <div className="sf-log-main"><div><strong>{item.action}</strong><span>{item.platform}</span></div>
          <p>{item.detail}</p></div>
        <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
      </article>)}</div>}
  </section>;

  return <>
    <AppShell page={page} onNavigate={next=>{
      if(next==="platform-zhidao"){goPlatform("zhidao");return;}
      if(next==="platform-yuketang"){goPlatform("yuketang");return;}
      setPlatformSettingsOpen(null);
      setSelectedCourse(null);
      setPage(next);
    }}
      dark={dark} onThemeToggle={toggleTheme} onRefresh={()=>void refresh()}
      desktop={desktop} notice={notice} onDismissNotice={()=>setNotice("")}
      compact={compactCards}
      headerTitle={workspaceCourse?"课程详情":undefined}
      currentPlatform={headerPlatform?platformNames[headerPlatform]:undefined}
      currentCourseTitle={workspaceCourse?.title} courseProgress={activeCourseProgress}
      metricLabel={activeMetric?.label} courseEvidence={activeMetric?.evidenceLabel} courseVerifiedAt={activeMetric?.verifiedAt}
      currentPlatformStatus={headerPlatform?platforms[headerPlatform].status:undefined}
      courseOptions={headerPlatform?platforms[headerPlatform].courses.map(course=>({id:course.course_id,title:course.title})):[]}
      onCourseSelect={id=>{const course=courses.find(course=>course.platform===headerPlatform&&course.course_id===id);if(course)inspectCourse(course);}}>
      {page==="home"&&<>{renderPlatforms()}{renderMetrics()}{renderRecentCourses()}</>}
      {page==="tasks"&&renderTasks()}
      {page==="platforms"&&renderPlatforms()}
      {page==="platform-zhidao"&&renderPlatformDetail("zhidao")}
      {page==="platform-yuketang"&&renderPlatformDetail("yuketang")}
      {page==="records"&&renderRecords()}
      {page==="logs"&&renderLogs()}
      {page==="settings"&&<>
        <section className="settings-card">
          <h3>外观</h3>
          <div className="sf-settings-line">
            <div><strong>界面主题</strong></div>
            <ThemeModeSelector mode={mode} onChange={setMode}/>
          </div>
          <div className="sf-settings-line">
            <div><strong>紧凑卡片</strong></div>
            <Switch checked={compactCards} aria-label="紧凑卡片" onChange={setCompactCards}/>
          </div>
        </section>
        <ZhidaoAccountTools desktop={desktop} dark={dark} view="about"/>
      </>}
      <UpdatePanel desktop={desktop&&consentAccepted} visible={page==="settings"} onDownloaded={setNotice}/>
    </AppShell>
    <StudyFlowConsentGate desktop={desktop} dark={dark} onAccepted={()=>setConsentAccepted(true)}/>
    {consentAccepted&&<ZhidaoPlayerMonitor desktop={desktop}
      onCoursesUpdated={list=>setPlatforms(previous=>({...previous,zhidao:{...previous.zhidao,courses:list}}))}
      onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>}
    {qrOpen&&<ZhidaoQrDialog dark={dark} onClose={()=>setQrOpen(false)}
      onVerified={()=>{setQrOpen(false);
        invalidatePlatform("zhidao");
        recordEvent("知到","扫码登录","success","知到服务端验证通过");
        void refresh().then(()=>setNotice(previous=>previous||"知到登录已通过服务端核验。"));}}/>}
    <ConfirmDialog open={clearDialogOpen} dark={dark} danger busy={busy==="clear"}
      title="清除学序保存的雨课堂凭据？"
      description="此操作将清除学序在 Windows 凭据管理器中保存的雨课堂登录会话。"
      warning="需要重新配置会话才能继续读取课程；不会删除原版雨课堂文件或课程记录。"
      confirmLabel="确认清除" cancelLabel="保留登录"
      onConfirm={()=>void clear()} onCancel={()=>setClearDialogOpen(false)}/>
  </>;
}

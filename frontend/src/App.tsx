import {cleanContext,courseEvents,executionEvents,storedActivity,type ActivityEntry,type EventContext,type EventResult} from "./activity";
import {useRuntimeTasks} from "./runtimeTasks";
import {TaskRecoveryPanel} from "./taskRecovery";
import {getYuketangLiveProgress} from "./legacyPlayback";
import {yuketangScopeIssues} from "./yuketangScopeValidation";
import {RuntimeTaskList} from "./components/RuntimeTaskList";
import {ZhidaoPlayerSettingsPanel} from "./components/ZhidaoPlayerSettingsPanel";
import {YuketangContentPanel} from "./components/YuketangContentPanel";
import {XuexitongLoginPanel,XuexitongCourseDetailPanel,XuexitongSettingsPanel} from "./components/XuexitongPanels";
import {XuexitongHeartbeatPanel} from "./components/XuexitongHeartbeatPanel";
import {UCampusLoginPanel} from "./components/UCampusLoginPanel";
import {UCampusCourseDetailPanel} from "./components/UCampusCourseDetailPanel";
import {UCampusProgressVerifyPanel} from "./components/UCampusProgressVerifyPanel";
import {UCampusFabricatedPanel} from "./components/UCampusFabricatedPanel";
import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from "react";
import {
  Activity,ArrowLeft,BookOpen,CheckCircle2,ChevronRight,CircleGauge,GraduationCap,
  History,ListChecks,RefreshCw,Search,SlidersHorizontal
} from "lucide-react";
import {initialPlatforms} from "./platforms";
import {invalidateCourseSync,newCourseSyncCheckpoint,shouldStartCourseSync} from "./courseAutoSync";
import {mergeZhidaoEvidence} from "./progressMerge";
import {useZhidaoAutoVerify} from "./zhidaoAutoVerify";
import ZhidaoQrDialog from "./ZhidaoQrDialog";
import {LegacyPlaybackPanel} from "./components/LegacyPlaybackPanel";
import {MasteryPanel} from "./components/MasteryPanel";
import {QuestionBankSettingsPanel} from "./components/QuestionBankSettingsPanel";
import {MasteryAutoPanel} from "./components/MasteryAutoPanel";
import {YuketangTaskArea} from "./components/YuketangTaskArea";
import {YuketangCourseDetailPanel,resetYuketangVerification,verifyYuketangPlayedVideo,verifyYuketangCourse,getYuketangVideoSummary,subscribeYuketangVerification,getYuketangVerificationRevision} from "./components/YuketangCourseDetailPanel";
import {UpdatePanel} from "./components/UpdatePanel";
import {ReleaseNotesDialog} from "./ui/ReleaseNotesDialog";
import {useReleaseChangelog} from "./useReleaseChangelog";
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
import {presentCourse,courseMetric,platformNames,selectedSessionCourse,platformProgressOverview,type YuketangVideoSummary} from "./presentation";
import {CourseCard} from "./ui/CourseCard";
import {PlatformCard} from "./ui/PlatformCard";
import {platformInfo,platformRegistry} from "./ui/registry";
import {useAppearance} from "./ui/useAppearance";
import {ThemeModeSelector} from "./ui/ThemeModeSelector";
import {Switch} from "./ui/Switch";
import {EmptyState} from "./ui/EmptyState";
import {ConfirmDialog} from "./ui/ConfirmDialog";
import {SettingsDialog} from "./ui/SettingsDialog";
import {GlobalSettingsModal,type GlobalSettingsTab} from "./ui/GlobalSettingsModal";
import {DeveloperSitePanel} from "./ui/DeveloperSitePanel";
import {AboutOpenSourcePanel} from "./ui/AboutOpenSourcePanel";

const emptyConfiguration:Config={session_id:"",csrf_token:"",classroom_id:"",university_id:"",sign:""};
const ACTIVITY_KEY="studyflow.activity.v1";
const PLATFORM_LOGIN_EXPANDED_KEY="studyflow.platform-login.expanded.v1";
type CourseSyncPhase="idle"|"syncing"|"synced"|"failed";
type PlatformSettingsSection="account"|"parameters"|"advanced";
type CourseSyncFeedback={phase:CourseSyncPhase;error:string};
function readPlatformLoginExpanded():Record<Platform,boolean>{
  try{
    const saved=JSON.parse(window.localStorage.getItem(PLATFORM_LOGIN_EXPANDED_KEY)||"{}");
    return {zhidao:saved.zhidao===true,yuketang:saved.yuketang===true,xuexitong:saved.xuexitong===true,ucampus:saved.ucampus===true};
  }catch{return {zhidao:false,yuketang:false,xuexitong:false,ucampus:false};}
}

function readActivity():ActivityEntry[]{
  try{
    const value=JSON.parse(window.localStorage.getItem(ACTIVITY_KEY)||"[]");
    return storedActivity(value);
  }catch{return [];}
}

export default function App({onStartupReady}: {onStartupReady?:()=>void}={}){
  const [page,setPage]=useState<Page>("home");
  const [globalSettingsOpen,setGlobalSettingsOpen]=useState(false);
  const [globalSettingsTab,setGlobalSettingsTab]=useState<GlobalSettingsTab>("general");
  function openGlobalSettings(tab:GlobalSettingsTab="general"){
    setGlobalSettingsTab(tab);
    setGlobalSettingsOpen(true);
  }
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
  const yuketangRevision=useSyncExternalStore(
    subscribeYuketangVerification,getYuketangVerificationRevision,getYuketangVerificationRevision);
  const platformsRef=useRef(platforms);
  platformsRef.current=platforms;
  const syncCheckpoints=useRef({zhidao:newCourseSyncCheckpoint(),yuketang:newCourseSyncCheckpoint(),xuexitong:newCourseSyncCheckpoint(),ucampus:newCourseSyncCheckpoint()});
  const [syncFeedback,setSyncFeedback]=useState<Record<Platform,CourseSyncFeedback>>({
    zhidao:{phase:"idle",error:""},yuketang:{phase:"idle",error:""},xuexitong:{phase:"idle",error:""},ucampus:{phase:"idle",error:""}
  });
  const [statusCheckRevision,setStatusCheckRevision]=useState(0);
  const lastStatusCheckAt=useRef(0);
  const statusRequestRevision=useRef(0);
  const [busy,setBusy]=useState("");
  const [selectedCourse,setSelectedCourse]=useState<Course|null>(null);
  // One monitored course across the entire app, with explicit per-course off/on choices.
  // No session credentials or polling preferences are persisted on disk.
  const [autoVerify,setAutoVerify]=useState<{
    courseId:string;enabled:boolean;preferences:Record<string,boolean>;
  }>({courseId:"",enabled:false,preferences:{}});
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
  // A course has ONE visible settings action. ZHS uses its course-scoped
  // editor; official/YKT/XXT use the platform preset view.
  const [zhsCourseSettingsOpen,setZhsCourseSettingsOpen]=useState(false);
  const [platformSettingsSection,setPlatformSettingsSection]=useState<PlatformSettingsSection>("parameters");
  const [yuketangScopeJumpRequest,setYuketangScopeJumpRequest]=useState(0);
  const [courseLogsOpen,setCourseLogsOpen]=useState(false);
  // Open a prominent mastery task page without mounting a second auto worker.
  // Keep the course identity so switching courses never opens the wrong panel.
  const [masteryDialogCourseKey,setMasteryDialogCourseKey]=useState<string|null>(null);
  const [platformLoginExpanded,setPlatformLoginExpanded]=useState<Record<Platform,boolean>>(readPlatformLoginExpanded);
  useEffect(()=>{
    try{window.localStorage.setItem(PLATFORM_LOGIN_EXPANDED_KEY,JSON.stringify(platformLoginExpanded));}
    catch{/* Local visual preference only. */}
  },[platformLoginExpanded]);
  const initialized=useRef(false);
  const desktop=isDesktop();
  const [consentAccepted,setConsentAccepted]=useState(!desktop);
  const runtime=useRuntimeTasks(desktop&&consentAccepted);
  // Restore only an explicitly enabled read-only U校园 progress check after
  // StudyFlow restarts. The backend persists a scoped checkpoint and rate-limits
  // GET requests; this never resumes fabricated playback or sends heartbeats.
  useEffect(()=>{
    if(!desktop||!consentAccepted)return;
    let live=true;
    let inFlight=false;
    const tick=async()=>{
      if(!live||inFlight)return;
      inFlight=true;
      try{await request({operation:"ucampus.monitor.tick"});}
      catch{/* Fail closed; do not infer progress from a failed readback. */}
      finally{inFlight=false;}
    };
    void tick();
    const timer=typeof window.setInterval==="function"
      ?window.setInterval(()=>void tick(),90_000):null;
    return()=>{live=false;if(timer!==null&&typeof window.clearInterval==="function")
      window.clearInterval(timer);};
  },[desktop,consentAccepted]);

  const releaseChangelog=useReleaseChangelog(desktop,consentAccepted);
  const yuketangRun=runtime.tasks.find(task=>task.runner==="yuketang"&&!task.unavailable);
  const yuketangRunId=yuketangRun?.runId??"";
  const yuketangRunState=yuketangRun?.state??"idle";
  const yuketangCourseId=platforms.yuketang.courses.find(course=>!course.stale)?.course_id??"";
  const playbackObservations=useRef({
    runId:"",seen:new Map<string,{at:number;signature:string;finalChecks:number}>()
  });

  // Playback is observed at app scope, so navigating away does not break sync.
  // Real progress is verified through the bounded single-video server read.
  // Never count the legacy executor's local percentage as a confirmed result.
  useEffect(()=>{
    if(!desktop||!consentAccepted||platforms.yuketang.status!=="connected"||
       scopeDirty||!yuketangRunId||!yuketangCourseId||
       !["running","exited","stopped"].includes(yuketangRunState))return;
    if(playbackObservations.current.runId!==yuketangRunId){
      playbackObservations.current={runId:yuketangRunId,seen:new Map()};
    }
    const observed=playbackObservations.current.seen;
    let live=true;
    let inFlight=false;
    const check=async()=>{
      if(!live||inFlight)return;
      inFlight=true;
      try{
        const snapshot=await getYuketangLiveProgress(yuketangRunId);
        if(!live||!snapshot.available||!Array.isArray(snapshot.video_tasks))return;
        const now=Date.now();
        for(const video of snapshot.video_tasks){
          if(!video||!video.name||!Number.isInteger(video.video_index)||
             !["watching","completed","skipped"].includes(video.state))continue;
          const key=video.video_index+":"+video.name;
          const signature=[video.state,video.server_source,video.server_percent].join(":");
          const last=observed.get(key);
          // After a completed/skipped worker, allow up to three bounded server
          // checks. The server may publish the final rate after the worker exits.
          // This is one-video read-only verification, never another full scan.
          const terminal=video.state==="completed"||video.state==="skipped";
          if(terminal&&(last?.finalChecks??0)>=3)continue;
          const final=terminal&&last?.signature!==signature;
          if(!final&&last&&now-last.at<30_000)continue;
          observed.set(key,{at:now,signature,
            finalChecks:terminal?(last?.finalChecks??0)+1:0});
          void verifyYuketangPlayedVideo(yuketangCourseId,video.name,{
            desktop:true,connected:true,scopeDirty:false
          },final);
        }
      }catch{
        // No progress update is displayed without a successful server query.
      }finally{inFlight=false;}
    };
    void check();
    // Keep the single-video observer briefly after a task exits so delayed
    // server confirmation is not stranded at the first post-playback result.
    const timer=window.setInterval(()=>void check(),10_000);
    const expiry=yuketangRunState==="running"?null
      :window.setTimeout(()=>window.clearInterval(timer),65_000);
    return ()=>{
      live=false;
      window.clearInterval(timer);
      if(expiry!==null)window.clearTimeout(expiry);
    };
  },[desktop,consentAccepted,platforms.yuketang.status,scopeDirty,
     yuketangCourseId,yuketangRunId,yuketangRunState]);
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

  const autoVerifyError=useZhidaoAutoVerify({
    desktop:desktop&&consentAccepted,
    connected:platforms.zhidao.status==="connected"&&platforms.zhidao.courses.some(
      item=>item.course_id===autoVerify.courseId&&!item.stale),
    enabled:autoVerify.enabled,
    courseId:autoVerify.courseId,
    onSnapshot:snapshot=>setPlatforms(previous=>({
      ...previous,zhidao:{...previous.zhidao,
        courses:mergeZhidaoEvidence(previous.zhidao.courses,snapshot.courses)}
    }))
  });

  function configureAutoVerify(courseId:string,enabled:boolean){
    if(!courseId)return;
    setAutoVerify(previous=>({
      courseId,enabled,preferences:{...previous.preferences,[courseId]:enabled}
    }));
  }

  const courses=useMemo(()=>Object.values(platforms).flatMap(item=>item.courses),[platforms]);
  const yuketangSummaries=useMemo(()=>{
    const results:Record<string,YuketangVideoSummary>={};
    for(const course of platforms.yuketang.courses){
      const summary=getYuketangVideoSummary(course.course_id);
      if(summary)results[course.course_id]=summary;
    }
    return results;
  },[platforms.yuketang.courses,yuketangRevision]);
  // First visit verifies the real classroom videos even without selecting a course.
  // Subsequent visits share the in-session cache rather than rescanning.
  useEffect(()=>{
    if(page!=="platform-yuketang"||!desktop||!consentAccepted||
       platforms.yuketang.status!=="connected"||scopeDirty||
       syncFeedback.yuketang.phase==="syncing")return;
    for(const course of platforms.yuketang.courses){
      if(!course.stale)void verifyYuketangCourse(course.course_id,{desktop,connected:true,scopeDirty:false});
    }
  },[page,desktop,consentAccepted,platforms.yuketang.status,
    platforms.yuketang.courses,scopeDirty,syncFeedback.yuketang.phase]);
  useEffect(()=>{
    if(!selectedCourse)return;
    if(!selectedSessionCourse(courses,selectedCourse))setSelectedCourse(null);
  },[courses,selectedCourse]);
  const verifiedCourses=useMemo(()=>courses.filter(course=>
    !course.stale&&(course.platform==="yuketang"
      ?courseMetric(course,yuketangSummaries[course.course_id]).percent!==null
      :course.progress_evidence==="server_verified"&&typeof course.verified_at==="string"&&
       course.verified_at.length>0&&course.progress_percent!==null)
  ),[courses,yuketangSummaries]);
  const learningCount=verifiedCourses.filter(course=>
    course.progress_percent!==null&&course.progress_percent>0&&course.progress_percent<100).length;
  const completedCount=verifiedCourses.filter(course=>
    course.progress_percent!==null&&course.progress_percent>=100).length;


  const refresh=useCallback(async()=>{
    if(!desktop)return;
    const requestRevision=++statusRequestRevision.current;
    lastStatusCheckAt.current=Date.now();
    setBusy("status");setNotice("");
    try{
      const statuses=await fetchStatuses();
      if(requestRevision!==statusRequestRevision.current)return;
      // A signed-out platform must invalidate older asynchronous course responses.
      for(const status of statuses){
        if(platformInfo(status.platform)&&status.status!=="connected"){
          invalidateCourseSync(syncCheckpoints.current[status.platform]);
          if(status.platform==="yuketang")resetYuketangVerification();
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
      if(requestRevision!==statusRequestRevision.current)return;
      const message=friendlyBridgeError(error);
      setNotice(message);recordEvent("系统","检测平台连接","warning",message);
    }finally{
      if(requestRevision===statusRequestRevision.current)setBusy("");
    }
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
        courses:mergeZhidaoEvidence(previous.zhidao.courses,previous.zhidao.courses.map(item=>
          item.platform==="zhidao"&&item.course_id===course.course_id?course:item))
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
      setPlatforms(previous=>({...previous,[platform]:{...previous[platform],
        courses:platform==="zhidao"?mergeZhidaoEvidence(previous.zhidao.courses,list):list}}));
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
    for(const platform of ["zhidao","yuketang","xuexitong","ucampus"] as const){
      if(platforms[platform].status!=="connected")continue;
      if(newStatusCheck||page==="platform-"+platform)void sync(platform);
    }
  },[desktop,consentAccepted,page,platforms.zhidao.status,platforms.yuketang.status,platforms.xuexitong.status,platforms.ucampus.status,statusCheckRevision,sync]);

  // Laptop sleep/overnight use may preserve an old UI "connected" flag.
  // Recheck the real session on wake before relying on cached course progress.
  // This does not start playback, mutate login data or submit study records.
  useEffect(()=>{
    if(!desktop||!consentAccepted||typeof window.addEventListener!=="function")return;
    const onWake=()=>{
      if(Date.now()-lastStatusCheckAt.current>=5*60*1000)void refresh();
    };
    window.addEventListener("focus",onWake);
    return ()=>window.removeEventListener("focus",onWake);
  },[desktop,consentAccepted,refresh]);

  useEffect(()=>{
    if(!desktop||!consentAccepted||typeof window.addEventListener!=="function")return;
    const onFocus=()=>{
      const platform=page==="platform-zhidao"?"zhidao":page==="platform-yuketang"?"yuketang":page==="platform-xuexitong"?"xuexitong":page==="platform-ucampus"?"ucampus":null;
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
    setZhsCourseSettingsOpen(false);
    setYuketangScopeJumpRequest(0);
    setCourseLogsOpen(false);
    setPlatformSettingsSection(section);
    setPlatformSettingsOpen(platform);
  }
  function openYuketangScopeFields(){
    // Preserve the in-memory session fields while navigating inside the modal.
    setPlatformSettingsOpen("yuketang");
    setPlatformSettingsSection("advanced");
    setYuketangScopeJumpRequest(previous=>previous+1);
  }
  function enterCourses(platform:Platform){
    setZhsCourseSettingsOpen(false);
    setCourseLogsOpen(false);
    setPlatformSettingsOpen(null);
    setSelectedCourse(null);
    setQuery("");
    setPage("platform-"+platform as Page);
  }

  function goPlatform(platform:Platform,openLogin=false){
    enterCourses(platform);
    if(openLogin){
      setPlatformLoginExpanded(previous=>({...previous,[platform]:true}));
      openPlatformSettings(platform,"account");
    }
  }

  function updateConfiguration(field:keyof Config,value:string){
    resetYuketangVerification();
    configurationRevision.current++;
    setConfig(previous=>({...previous,[field]:value}));
    if(field==="classroom_id"||field==="university_id"||field==="sign"){setVideos([]);setScopeDirty(true);}
    if(field==="sign")setSignDirty(true);
  }
  function inspectCourse(course:Course){
    if(course.platform==="zhidao"){
      setAutoVerify(previous=>previous.courseId===course.course_id?previous:{
        ...previous,courseId:course.course_id,
        enabled:previous.preferences[course.course_id]??true
      });
    }
    setZhsCourseSettingsOpen(false);
    setPlatformSettingsOpen(null);setCourseLogsOpen(false);setSelectedCourse(course);setPage("platform-"+course.platform as Page);
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
      connected={platforms.yuketang.status==="connected"}
      onChange={updateConfiguration}
      onSubmit={()=>void configureFromPanel()} onOpenScope={openYuketangScopeFields}
      onClear={()=>setClearDialogOpen(true)}/>;
    if(platform==="xuexitong")return <XuexitongLoginPanel desktop={desktop} onConnected={()=>{invalidatePlatform("xuexitong",true);void refresh();}}/>;
    if(platform==="ucampus")return <UCampusLoginPanel desktop={desktop} onChanged={()=>{invalidatePlatform("ucampus",true);void refresh();}}/>;
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
    const choose=(next:"official"|"zhs-original")=>{
      setZhsCourseSettingsOpen(false);
      if(course)setCourseModes(previous=>({...previous,[course.course_id]:next}));
      else void changeZhidaoPlaybackMode(next);
    };
    return <section className="sf-course-mode-bar" aria-label="知到运行方式">
      <strong>{course?"运行方式":"默认方式"}</strong>
      <div className="sf-zd-mode-options">{(["official","zhs-original"] as const).map(value=><button key={value} disabled={Boolean(active)} aria-pressed={mode===value} className={mode===value?"active":""} onClick={()=>choose(value)}>{value==="official"?"官方播放器":"ZHS 原版"}</button>)}</div>
    </section>;
  };
  const renderSettingsNavigation=(platform:Platform)=>
    <nav className="sf-settings-menu" aria-label="平台设置分类">
      {([["account","账号与连接"],["parameters",platform==="xuexitong"?"运行参数预设":platform==="ucampus"?"只读接口设置":"播放参数"],["advanced","高级管理"]] as const).map(([section,label])=>
        <button type="button" key={section} aria-pressed={platformSettingsSection===section}
          onClick={()=>{setYuketangScopeJumpRequest(0);setPlatformSettingsSection(section);}}>{label}</button>)}
    </nav>;
  const renderPlatformSettings=(platform:Platform)=> <section className="sf-platform-settings-view" aria-label={platformNames[platform]+"参数设置"}>
    {platformSettingsSection==="account"&&<PlatformCard definition={platformInfo(platform)!} state={platforms[platform]}
      desktop={desktop} busy={Boolean(busy)||syncFeedback[platform].phase==="syncing"} variant="account"
      expanded={platformLoginExpanded[platform]} onSync={()=>void sync(platform,true)}
      onEnterCourses={()=>enterCourses(platform)}
      onToggleLogin={()=>setPlatformLoginExpanded(previous=>({...previous,[platform]:!previous[platform]}))}>
      {renderPlatformLogin(platform)}
    </PlatformCard>}
    {platformSettingsSection!=="account"&&(platform==="zhidao"?<>
      {platformSettingsSection==="parameters"&&<CollapsibleSection id="platform:zhidao:defaults" title="平台默认参数与环境" defaultExpanded={true}>
      {renderZhidaoModeSwitch()}
      <ZhidaoPlayerSettingsPanel desktop={desktop} onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
      <p className="sf-muted">ZHS 当前课程参数请在课程页顶部「参数设置」中调整；此处仅管理官方播放器的默认参数。</p>
      </CollapsibleSection>}
      {platformSettingsSection==="advanced"&&<>
      <CollapsibleSection id="platform:zhidao:progress" title="进度核验" defaultExpanded={true}>
      <ZhidaoProgressPanel courses={platforms.zhidao.courses} desktop={desktop} connected={platforms.zhidao.status==="connected"}
      autoVerifyCourseId={autoVerify.courseId} autoVerifyEnabled={autoVerify.enabled} autoVerifyError={autoVerifyError}
      onAutoVerifyChange={configureAutoVerify}
      onCoursesUpdated={list=>setPlatforms(previous=>({...previous,zhidao:{...previous.zhidao,courses:mergeZhidaoEvidence(previous.zhidao.courses,list)}}))}
      onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
      </CollapsibleSection>
      <CollapsibleSection id="platform:zhidao:data" title="本地数据维护" defaultExpanded={false}>
      <ZhidaoAccountTools desktop={desktop} dark={dark} view="data" onDataChanged={()=>{invalidatePlatform("zhidao");void refresh();}}/>
      </CollapsibleSection>

      </>}
    </>:platform==="xuexitong"?<>
      {platformSettingsSection==="parameters"&&<XuexitongSettingsPanel desktop={desktop}/>}
      {platformSettingsSection==="advanced"&&<p className="sf-muted">已保存的登录会话使用 Windows 凭据管理器；可在「账号与连接」清除。</p>}
    </>:platform==="ucampus"?<>
      {platformSettingsSection==="parameters"&&<p className="sf-muted">U校园5.0 目前只读接入：请在「账号与连接」配置已经核验的真实课程接口。尚未实现课程行为写入、播放、章节与进度核验。</p>}
      {platformSettingsSection==="advanced"&&<p className="sf-muted">U校园会话保存在 Windows 凭据管理器。未确认的学习进度不会填充到课程进度条。</p>}
    </>:<>
      {platformSettingsSection==="parameters"&&<YuketangTaskArea courses={platforms.yuketang.courses} view="settings"
        desktop={desktop} connected={platforms.yuketang.status==="connected"&&!scopeDirty}
        events={activity} onEvent={(action,result,detail,context)=>recordEvent("雨课堂",action,result,detail,context)}/>}
      {platformSettingsSection==="advanced"&&<>
      <CollapsibleSection id="platform:yuketang:content" title="课堂范围与章节内容" defaultExpanded={false}
        expandRequest={yuketangScopeJumpRequest}>
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
        navigation={renderSettingsNavigation(platform)} contentKey={platformSettingsSection}
        title={platformNames[platform]+" · 设置"} onClose={()=>setPlatformSettingsOpen(null)}
        footer={<div className="actions">
          <button className="secondary" type="button"
            onClick={()=>{setPlatformSettingsOpen(null);setPage("logs");}}>日志与诊断</button>
          <button className="secondary" type="button"
            onClick={()=>setPlatformSettingsOpen(null)}>关闭</button>
        </div>}>
        {platformSettingsOpen===platform&&renderPlatformSettings(platform)}
      </SettingsDialog>
    </div>;
  };

  async function configureFromPanel(){
    const issues=yuketangScopeIssues(config);
    if(issues.length){
      setNotice("雨课堂会话尚未保存："+issues.join("；")+"。请先打开高级管理中的课堂范围与章节内容。");return;
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
    if(platform==="yuketang")resetYuketangVerification();
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
          const data=presentCourse(course,course.platform==="yuketang"?yuketangSummaries[course.course_id]:undefined);
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
                <span>{data.percent===null?"暂无平台核验记录":courseMetric(course,course.platform==="yuketang"?yuketangSummaries[course.course_id]:undefined).label+"："+data.percent.toFixed(1)+"%"}</span>
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
    const updateCourses=(list:Course[])=>setPlatforms(previous=>({...previous,[course.platform]:{
      ...previous[course.platform],courses:course.platform==="zhidao"
        ?mergeZhidaoEvidence(previous.zhidao.courses,list):list}}));
    const scope="course:"+course.platform+":"+course.course_id+":";
    const mode=courseMode(course);
    const catalogOnly=course.platform==="xuexitong"||course.platform==="ucampus";
    return <section className="sf-course-workspace" aria-label={catalogOnly?"课程与任务工作台":"课程播放工作台"}>
      <div className="sf-course-detail-topline">
        <button className="secondary" onClick={()=>enterCourses(course.platform)}><ArrowLeft size={15}/>返回课程列表</button>
        <div className="sf-course-top-actions">
          {course.platform==="zhidao"&&<button
            className="secondary sf-course-mastery-action" type="button"
            onClick={()=>setMasteryDialogCourseKey(course.course_id)}>
            <ListChecks size={15}/>全自动掌握度
          </button>}
          <button className="secondary sf-course-settings-action" type="button"
            onClick={()=>{
              setCourseLogsOpen(false);
              if(course.platform==="zhidao"&&mode==="zhs-original"){
                setPlatformSettingsOpen(null);
                setZhsCourseSettingsOpen(true);
              }else{
                openPlatformSettings(course.platform,"parameters");
              }
            }}>
            <SlidersHorizontal size={15}/>参数设置
          </button>
          <button className="secondary sf-course-logs-action" type="button"
            onClick={()=>{setPlatformSettingsOpen(null);setCourseLogsOpen(true);}}>日志与诊断</button>
          {!catalogOnly&&<button className="secondary" onClick={()=>{setCourseLogsOpen(false);setPage("tasks");}}>运行任务</button>}
        </div>
      </div>
      <div className="sf-course-playback-heading">
        <span className="eyebrow">{platformNames[course.platform]}</span>
        <h2>{course.title}</h2>
      </div>
      <section className="sf-course-playback-stage" aria-label={catalogOnly?"任务模块状态":"播放控制"}>
        <div className="sf-course-player-heading">
          <h3>{catalogOnly?"任务模块状态":"播放控制"}</h3>
          <span className="sf-visually-hidden">{catalogOnly?"本机执行记录与服务端核验分开展示":"运行状态与课程进度分别显示，互不替代"}</span>
        </div>
        {course.platform==="zhidao"?<>
          {renderZhidaoModeSwitch(course)}
          <div className="sf-runtime-mode" hidden={mode!=="official"}>
            <ZhidaoOfficialPlayerPanel key={"official:"+course.course_id} courses={platforms.zhidao.courses} courseId={course.course_id} detailMode desktop={desktop} events={activity} onOpenTasks={()=>setPage("tasks")}
              onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
          </div>
          <div className="sf-runtime-mode" hidden={mode!=="zhs-original"}>
            <LegacyPlaybackPanel platform="zhidao" key={"zhs:"+course.course_id} dark={dark} courses={platforms.zhidao.courses} courseId={course.course_id} detailMode
              courseSettingsOpen={zhsCourseSettingsOpen&&mode==="zhs-original"}
              onCourseSettingsClose={()=>setZhsCourseSettingsOpen(false)}
              onCourseVerified={updateVerifiedZhidaoCourse} desktop={desktop} connected={platforms.zhidao.status==="connected"} events={activity} onOpenTasks={()=>setPage("tasks")}
              onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
          </div>
        </>:course.platform==="ucampus"?<>
          <UCampusProgressVerifyPanel course={course} desktop={desktop}/>
          <UCampusFabricatedPanel course={course} desktop={desktop}/>
        </>:course.platform==="xuexitong"?<>
          <XuexitongHeartbeatPanel course={course} desktop={desktop}/>
        </>:<>
          <div className="sf-course-scope-note" role="note">
            <span>按已保存的课堂范围执行，可能包含其他课程。</span>
            <details>
              <summary>范围说明</summary>
              <p>雨课堂原版目前按已保存的课堂范围运行批量任务，<strong>并非只针对「{course.title}」播放</strong>。需要切换课堂范围或默认参数时，请使用课程页顶部「参数设置」。</p>
            </details>
          </div>
          <YuketangTaskArea courses={platforms.yuketang.courses} view="player" detailMode
            desktop={desktop} connected={platforms.yuketang.status==="connected"&&!scopeDirty}
            events={activity}
            onEvent={(action,result,detail,context)=>recordEvent("雨课堂",action,result,detail,context)}/>
        </>}
      </section>
      {course.platform==="zhidao"?<>
        <CollapsibleSection id={scope+"chapters"} title="章节与学习记录" defaultExpanded={true}>
          <ZhidaoCourseDetailPanel key={"chapters:"+course.course_id} course={course} desktop={desktop}
            onCoursesUpdated={updateCourses}
            autoVerifyActive={autoVerify.enabled&&autoVerify.courseId===course.course_id&&
              platforms.zhidao.status==="connected"}/>
        </CollapsibleSection>
        <CollapsibleSection id={scope+"mastery"} title="AI 掌握度" defaultExpanded={false} lazy>
          {course.course_type==="ai"
            ?<>
              <div className="sf-mastery-start-shortcut">
                <span>全课程自动练习：四种首轮策略、后台续轮、服务器掌握度核验。</span>
                <button type="button" className="secondary"
                  onClick={()=>setMasteryDialogCourseKey(course.course_id)}>
                  <ListChecks size={15}/>配置并启动全自动
                </button>
              </div>
              <MasteryPanel key={"mastery:"+course.course_id} courseKey={course.course_id}
                courseTitle={course.title} desktop={desktop}/>
            </>
            :<p className="sf-muted" role="note">
              掌握度习题只存在于知到 AI 课程。当前课程是共享课，
              知识点掌握度请以课程页的服务器进度为准。
            </p>}
        </CollapsibleSection>
        <CollapsibleSection id={scope+"server"} title="服务器进度核验" defaultExpanded={false}>
          <ZhidaoProgressPanel key={"server:"+course.course_id} courses={platforms.zhidao.courses} desktop={desktop} connected={platforms.zhidao.status==="connected"} onCoursesUpdated={updateCourses} courseId={course.course_id} courseTitle={course.title} detailMode
            autoVerifyCourseId={autoVerify.courseId} autoVerifyEnabled={autoVerify.enabled} autoVerifyError={autoVerifyError}
            onAutoVerifyChange={configureAutoVerify}
            onEvent={(action,result,detail,context)=>recordEvent("知到",action,result,detail,context)}/>
        </CollapsibleSection>
      </>:course.platform==="ucampus"?<>
        <CollapsibleSection id={scope+"chapters"} title="章节与学习任务" defaultExpanded={true}>
          <UCampusCourseDetailPanel course={course} desktop={desktop}/>
        </CollapsibleSection>
      </>:course.platform==="xuexitong"?<>
        <CollapsibleSection id={scope+"chapters"} title="章节与学习记录" defaultExpanded={true}>
          <XuexitongCourseDetailPanel course={course} desktop={desktop}/>
        </CollapsibleSection>
      </>:<>
        <CollapsibleSection id={scope+"chapters"} title="章节与学习进度" defaultExpanded={true}>
          <YuketangCourseDetailPanel course={course} desktop={desktop}
            connected={platforms.yuketang.status==="connected"} scopeDirty={scopeDirty}/>
        </CollapsibleSection>
      </>}
      {course.platform==="zhidao"&&<SettingsDialog
        wide
        open={masteryDialogCourseKey===course.course_id} dark={dark}
        kicker="知到 · 后台学习任务"
        title={course.title+" · 全自动掌握度"}
        onClose={()=>setMasteryDialogCourseKey(null)}>
        {course.course_type==="ai"
          ?<MasteryAutoPanel key={"mastery-auto:"+course.course_id}
            courseKey={course.course_id} desktop={desktop}/>
          :<div role="note" className="sf-mastery-course-notice">
            <strong>当前课程不能启动 AI 掌握度自动练习</strong>
            <p>{course.course_type==="shared"
              ?"当前课程标记为共享课，平台没有这类 AI 掌握度练习。"
              :"尚未识别到这门课的 AI 课程类型。"}请先同步课程数据，
              确认在知到官方课程页面中存在掌握度习题。不会把共享课误当成 AI 课程提交。</p>
          </div>}
      </SettingsDialog>}
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
    ||page==="platform-yuketang"&&activeSelectedCourse?.platform==="yuketang"
    ||page==="platform-xuexitong"&&activeSelectedCourse?.platform==="xuexitong"
    ||page==="platform-ucampus"&&activeSelectedCourse?.platform==="ucampus")
    ?activeSelectedCourse:null;
  const headerPlatform:Platform|null=page==="platform-zhidao"?"zhidao":page==="platform-yuketang"?"yuketang":page==="platform-xuexitong"?"xuexitong":null;
  const activeMetric=workspaceCourse?courseMetric(workspaceCourse,workspaceCourse.platform==="yuketang"?yuketangSummaries[workspaceCourse.course_id]:undefined):null;
  const activeCourseProgress=activeMetric?.percent??null;
  const platformOverview=headerPlatform?platformProgressOverview(platforms[headerPlatform].courses,yuketangSummaries):null;

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
          <CourseCard course={course} yuketangSummary={course.platform==="yuketang"?yuketangSummaries[course.course_id]:undefined} onInspect={inspectCourse} key={course.platform+":"+course.course_id}/>)}</div>
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
    <AppShell page={page} settingsOpen={globalSettingsOpen} onOpenSettings={()=>openGlobalSettings()} onNavigate={next=>{
      if(next==="platform-zhidao"){goPlatform("zhidao");return;}
      if(next==="platform-yuketang"){goPlatform("yuketang");return;}
      if(next==="platform-xuexitong"){goPlatform("xuexitong");return;}
      if(next==="platform-ucampus"){goPlatform("ucampus");return;}
      setPlatformSettingsOpen(null);
      setZhsCourseSettingsOpen(false);
      setSelectedCourse(null);
      setPage(next);
    }}
      dark={dark} onThemeToggle={toggleTheme} onRefresh={()=>void refresh()}
      desktop={desktop} notice={notice} onDismissNotice={()=>setNotice("")}
      compact={compactCards}
      headerTitle={workspaceCourse?"课程详情":undefined}
      currentPlatform={headerPlatform?platformNames[headerPlatform]:undefined}
      currentCourseTitle={workspaceCourse?.title} courseProgress={activeCourseProgress} platformOverview={platformOverview}
      metricLabel={activeMetric?.label}
      courseEvidence={workspaceCourse?.platform==="yuketang"&&activeMetric
        ?activeMetric.evidenceLabel+" · "+activeMetric.detail:activeMetric?.evidenceLabel}
      courseVerifiedAt={activeMetric?.verifiedAt}
      currentPlatformStatus={headerPlatform?platforms[headerPlatform].status:undefined}
      selectedCourseId={workspaceCourse?.course_id??""}
      courseOptions={headerPlatform?platforms[headerPlatform].courses.filter(course=>!course.stale).map(course=>({id:course.course_id,title:course.title})):[]}
      onCourseSelect={id=>{
        if(!id){setSelectedCourse(null);return;}
        const course=courses.find(course=>course.platform===headerPlatform&&course.course_id===id&&!course.stale);
        if(course)inspectCourse(course);
      }}>
      <TaskRecoveryPanel desktop={desktop} consentAccepted={consentAccepted}
        visible={page==="home"||page==="tasks"} tasks={runtime.tasks} loading={runtime.loading}
        connected={{zhidao:platforms.zhidao.status==="connected",yuketang:platforms.yuketang.status==="connected"}}
        courses={courses} onRefresh={runtime.refresh}/>
      {page==="home"&&<>{renderPlatforms()}{renderMetrics()}{renderRecentCourses()}</>}
      {page==="tasks"&&renderTasks()}
      {page==="platforms"&&renderPlatforms()}
      {page==="platform-zhidao"&&renderPlatformDetail("zhidao")}
      {page==="platform-yuketang"&&renderPlatformDetail("yuketang")}
      {page==="platform-xuexitong"&&renderPlatformDetail("xuexitong")}
      {page==="platform-ucampus"&&renderPlatformDetail("ucampus")}
      {page==="records"&&renderRecords()}
      {page==="logs"&&renderLogs()}
    </AppShell>
    <GlobalSettingsModal open={globalSettingsOpen} dark={dark}
      activeTab={globalSettingsTab} onTabChange={setGlobalSettingsTab} onClose={()=>setGlobalSettingsOpen(false)}>
      {globalSettingsTab==="questionbank"&&<QuestionBankSettingsPanel desktop={desktop&&consentAccepted} dark={dark}/>}
      {globalSettingsTab==="general"&&<section className="settings-card">
        <h3>外观</h3>
        <div className="sf-settings-line">
          <div><strong>界面主题</strong></div>
          <ThemeModeSelector mode={mode} onChange={setMode}/>
        </div>
        <div className="sf-settings-line">
          <div><strong>紧凑卡片</strong></div>
          <Switch checked={compactCards} aria-label="紧凑卡片" onChange={setCompactCards}/>
        </div>
      </section>}
      <UpdatePanel desktop={desktop&&consentAccepted}
        visible={globalSettingsOpen&&globalSettingsTab==="updates"} embedded
        onDownloaded={setNotice} onOpenChangelog={releaseChangelog.openHistory}/>
      {globalSettingsTab==="about"&&<AboutOpenSourcePanel desktop={desktop} onOpenDeveloper={()=>setGlobalSettingsTab("developer")}/>}
      {globalSettingsTab==="developer"&&<DeveloperSitePanel desktop={desktop}/>} 
    </GlobalSettingsModal>
    <StudyFlowConsentGate desktop={desktop} dark={dark} onAccepted={()=>setConsentAccepted(true)} onResolved={onStartupReady}/>
    <ReleaseNotesDialog state={releaseChangelog.dialog} dark={dark} onClose={releaseChangelog.close}
      onRetry={releaseChangelog.retry}
      onOpenUpdates={()=>{releaseChangelog.close();openGlobalSettings("updates");}}/>
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

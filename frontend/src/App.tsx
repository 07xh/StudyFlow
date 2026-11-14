import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {
  Activity,ArrowLeft,BookOpen,CheckCircle2,ChevronRight,CircleGauge,GraduationCap,
  History,ListChecks,RefreshCw,Search,ChevronDown
} from "lucide-react";
import {initialPlatforms} from "./platforms";
import ZhidaoQrDialog from "./ZhidaoQrDialog";
import {LegacyPlaybackPanel} from "./components/LegacyPlaybackPanel";
import {YuketangTaskArea} from "./components/YuketangTaskArea";
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
import type {Config,Video,ZhidaoPlayerSettings} from "./bridge";
import type {Course,Platform,PlatformState} from "./types";
import {AppShell,type Page} from "./ui/AppShell";
import {presentCourse,platformNames,selectedSessionCourse} from "./presentation";
import {CourseCard} from "./ui/CourseCard";
import {PlatformCard} from "./ui/PlatformCard";
import {platformInfo,platformRegistry} from "./ui/registry";
import {useAppearance} from "./ui/useAppearance";
import {ThemeModeSelector} from "./ui/ThemeModeSelector";
import {Switch} from "./ui/Switch";
import {EmptyState} from "./ui/EmptyState";
import {ConfirmDialog} from "./ui/ConfirmDialog";

const emptyConfiguration:Config={session_id:"",csrf_token:"",classroom_id:"",university_id:"",sign:""};
type EventResult="success"|"warning"|"info";
type ActivityEntry={id:string;at:string;platform:string;action:string;result:EventResult;detail:string};
const ACTIVITY_KEY="studyflow.activity.v1";

function readActivity():ActivityEntry[]{
  try{
    const value=JSON.parse(window.localStorage.getItem(ACTIVITY_KEY)||"[]");
    if(!Array.isArray(value))return [];
    return value.filter((item):item is ActivityEntry=>Boolean(item)&&
      typeof item.id==="string"&&typeof item.at==="string"&&
      typeof item.platform==="string"&&typeof item.action==="string"&&
      (item.result==="success"||item.result==="warning"||item.result==="info")&&
      typeof item.detail==="string").slice(0,100);
  }catch{return [];}
}


function WorkspaceSection({
  storageKey,title,initiallyOpen=true,children
}:{storageKey:string;title:string;initiallyOpen?:boolean;children:ReactNode}){
  const [open,setOpen]=useState(()=>{
    try{
      const stored=window.localStorage.getItem(storageKey);
      return stored===null?initiallyOpen:stored==="true";
    }catch{return initiallyOpen;}
  });
  useEffect(()=>{
    try{window.localStorage.setItem(storageKey,String(open));}catch{/* Keep session preference. */}
  },[storageKey,open]);
  return <section className={"sf-workspace-fold"+(open?" is-open":"")}>
    <button type="button" className="sf-workspace-fold__toggle" aria-expanded={open}
      onClick={()=>setOpen(previous=>!previous)}>
      <strong>{title}</strong><ChevronDown size={16} aria-hidden="true"/>
    </button>
    {open&&<div className="sf-workspace-fold__body">{children}</div>}
  </section>;
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
  const [busy,setBusy]=useState("");
  const [selectedCourse,setSelectedCourse]=useState<Course|null>(null);
  const [notice,setNotice]=useState("");
  const [clearDialogOpen,setClearDialogOpen]=useState(false);
  const [qrOpen,setQrOpen]=useState(false);
  const [videos,setVideos]=useState<Video[]>([]);
  const [config,setConfig]=useState<Config>(emptyConfiguration);
  const [query,setQuery]=useState("");
  const [coursePlatform,setCoursePlatform]=useState("all");
  const [activity,setActivity]=useState<ActivityEntry[]>(readActivity);
  const [zhidaoPlaybackMode,setZhidaoPlaybackMode]=useState<"official"|"zhs-original">("official");
  const [platformLoginExpanded,setPlatformLoginExpanded]=useState<Record<Platform,boolean>>({zhidao:false,yuketang:false});
  const initialized=useRef(false);
  const desktop=isDesktop();
  const [consentAccepted,setConsentAccepted]=useState(!desktop);
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

  const recordEvent=useCallback((platform:string,action:string,result:EventResult,detail:string)=>{
    const item:ActivityEntry={
      id:Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7),
      at:new Date().toISOString(),platform,action,result,detail
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
  const filtered=useMemo(()=>courses.filter(course=>
    (coursePlatform==="all"||course.platform===coursePlatform)&&
    (course.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())||
      course.course_id.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  ),[courses,coursePlatform,query]);
  const verifiedCourses=useMemo(()=>courses.filter(course=>
    !course.stale&&course.progress_evidence==="server_verified"&&typeof course.verified_at==="string"&&
    course.verified_at.length>0&&course.progress_percent!==null
  ),[courses]);
  const learningCount=verifiedCourses.filter(course=>
    course.progress_percent!==null&&course.progress_percent>0&&course.progress_percent<100).length;
  const completedCount=verifiedCourses.filter(course=>
    course.progress_percent!==null&&course.progress_percent>=100).length;
  const averageProgress=verifiedCourses.length
    ?verifiedCourses.reduce((sum,course)=>sum+(course.progress_percent??0),0)/verifiedCourses.length
    :null;

  const refresh=useCallback(async()=>{
    if(!desktop){setNotice("浏览器仅提供界面预览；请使用 Windows 桌面版连接真实平台。");return;}
    setBusy("status");setNotice("");
    try{
      const statuses=await fetchStatuses();
      setPlatforms(previous=>{
        const next={...previous};
        for(const status of statuses){
          if(!platformInfo(status.platform))continue;
          next[status.platform]={...status,courses:status.status==="connected"&&previous[status.platform].status==="connected"?previous[status.platform].courses:[]};
        }
        return next;
      });
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
  },[refresh,consentAccepted]);

  async function sync(platform:Platform){
    const name=platformNames[platform]??platform;
    if(!platformInfo(platform))return;
    setBusy(platform);setNotice("");
    try{
      const list=await fetchCoursesFromDesktop(platform);
      setPlatforms(previous=>({...previous,[platform]:{...previous[platform],courses:list}}));
      setNotice(name+"已同步 "+list.length+" 门真实课程");
      recordEvent(name,"同步课程","success","读取到 "+list.length+" 门真实课程");
    }catch(error){
      const message=friendlyBridgeError(error);
      setNotice(message);recordEvent(name,"同步课程","warning",message);
    }finally{setBusy("");}
  }


  async function clear(){
    setBusy("clear");setNotice("");
    try{
      await request<{cleared:boolean}>({operation:"yuketang.clear"});
      invalidatePlatform("yuketang",true);
      setConfig(emptyConfiguration);setClearDialogOpen(false);
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

  function enterCourses(platform:Platform){
    setCoursePlatform(platform);setSelectedCourse(null);setPage("courses");
  }

  function goPlatform(platform:Platform,openLogin=false){
    setSelectedCourse(null);
    setPlatformLoginExpanded(previous=>({
      ...previous,[platform]:openLogin||platforms[platform].status!=="connected"
    }));
    setPage(platform==="zhidao"?"platform-zhidao":"platform-yuketang");
  }

  function renderPlatformLogin(platform:Platform){
    if(platform==="zhidao")return <ZhidaoLoginPanel desktop={desktop} busy={Boolean(busy)}
      onOpenNative={()=>setQrOpen(true)}
      onImported={()=>{invalidatePlatform("zhidao");recordEvent("知到","导入 Cookie","success","服务器已确认会话");void refresh();}}/>;
    if(platform==="yuketang")return <YuketangLoginPanel config={config}
      desktop={desktop} busy={Boolean(busy)}
      connected={platforms.yuketang.status==="connected"} videos={videos}
      onChange={(field,value)=>setConfig(previous=>({...previous,[field]:value}))}
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
        busy={Boolean(busy)} expanded={false}
        onSync={()=>void sync(definition.id)}
        onToggleLogin={()=>goPlatform(definition.id,true)}
        onEnterCourses={()=>enterCourses(definition.id)}>
        {null}
      </PlatformCard>)}
    </div>
  </section>;


  function renderZhidaoModeSwitch(){
    return <div className="sf-course-mode-bar" aria-label="知到运行方式">
      <strong>运行方式</strong>
      <div className="sf-zd-mode-options">
        <button type="button" aria-pressed={zhidaoPlaybackMode==="official"}
          className={zhidaoPlaybackMode==="official"?"active":""}
          onClick={()=>void changeZhidaoPlaybackMode("official")}>官方 WebView2</button>
        <button type="button" aria-pressed={zhidaoPlaybackMode==="zhs-original"}
          className={zhidaoPlaybackMode==="zhs-original"?"active":""}
          onClick={()=>void changeZhidaoPlaybackMode("zhs-original")}>ZHS 原版</button>
      </div>
    </div>;
  }

  const renderPlatformDetail=(platform:Platform)=>{
    const definition=platformInfo(platform);
    if(!definition)return null;
    return <>
      <section className="sf-platform-section sf-platform-detail">
        <PlatformCard definition={definition} state={platforms[platform]} desktop={desktop}
          busy={Boolean(busy)} expanded={platformLoginExpanded[platform]}
          onSync={()=>void sync(platform)}
          onToggleLogin={()=>setPlatformLoginExpanded(previous=>({...previous,[platform]:!previous[platform]}))}
          onEnterCourses={()=>enterCourses(platform)}>
          {renderPlatformLogin(platform)}
        </PlatformCard>
      </section>
      {platform==="zhidao"&&renderZhidaoModeSwitch()}
      <section className="sf-platform-task-section">
        {platform==="zhidao"
          ?zhidaoPlaybackMode==="official"
            ?<ZhidaoOfficialPlayerPanel courses={platforms.zhidao.courses} desktop={desktop}
              onCoursesUpdated={list=>setPlatforms(previous=>({...previous,zhidao:{...previous.zhidao,courses:list}}))}
              onEvent={(action,result,detail)=>recordEvent("知到",action,result,detail)}/>
            :<LegacyPlaybackPanel platform="zhidao" courses={platforms.zhidao.courses}
              desktop={desktop} connected={platforms.zhidao.status==="connected"}
              onEvent={(action,result,detail)=>recordEvent("知到",action,result,detail)}/>
          :<YuketangTaskArea courses={platforms.yuketang.courses}
            desktop={desktop} connected={platforms.yuketang.status==="connected"}
            onEvent={(action,result,detail)=>recordEvent("雨课堂",action,result,detail)}/>}
      </section>
      {platform==="zhidao"&&<>
        <ZhidaoProgressPanel courses={platforms.zhidao.courses}
          desktop={desktop} connected={platforms.zhidao.status==="connected"}
          onCoursesUpdated={list=>setPlatforms(previous=>({...previous,zhidao:{...previous.zhidao,courses:list}}))}
          onEvent={(action,result,detail)=>recordEvent("知到",action,result,detail)}/>
        <ZhidaoAccountTools desktop={desktop} dark={dark}
          onDataChanged={()=>{invalidatePlatform("zhidao");void refresh();}}/>
        <ZhidaoActivityPanel events={activity.filter(item=>item.platform==="知到")}/>
      </>}
    </>;
  };

  async function configureFromPanel(){
    setBusy("configure");setNotice("");
    try{
      await request<{saved:boolean}>({operation:"yuketang.configure",configuration:config});
      invalidatePlatform("yuketang");
      setConfig(previous=>({...previous,session_id:"",csrf_token:"",sign:""}));
      recordEvent("雨课堂","保存登录会话","success","凭据已写入 Windows 凭据管理器");
      await refresh();
      setNotice("雨课堂会话已保存，请确认连接状态后同步课程。");
    }catch(error){
      const message=friendlyBridgeError(error);
      setNotice(message);recordEvent("雨课堂","保存登录会话","warning",message);
    }finally{setBusy("");}
  }

  function invalidatePlatform(platform:Platform, resetStatus = false){
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
      <div><small>学习中</small><strong>{learningCount}<em>门</em></strong>
</div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon done"><CheckCircle2 size={21}/></span>
      <div><small>已完成</small><strong>{completedCount}<em>门</em></strong>
</div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon progress"><CircleGauge size={21}/></span>
      <div><small>总进度</small><strong>{averageProgress===null?"—":Math.round(averageProgress)+"%"}</strong>

        {averageProgress!==null&&<div className="sf-total-progress"><span style={{width:averageProgress+"%"}}/></div>}
      </div>
    </article>
  </section>;

  const renderRecentCourses=()=> <section className="sf-recent-section">
    <div className="section-head">
      <h3>课程概览</h3>
      <button className="text-button" type="button" onClick={()=>{setCoursePlatform("all");setPage("courses");}}>
        查看全部<ChevronRight size={16}/>
      </button>
    </div>
    {courses.length===0
      ?<EmptyState icon={BookOpen} title="暂无已同步课程"
          description="先在对应平台卡片中完成登录，再同步真实课程。"
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
                {data.percent===100&&<span className="sf-completed-tag">已完成</span>}
              </div>
              <div className="sf-recent-progress-label">
                <span>{data.percent===null?"学习进度：暂无平台确认数据":"学习进度："+data.percent.toFixed(1)+"%"}</span>
                {course.stale&&<span>数据可能已过期</span>}
              </div>
              {data.percent!==null&&<div className="sf-recent-track" role="progressbar"
                aria-label="服务器已核验进度" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={data.percent}><span style={{width:data.percent+"%"}}/></div>}
            </div>
            <button className="secondary sf-recent-detail" type="button"
              onClick={()=>{setSelectedCourse(course);setCoursePlatform(course.platform);setPage("courses");}}>
              课程详情
            </button>
          </article>;
        })}
      </div>}
  </section>;


  const renderCourseWorkspace=(course:Course)=>{
    const definition=platformInfo(course.platform);
    const progress=presentCourse(course);
    const verifiedAt=course.verified_at?new Date(course.verified_at).toLocaleString():"尚未核验";
    const updateCourses=(list:Course[])=>setPlatforms(previous=>({
      ...previous,[course.platform]:{...previous[course.platform],courses:list}
    }));
    const scope="studyflow.workspace."+course.platform+".";
    return <section className="sf-course-workspace">
      <div className="sf-course-detail-topline">
        <button className="secondary" type="button" onClick={()=>setSelectedCourse(null)}>
          <ArrowLeft size={15}/>返回课程列表
        </button>
      </div>
      <div className="sf-course-identity">
        <div>
          <span className="eyebrow">{definition?.name??platformNames[course.platform]} / {course.course_type==="ai"?"智慧课程":course.course_type==="shared"?"共享课程":"课程"}</span>
          <h2>{course.title}</h2>
        </div>
        <span className="sf-course-identity-evidence" title={progress.detail}>{progress.label} · {verifiedAt}</span>
      </div>
      {course.platform==="zhidao"&&renderZhidaoModeSwitch()}
      <WorkspaceSection storageKey={scope+"task"} title="任务运行" initiallyOpen>
        {course.platform==="zhidao"
          ?zhidaoPlaybackMode==="official"
            ?<ZhidaoOfficialPlayerPanel courses={platforms.zhidao.courses} desktop={desktop}
              courseId={course.course_id} detailMode onCoursesUpdated={updateCourses}
              onEvent={(action,result,detail)=>recordEvent("知到",action,result,detail)}/>
            :<LegacyPlaybackPanel platform="zhidao" courses={platforms.zhidao.courses}
              desktop={desktop} connected={platforms.zhidao.status==="connected"}
              courseId={course.course_id} detailMode
              onEvent={(action,result,detail)=>recordEvent("知到",action,result,detail)}/>
          :<YuketangTaskArea courses={[course]} desktop={desktop}
            connected={platforms.yuketang.status==="connected"} detailMode
            onEvent={(action,result,detail)=>recordEvent("雨课堂",action,result,detail)}/>}
      </WorkspaceSection>
      <WorkspaceSection storageKey={scope+"chapters"} title="章节进度"
        initiallyOpen={course.platform==="zhidao"}>
        {course.platform==="zhidao"
          ?<ZhidaoCourseDetailPanel course={course} desktop={desktop}/>
          :<div className="sf-course-chapter-note">
            <p>当前接口尚未返回这门课程可核验的章节进度明细。</p>
          </div>}
      </WorkspaceSection>
      {course.platform==="zhidao"&&
        <WorkspaceSection storageKey={scope+"verified"} title="服务器进度核验" initiallyOpen={false}>
          <ZhidaoProgressPanel courses={platforms.zhidao.courses}
            desktop={desktop} connected={platforms.zhidao.status==="connected"}
            onCoursesUpdated={updateCourses}
            onEvent={(action,result,detail)=>recordEvent("知到",action,result,detail)}
            courseId={course.course_id} courseTitle={course.title} detailMode/>
        </WorkspaceSection>}
      <WorkspaceSection storageKey={scope+"logs"} title="运行日志" initiallyOpen={false}>
        <ZhidaoActivityPanel embedded events={activity.filter(item=>
          item.platform===(course.platform==="zhidao"?"知到":"雨课堂"))}/>
      </WorkspaceSection>
    </section>;
  };

  const activeSelectedCourse=selectedSessionCourse(courses,selectedCourse);

  const renderCourses=()=> activeSelectedCourse
    ?renderCourseWorkspace(activeSelectedCourse)
    :<section>
      <div className="section-head">
        <h3>课程列表</h3>
        {coursePlatform!=="all"&&<button className="secondary" type="button" disabled={!desktop||Boolean(busy)}
          onClick={()=>void sync(coursePlatform as Platform)}>
          <RefreshCw size={15}/>同步当前平台
        </button>}
      </div>
      <div className="sf-search-toolbar">
        <label className="sf-search"><Search size={16}/><input type="search"
          placeholder="搜索课程名称或 ID" value={query} onChange={event=>setQuery(event.target.value)}
          aria-label="搜索课程"/></label>
        <div className="sf-filters" aria-label="按平台筛选">
          {[{id:"all",name:"全部平台"},...platformRegistry].map(option=><button type="button"
            key={option.id} aria-pressed={coursePlatform===option.id}
            className={coursePlatform===option.id?"sf-filter is-selected":"sf-filter"}
            onClick={()=>setCoursePlatform(option.id)}>{option.name}</button>)}
        </div>
      </div>
      {filtered.length>0
        ?<div className="course-grid">{filtered.map(course=>
          <CourseCard course={course} onInspect={setSelectedCourse} key={course.platform+":"+course.course_id}/>)}</div>
        :<EmptyState icon={BookOpen} title={courses.length>0?"未找到匹配课程":"暂无真实课程数据"}
          description={courses.length>0?"可以更换搜索词或平台筛选。":"在平台卡片中完成登录并同步后，真实课程会显示在这里。"}
          action={courses.length===0?<button className="secondary" type="button" onClick={()=>setPage("platforms")}>前往平台登录</button>:undefined}/>}
    </section>;

  const renderTasks=()=> <section className="sf-section">
    <div className="section-head"><h3>学习任务</h3></div>
    <div className="sf-task-grid sf-task-shortcuts">
      {platformRegistry.map(definition=><article className="sf-task-shortcut" key={definition.id}>
        <div className="sf-task-shortcut-head">
          <span className={"platform-logo sf-provider-"+definition.color}>{definition.mark}</span>
          <div><strong>{definition.name}</strong>
            <small>{platforms[definition.id].status==="connected"?"已连接":"未连接"}</small>
          </div>
        </div>
        <button type="button" className="secondary" onClick={()=>goPlatform(definition.id)}>
          <Activity size={15}/>查看任务与参数<ChevronRight size={15}/>
        </button>
      </article>)}
    </div>
  </section>;

  const renderRecords=()=> activeSelectedCourse
    ?renderCourseWorkspace(activeSelectedCourse)
    :<section>
      <div className="section-head"><h3>已核验学习记录</h3></div>
      {verifiedCourses.length>0
        ?<div className="course-grid">{verifiedCourses.map(course=>
          <CourseCard course={course} onInspect={setSelectedCourse} key={course.platform+":"+course.course_id}/>)}</div>
        :<EmptyState icon={History} title="暂无已核验学习记录"
          description="当前课程接口没有返回可验证的学习进度，不会用本地播放计数代替平台记录。"/>}
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

  const contextPlatform:Platform|null=activeSelectedCourse?.platform??(
    page==="platform-zhidao"?"zhidao":page==="platform-yuketang"?"yuketang":
    (page==="courses"&&coursePlatform!=="all"?coursePlatform as Platform:null)
  );
  const sidebarProgress=activeSelectedCourse?presentCourse(activeSelectedCourse):null;
  return <>
    <AppShell page={page} onNavigate={next=>{
      setPage(next);
      if(next!=="courses"&&next!=="records")setSelectedCourse(null);
    }}
      dark={dark} onThemeToggle={toggleTheme} onRefresh={()=>void refresh()}
      desktop={desktop} notice={notice} onDismissNotice={()=>setNotice("")}
      compact={compactCards}
      sidebarPlatform={contextPlatform?{
        name:platformNames[contextPlatform],connected:platforms[contextPlatform].status==="connected"
      }:undefined}
      sidebarCourse={activeSelectedCourse?{
        title:activeSelectedCourse.title,percent:sidebarProgress?.percent??null,
        evidence:sidebarProgress?.label??"等待服务器核验"
      }:undefined}
      headerTitle={activeSelectedCourse?platformNames[activeSelectedCourse.platform]+" / 课程详情":undefined}>
      {page==="home"&&<>{renderPlatforms()}{renderMetrics()}{renderRecentCourses()}</>}
      {page==="courses"&&renderCourses()}
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
      </>}
      <UpdatePanel desktop={desktop&&consentAccepted} visible={page==="settings"} onDownloaded={setNotice}/>
    </AppShell>
    <StudyFlowConsentGate desktop={desktop} dark={dark} onAccepted={()=>setConsentAccepted(true)}/>
    {consentAccepted&&<ZhidaoPlayerMonitor desktop={desktop}
      onCoursesUpdated={list=>setPlatforms(previous=>({...previous,zhidao:{...previous.zhidao,courses:list}}))}
      onEvent={(action,result,detail)=>recordEvent("知到",action,result,detail)}/>}
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

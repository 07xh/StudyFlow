import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {
  Activity,BookOpen,CheckCircle2,ChevronRight,CircleGauge,GraduationCap,
  History,ListChecks,RefreshCw,Search
} from "lucide-react";
import {initialPlatforms} from "./platforms";
import ZhidaoQrDialog from "./ZhidaoQrDialog";
import {LegacyPlaybackPanel} from "./components/LegacyPlaybackPanel";
import {ZhidaoLoginPanel} from "./components/ZhidaoMigration";
import {YuketangLoginPanel} from "./components/YuketangLoginPanel";
import {
  fetchStatuses,fetchCoursesFromDesktop,friendlyBridgeError,isDesktop,
  openLegacyZhidao,request
} from "./bridge";
import type {Config,Video} from "./bridge";
import type {Course,Platform,PlatformState} from "./types";
import {AppShell,type Page} from "./ui/AppShell";
import {presentCourse,platformNames} from "./presentation";
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
  const [expandedLogin,setExpandedLogin]=useState<Record<Platform,boolean>>({zhidao:false,yuketang:false});
  const [activity,setActivity]=useState<ActivityEntry[]>(readActivity);
  const initialized=useRef(false);
  const desktop=isDesktop();

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
  const filtered=useMemo(()=>courses.filter(course=>
    (coursePlatform==="all"||course.platform===coursePlatform)&&
    (course.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())||
      course.course_id.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  ),[courses,coursePlatform,query]);
  const verifiedCourses=useMemo(()=>courses.filter(course=>
    course.progress_evidence==="server_verified"&&typeof course.verified_at==="string"&&
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
          next[status.platform]={...status,courses:previous[status.platform].courses};
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
    if(initialized.current)return;
    initialized.current=true;
    void refresh();
  },[refresh]);

  async function sync(platform:Platform){
    const name=platformNames[platform]??platform;
    if(!platformInfo(platform))return;
    setBusy(platform);setNotice("");
    try{
      const list=await fetchCoursesFromDesktop(platform);
      setPlatforms(previous=>({...previous,[platform]:{...previous[platform],courses:list}}));
      setSelectedCourse(null);
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
      setPlatforms(previous=>({...previous,yuketang:initialPlatforms.yuketang}));
      setConfig(emptyConfiguration);setVideos([]);setClearDialogOpen(false);
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

  async function openZhidao(){
    setBusy("zhidao-login");setNotice("");
    try{
      await openLegacyZhidao();
      setNotice("已打开原版知到登录窗口；完成登录后检测连接。");
      recordEvent("知到","打开原版登录","info","已调用原版登录窗口");
    }catch(error){
      const message=error instanceof Error&&error.message==="LEGACY_NOT_AVAILABLE"
        ?"未找到原版知到登录窗口，请检查原版运行时。":friendlyBridgeError(error);
      setNotice(message);recordEvent("知到","打开原版登录","warning",message);
    }finally{setBusy("");}
  }

  function enterCourses(platform:Platform){
    setCoursePlatform(platform);setSelectedCourse(null);setPage("courses");
  }

  const renderPlatforms=()=> <section className="sf-platform-section">
    <div className="section-head">
      <div><h3>学习平台</h3><p>登录、连接与课程入口分别属于对应平台。</p></div>
      <button className="text-button" type="button" onClick={()=>setPage("platforms")}>
        平台管理<ChevronRight size={16}/>
      </button>
    </div>
    <div className="platform-grid sf-platform-grid">
      {platformRegistry.map(definition=><PlatformCard key={definition.id}
        definition={definition} state={platforms[definition.id]} desktop={desktop}
        busy={Boolean(busy)} expanded={expandedLogin[definition.id]}
        onSync={()=>void sync(definition.id)}
        onToggleLogin={()=>setExpandedLogin(previous=>({...previous,[definition.id]:!previous[definition.id]}))}
        onEnterCourses={()=>enterCourses(definition.id)}>
        {definition.id==="zhidao"
          ?<ZhidaoLoginPanel desktop={desktop} busy={Boolean(busy)}
              onOpenLegacy={()=>void openZhidao()} onOpenNative={()=>setQrOpen(true)}/>
          :<YuketangLoginPanel config={config} desktop={desktop} busy={Boolean(busy)}
              connected={platforms.yuketang.status==="connected"} videos={videos}
              onChange={(field,value)=>setConfig(previous=>({...previous,[field]:value}))}
              onSubmit={()=>void configureFromPanel()} onClear={()=>setClearDialogOpen(true)}
              onShowVideos={()=>void showVideos()}/>}
      </PlatformCard>)}
    </div>
  </section>;

  async function configureFromPanel(){
    setBusy("configure");setNotice("");
    try{
      await request<{saved:boolean}>({operation:"yuketang.configure",configuration:config});
      setConfig(previous=>({...previous,session_id:"",csrf_token:"",sign:""}));
      recordEvent("雨课堂","保存登录会话","success","凭据已写入 Windows 凭据管理器");
      await refresh();
      setNotice("雨课堂会话已保存，请确认连接状态后同步课程。");
    }catch(error){
      const message=friendlyBridgeError(error);
      setNotice(message);recordEvent("雨课堂","保存登录会话","warning",message);
    }finally{setBusy("");}
  }

  const renderMetrics=()=> <section className="sf-metrics-grid" aria-label="学习统计">
    <article className="sf-metric-card">
      <span className="sf-metric-icon"><BookOpen size={21}/></span>
      <div><small>全部课程</small><strong>{courses.length}<em>门</em></strong></div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon play"><ListChecks size={21}/></span>
      <div><small>学习中</small><strong>{learningCount}<em>门</em></strong>
        <span className="sf-metric-note">仅统计服务端已核验进度</span></div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon done"><CheckCircle2 size={21}/></span>
      <div><small>已完成</small><strong>{completedCount}<em>门</em></strong>
        <span className="sf-metric-note">以平台确认结果为准</span></div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon progress"><CircleGauge size={21}/></span>
      <div><small>总进度</small><strong>{averageProgress===null?"—":Math.round(averageProgress)+"%"}</strong>
        <span className="sf-metric-note">{averageProgress===null?"暂无已核验进度":verifiedCourses.length+" 门课程的平均值"}</span>
        {averageProgress!==null&&<div className="sf-total-progress"><span style={{width:averageProgress+"%"}}/></div>}
      </div>
    </article>
  </section>;

  const renderRecentCourses=()=> <section className="sf-recent-section">
    <div className="section-head">
      <div><h3>课程概览</h3><p>只展示已同步课程；未获得平台进度时不绘制进度条。</p></div>
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
                aria-label="服务器已核验课程进度" aria-valuemin={0} aria-valuemax={100}
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

  const renderCourses=()=> <section>
    <div className="section-head">
      <div><h3>课程列表</h3><p>课程信息来自已连接平台的真实读取结果。</p></div>
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
    {selectedCourse&&<div className="course-v2-detail" role="region" aria-label="课程详情">
      <div><span className="eyebrow">{platformNames[selectedCourse.platform]} / 课程详情</span>
        <h3>{selectedCourse.title}</h3>
        <p>{presentCourse(selectedCourse).detail}；学习进度只有平台服务端确认后才会展示。</p>
      </div>
      <button type="button" className="secondary" onClick={()=>setSelectedCourse(null)}>关闭</button>
    </div>}
  </section>;

  const renderTasks=()=> <section>
    <div className="section-head"><div><h3>原版学习任务</h3>
      <p>分别管理知到与雨课堂的原有任务进程；登录仍在各自平台卡片内。</p></div></div>
    <div className="sf-task-grid">
      <LegacyPlaybackPanel platform="zhidao" courses={platforms.zhidao.courses}
        desktop={desktop} connected={platforms.zhidao.status==="connected"}
        onEvent={(action,result,detail)=>recordEvent("知到",action,result,detail)}/>
      <LegacyPlaybackPanel platform="yuketang" courses={platforms.yuketang.courses}
        desktop={desktop} connected={platforms.yuketang.status==="connected"}
        onEvent={(action,result,detail)=>recordEvent("雨课堂",action,result,detail)}/>
    </div>
  </section>;

  const renderRecords=()=> <section>
    <div className="section-head"><div><h3>已核验学习记录</h3>
      <p>只有包含服务端核验标记和时间戳的记录才会出现在这里。</p></div></div>
    {verifiedCourses.length>0
      ?<div className="course-grid">{verifiedCourses.map(course=>
        <CourseCard course={course} onInspect={setSelectedCourse} key={course.platform+":"+course.course_id}/>)}</div>
      :<EmptyState icon={History} title="暂无已核验学习记录"
        description="当前课程接口没有返回可验证的学习进度，不会用本地播放计数代替平台记录。"/>}
    {selectedCourse&&<div className="course-v2-detail">
      <div><span className="eyebrow">{platformNames[selectedCourse.platform]} / 学习记录</span>
        <h3>{selectedCourse.title}</h3><p>{presentCourse(selectedCourse).detail}</p></div>
      <button className="secondary" type="button" onClick={()=>setSelectedCourse(null)}>关闭</button>
    </div>}
  </section>;

  const renderLogs=()=> <section>
    <div className="section-head"><div><h3>本机操作记录</h3>
      <p>最多保留最近 100 条操作元数据，不记录密码、Cookie、二维码或原始响应。</p></div>
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
    <AppShell page={page} onNavigate={next=>{setPage(next);setSelectedCourse(null);}}
      dark={dark} onThemeToggle={toggleTheme} onRefresh={()=>void refresh()}
      desktop={desktop} notice={notice} onDismissNotice={()=>setNotice("")}
      compact={compactCards}>
      {page==="home"&&<>{renderPlatforms()}{renderMetrics()}{renderRecentCourses()}</>}
      {page==="courses"&&renderCourses()}
      {page==="tasks"&&renderTasks()}
      {page==="platforms"&&renderPlatforms()}
      {page==="records"&&renderRecords()}
      {page==="logs"&&renderLogs()}
      {page==="settings"&&<>
        <section className="settings-card">
          <h3>外观</h3><p>偏好仅保存在本机，不接触平台凭据及学习数据。</p>
          <div className="sf-settings-line">
            <div><strong>界面主题</strong><p>可切换深色、浅色或跟随系统。</p></div>
            <ThemeModeSelector mode={mode} onChange={setMode}/>
          </div>
          <div className="sf-settings-line">
            <div><strong>紧凑卡片</strong><p>在较小窗口中显示更多课程。</p></div>
            <Switch checked={compactCards} aria-label="紧凑卡片" onChange={setCompactCards}/>
          </div>
        </section>
        <section className="settings-card">
          <h3>平台扩展</h3>
          <p>当前接入 {platformRegistry.length} 个平台。新平台必须先完成真实后端适配，再注册登录与课程界面。</p>
        </section>
      </>}
      <footer className="studyflow-footer">学序 StudyFlow · 本地优先 · 平台凭据相互隔离</footer>
    </AppShell>
    {qrOpen&&<ZhidaoQrDialog dark={dark} onClose={()=>setQrOpen(false)}
      onVerified={()=>{setNotice("知到登录已通过服务端核验；正在检测连接。");
        recordEvent("知到","扫码登录","success","知到服务端验证通过");void refresh();}}/>}
    <ConfirmDialog open={clearDialogOpen} dark={dark} danger busy={busy==="clear"}
      title="清除学序保存的雨课堂凭据？"
      description="此操作将清除学序在 Windows 凭据管理器中保存的雨课堂登录会话。"
      warning="需要重新配置会话才能继续读取课程；不会删除原版雨课堂文件或课程记录。"
      confirmLabel="确认清除" cancelLabel="保留登录"
      onConfirm={()=>void clear()} onCancel={()=>setClearDialogOpen(false)}/>
  </>;
}

import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {BookOpen,ChevronRight,RefreshCw,Search} from "lucide-react";
import {initialPlatforms} from "./platforms";
import ZhidaoQrDialog from "./ZhidaoQrDialog";
import {LegacyPlaybackPanel} from "./components/LegacyPlaybackPanel";
import {fetchStatuses,fetchCoursesFromDesktop,friendlyBridgeError,isDesktop,openLegacyZhidao,request} from "./bridge";
import type {Config,Video} from "./bridge";
import type {Course,Platform,PlatformState} from "./types";
import {AppShell,type Page} from "./ui/AppShell";
import {ZhidaoLoginPanel} from "./components/ZhidaoMigration";
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
const credentialFields=[
  {id:"session_id",label:"Session ID",type:"password",required:true},
  {id:"csrf_token",label:"CSRF Token",type:"password",required:true},
  {id:"classroom_id",label:"课堂 ID",type:"text",required:true},
  {id:"university_id",label:"学校 ID",type:"text",required:true},
  {id:"sign",label:"章节 Sign（可选）",type:"password",required:false},
] as const;

export default function App(){
  const [page,setPage]=useState<Page>("home");
  const {dark,mode,setMode,toggleTheme}=useAppearance();
  const [compactCards,setCompactCards]=useState(()=>{
    try{return window.localStorage.getItem("studyflow.cards.compact")==="true";}
    catch{return false;}
  });
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.cards.compact",String(compactCards));}
    catch{/* Preference remains usable in this session. */}
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
  const initialized=useRef(false);
  const desktop=isDesktop();
  const courses=useMemo(()=>Object.values(platforms).flatMap(item=>item.courses),[platforms]);
  const filtered=useMemo(()=>courses.filter(course=>
    (coursePlatform==="all"||course.platform===coursePlatform)
    &&(course.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      || course.course_id.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  ),[courses,coursePlatform,query]);
  const connectedCount=Object.values(platforms).filter(item=>item.status==="connected").length;

  const refresh=useCallback(async()=>{
    if(!desktop){setNotice("浏览器预览不能连接本机平台服务。");return;}
    setBusy("status");setNotice("");
    try{
      const statuses=await fetchStatuses();
      setSelectedCourse(null);
      setPlatforms(previous=>{
        const next={...previous};
        for(const status of statuses){
          if(!platformInfo(status.platform))continue;
          next[status.platform]={...status,courses:[]};
        }
        return next;
      });
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy("");}
  },[desktop]);

  useEffect(()=>{
    if(initialized.current)return;
    initialized.current=true;
    void refresh();
  },[refresh]);

  async function sync(platform:Platform){
    if(!platformInfo(platform))return;
    setBusy(platform);setNotice("");
    try{
      const list=await fetchCoursesFromDesktop(platform);
      setPlatforms(previous=>({...previous,[platform]:{...previous[platform],courses:list}}));
      setSelectedCourse(null);
      setNotice((platformInfo(platform)?.name??platform)+"已同步 "+list.length+" 门课程");
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy("");}
  }

  async function configure(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy("configure");setNotice("");
    try{
      await request<{saved:boolean}>({operation:"yuketang.configure",configuration:config});
      setConfig(previous=>({...previous,session_id:"",csrf_token:"",sign:""}));
      setNotice("雨课堂会话已保存。");
      await refresh();
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy("");}
  }

  async function clear(){
    setBusy("clear");setNotice("");
    try{
      await request<{cleared:boolean}>({operation:"yuketang.clear"});
      setPlatforms(previous=>({...previous,yuketang:initialPlatforms.yuketang}));
      setVideos([]);setClearDialogOpen(false);setNotice("雨课堂凭据已清除。");
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy("");}
  }

  async function showVideos(){
    setBusy("videos");setNotice("");
    try{
      const result=await request<Video[]>({operation:"videos.list",platform:"yuketang"});
      setVideos(result);
      if(result.length===0)setNotice("未读取到章节视频。");
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy("");}
  }

  async function openZhidao(){
    setBusy("zhidao-login");setNotice("");
    try{
      await openLegacyZhidao();
      setNotice("已打开原版知到登录窗口。");
    }catch(error){setNotice(error instanceof Error&&error.message==="LEGACY_NOT_AVAILABLE"?"未找到原版知到登录窗口。":friendlyBridgeError(error));}
    finally{setBusy("");}
  }

  const renderPlatforms=()=> <section className="sf-section">
    <div className="section-head">
      <h3>学习平台</h3>
      <button className="secondary sf-refresh" type="button" disabled={!desktop||Boolean(busy)}
        onClick={()=>void refresh()}><RefreshCw size={15}/>检测连接</button>
    </div>
    <div className="platform-grid">
      {platformRegistry.map(definition=><PlatformCard key={definition.id}
        definition={definition} state={platforms[definition.id]} desktop={desktop}
        busy={Boolean(busy)} onSync={()=>void sync(definition.id)}
        onLogin={()=>void openZhidao()} onVideos={()=>void showVideos()}/>)}
    </div>
  </section>;

  const renderCourses=(compact:boolean)=> {
    const visible=compact?courses.slice(0,4):filtered;
    return <section className="sf-section">
      <div className="section-head">
        <h3>{compact?"最近课程":"全部课程"}</h3>
        {compact&&<button className="text-button" type="button" onClick={()=>setPage("courses")}>
          查看全部 <ChevronRight size={15}/>
        </button>}
      </div>
      {!compact&&<div className="sf-search-toolbar">
        <label className="sf-search"><Search size={16}/><input type="search"
          placeholder="搜索课程名称或 ID" value={query} onChange={event=>setQuery(event.target.value)}
          aria-label="搜索课程"/></label>
        <div className="sf-filters" aria-label="按平台筛选">
          {[{id:"all",name:"全部"},...platformRegistry].map(option=><button type="button"
            key={option.id} aria-pressed={coursePlatform===option.id}
            className={coursePlatform===option.id?"sf-filter is-selected":"sf-filter"}
            onClick={()=>setCoursePlatform(option.id)}>{option.name}</button>)}
        </div>
      </div>}
      {visible.length>0
        ?<div className="course-grid">{visible.map(course=>
          <CourseCard course={course} onInspect={setSelectedCourse} key={course.platform+":"+course.course_id}/>)}</div>
        :<EmptyState icon={BookOpen}
          title={courses.length>0?"没有匹配的课程":"暂无课程"}
          action={courses.length===0?<button className="primary" type="button"
            onClick={()=>setPage("platforms")}>连接平台</button>:undefined}/>
      }
      {page==="courses"&&selectedCourse&&<div className="course-v2-detail" role="region" aria-label="课程详情">
        <div><span className="eyebrow">{platformNames[selectedCourse.platform]}</span>
          <h3>{selectedCourse.title}</h3>
          <p>{presentCourse(selectedCourse).detail}</p>
        </div>
        <button type="button" className="secondary" onClick={()=>setSelectedCourse(null)}>关闭</button>
      </div>}
    </section>;
  };

  return <><AppShell page={page} onNavigate={setPage} dark={dark} onThemeToggle={toggleTheme}
    desktop={desktop} notice={notice} onDismissNotice={()=>setNotice("")} compact={compactCards}>
    {page==="home"&&<>
      <div className="metrics sf-metrics">
        <div className="metric"><span>已连接平台</span>
          <strong>{connectedCount}<small> / {platformRegistry.length}</small></strong></div>
        <div className="metric"><span>已同步课程</span><strong>{courses.length}</strong></div>
        <div className="metric"><span>运行环境</span>
          <strong className="pending">{desktop?"Windows 桌面":"浏览器"}</strong></div>
      </div>
      {renderPlatforms()}
      {renderCourses(true)}
    </>}
    {page==="courses"&&renderCourses(false)}
    {page==="platforms"&&<>
      {renderPlatforms()}
      <div className="sf-task-grid">
        <LegacyPlaybackPanel platform="zhidao" courses={platforms.zhidao.courses}
          desktop={desktop} connected={platforms.zhidao.status==="connected"}/>
        <LegacyPlaybackPanel platform="yuketang" courses={platforms.yuketang.courses}
          desktop={desktop} connected={platforms.yuketang.status==="connected"}/>
      </div>
      <ZhidaoLoginPanel desktop={desktop} busy={Boolean(busy)}
        onOpenLegacy={()=>void openZhidao()} onOpenNative={()=>setQrOpen(true)}/>
      {platformRegistry.some(item=>item.capabilities.sessionConfiguration&&item.id==="yuketang")&&
        <section className="settings-card sf-settings-card">
          <div className="section-head"><h3>雨课堂会话</h3></div>
          <form className="credential-form" onSubmit={event=>void configure(event)}>
            {credentialFields.map(field=><label key={field.id}>
              <span>{field.label}</span>
              <input type={field.type} required={field.required} autoComplete="off"
                value={config[field.id]}
                onChange={event=>setConfig(previous=>({...previous,[field.id]:event.target.value}))}/>
            </label>)}
            <div className="actions">
              <button className="primary" type="submit" disabled={!desktop||Boolean(busy)}>保存会话</button>
              <button className="secondary" type="button" disabled={!desktop||Boolean(busy)}
                onClick={()=>setClearDialogOpen(true)}>清除凭据</button>
            </div>
          </form>
        </section>}
      {videos.length>0&&<section className="settings-card sf-settings-card">
        <div className="section-head"><h3>雨课堂章节视频</h3></div>
        <div className="video-list">{videos.map((video,index)=>
          <div key={video.id+":"+index}>
            <small>{video.chapter}</small><strong>{video.name}</strong>
            <span>ID：{video.id}</span>
          </div>)}
        </div>
      </section>}
    </>}
    {page==="settings"&&<section className="settings-card sf-settings-card">
      <div className="section-head"><h3>外观设置</h3></div>
      <div className="sf-settings-line">
        <div><strong>主题</strong></div>
        <ThemeModeSelector mode={mode} onChange={setMode}/>
      </div>
      <div className="sf-settings-line">
        <div><strong>紧凑卡片</strong></div>
        <Switch checked={compactCards} aria-label="紧凑卡片"
          onChange={next=>setCompactCards(next)}/>
      </div>
    </section>}
  </AppShell>
    {qrOpen&&<ZhidaoQrDialog dark={dark} onClose={()=>setQrOpen(false)}
      onVerified={()=>{setNotice("知到登录已通过服务器核验。");void refresh();}}/>}
    <ConfirmDialog open={clearDialogOpen} dark={dark} danger busy={busy==="clear"}
      title="清除雨课堂登录会话？"
      description="将清除学序保存的雨课堂凭据。"
      warning="需要重新配置会话；不会删除原版雨课堂文件或课程记录。"
      confirmLabel="确认清除" cancelLabel="保留会话"
      onConfirm={()=>void clear()} onCancel={()=>setClearDialogOpen(false)}/>
  </>;
}

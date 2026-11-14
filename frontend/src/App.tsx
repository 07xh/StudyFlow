import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {BookOpen,ChevronRight,GraduationCap,RefreshCw,Search} from "lucide-react";
import {initialPlatforms} from "./platforms";
import {fetchStatuses,isDesktop,openLegacyZhidao,request} from "./bridge";
import type {Config,Video} from "./bridge";
import type {Course,Platform,PlatformState} from "./types";
import {AppShell,type Page} from "./ui/AppShell";
import {CourseCard} from "./ui/CourseCard";
import {PlatformCard} from "./ui/PlatformCard";
import {platformInfo,platformRegistry} from "./ui/registry";
import {useAppearance} from "./ui/useAppearance";
import {ThemeModeSelector} from "./ui/ThemeModeSelector";
import {Switch} from "./ui/Switch";
import {EmptyState} from "./ui/EmptyState";

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
    catch{/* Setting remains usable in this session. */}
  },[compactCards]);
  const [platforms,setPlatforms]=useState<Record<Platform,PlatformState>>(initialPlatforms);
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState("");
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
    if(!desktop){setNotice("浏览器仅提供界面预览；请使用 Windows 桌面版连接真实平台。");return;}
    setBusy("status");setNotice("");
    try{
      const statuses=await fetchStatuses();
      setPlatforms(previous=>{
        const next={...previous};
        for(const status of statuses){
          if(!platformInfo(status.platform))continue;
          next[status.platform]={...status,courses:previous[status.platform]?.courses??[]};
        }
        return next;
      });
    }catch(error){setNotice(error instanceof Error?error.message:"无法检测本地学习服务");}
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
      const list=await request<Course[]>({operation:"courses.list",platform});
      setPlatforms(previous=>({...previous,[platform]:{...previous[platform],courses:list}}));
      setNotice((platformInfo(platform)?.name??platform)+"已同步 "+list.length+" 门真实课程");
    }catch(error){setNotice(error instanceof Error?error.message:"同步失败");}
    finally{setBusy("");}
  }

  async function configure(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy("configure");setNotice("");
    try{
      await request<{saved:boolean}>({operation:"yuketang.configure",configuration:config});
      setConfig(previous=>({...previous,session_id:"",csrf_token:"",sign:""}));
      setNotice("会话已保存到 Windows 凭据管理器。请检测连接并读取真实课程。");
      await refresh();
    }catch(error){setNotice(error instanceof Error?error.message:"保存失败");}
    finally{setBusy("");}
  }

  async function clear(){
    setBusy("clear");setNotice("");
    try{
      await request<{cleared:boolean}>({operation:"yuketang.clear"});
      setPlatforms(previous=>({...previous,yuketang:initialPlatforms.yuketang}));
      setVideos([]);setNotice("已清除学序保存的雨课堂凭据；原程序不受影响。");
    }catch(error){setNotice(error instanceof Error?error.message:"清除失败");}
    finally{setBusy("");}
  }

  async function showVideos(){
    setBusy("videos");setNotice("");
    try{
      const result=await request<Video[]>({operation:"videos.list",platform:"yuketang"});
      setVideos(result);
      if(result.length===0)setNotice("未读取到章节视频，请检查当前课堂配置。");
    }catch(error){setNotice(error instanceof Error?error.message:"章节读取失败");}
    finally{setBusy("");}
  }

  async function openZhidao(){
    setBusy("zhidao-login");setNotice("");
    try{
      await openLegacyZhidao();
      setNotice("已调用原版知到登录窗口；完成扫码后点击检测连接。");
    }catch(error){setNotice(error instanceof Error?error.message:"原版知到客户端未安装");}
    finally{setBusy("");}
  }

  const renderPlatforms=()=> <section>
    <div className="section-head">
      <div><h3>学习平台</h3><p>连接状态由本地真实接口检测，不生成模拟课程。</p></div>
      <button className="secondary" type="button" disabled={!desktop||Boolean(busy)}
        onClick={()=>void refresh()}><RefreshCw size={16}/>检测连接</button>
    </div>
    <div className="platform-grid">
      {platformRegistry.map(definition=><PlatformCard key={definition.id}
        definition={definition} state={platforms[definition.id]} desktop={desktop}
        busy={Boolean(busy)} onSync={()=>void sync(definition.id)}
        onLogin={()=>void openZhidao()} onVideos={()=>void showVideos()}/>)}
    </div>
  </section>;

  const renderCourses=(compact:boolean)=> <section>
    <div className="section-head">
      <div><h3>课程列表</h3><p>仅展示已同步的真实课程，进度没有来源时不会虚构。</p></div>
      {compact&&<button className="text-button" type="button" onClick={()=>setPage("courses")}>
        查看全部 <ChevronRight size={16}/>
      </button>}
    </div>
    {!compact&&<div className="sf-search-toolbar">
      <label className="sf-search"><Search size={16}/><input type="search"
        placeholder="搜索课程名称或 ID" value={query} onChange={event=>setQuery(event.target.value)}
        aria-label="搜索课程"/></label>
      <div className="sf-filters" aria-label="按平台筛选">
        {[{id:"all",name:"全部平台"},...platformRegistry].map(option=><button type="button"
          key={option.id} aria-pressed={coursePlatform===option.id}
          className={coursePlatform===option.id?"sf-filter is-selected":"sf-filter"}
          onClick={()=>setCoursePlatform(option.id)}>{option.name}</button>)}
      </div>
    </div>}
    {(compact?courses:filtered).length>0
      ?<div className="course-grid">{(compact?courses.slice(0,4):filtered).map(course=>
        <CourseCard course={course} key={course.platform+":"+course.course_id}/>)}</div>
      :<EmptyState icon={BookOpen}
        title={courses.length>0?"未找到匹配课程":"暂无真实课程数据"}
        description={courses.length>0?"可以更换筛选条件。":"完成平台登录并同步后，这里显示实际课程。"}
        action={courses.length===0?<button className="secondary" type="button"
          onClick={()=>setPage("platforms")}>前往平台管理</button>:undefined}/>
    }
  </section>;

  return <AppShell page={page} onNavigate={setPage} dark={dark} onThemeToggle={toggleTheme}
    desktop={desktop} notice={notice} compact={compactCards}>
    {page==="home"&&<>
      <div className="hero">
        <div>
          <span className="pill">{desktop?"Windows 桌面工作空间":"浏览器 UI 预览"}</span>
          <h2>让学习井然有序</h2>
          <p>一个入口管理不同学习平台，数据与凭据彼此隔离。</p>
          <button className="primary" type="button" onClick={()=>setPage("platforms")}>
            管理平台连接 <ChevronRight size={17}/>
          </button>
          <div className="sf-hero-hint">没有真实数据时，显示空状态而非演示成绩或进度。</div>
        </div>
        <div className="hero-visual"><GraduationCap size={90} strokeWidth={1}/></div>
      </div>
      <div className="metrics">
        <div className="metric"><span>已连接平台</span>
          <strong>{connectedCount} <small>/ {platformRegistry.length}</small></strong></div>
        <div className="metric"><span>已同步课程</span><strong>{courses.length}</strong></div>
        <div className="metric"><span>运行环境</span>
          <strong className="pending">{desktop?"Windows 桌面":"浏览器预览"}</strong></div>
      </div>
      {renderPlatforms()}
      {renderCourses(true)}
    </>}
    {page==="courses"&&renderCourses(false)}
    {page==="platforms"&&<>
      {renderPlatforms()}
      {platformRegistry.some(item=>item.capabilities.sessionConfiguration&&item.id==="yuketang")&&
        <section className="settings-card">
          <h3>雨课堂登录会话</h3>
          <p>仅配置本人的有效登录会话。会话保存在 Windows 凭据管理器，不修改原版程序。</p>
          <form className="credential-form" onSubmit={event=>void configure(event)}>
            {credentialFields.map(field=><label key={field.id}>
              <span>{field.label}</span>
              <input type={field.type} required={field.required} autoComplete="off"
                value={config[field.id]}
                onChange={event=>setConfig(previous=>({...previous,[field.id]:event.target.value}))}/>
            </label>)}
            <div className="actions">
              <button className="primary" type="submit" disabled={!desktop||Boolean(busy)}>保存并验证</button>
              <button className="secondary" type="button" disabled={!desktop||Boolean(busy)}
                onClick={()=>void clear()}>仅清除学序凭据</button>
            </div>
          </form>
        </section>}
      {videos.length>0&&<section className="settings-card">
        <h3>雨课堂章节视频</h3>
        <p>来自本地平台适配器的真实读取结果。</p>
        <div className="video-list">{videos.map((video,index)=>
          <div key={video.id+":"+index}>
            <small>{video.chapter}</small><strong>{video.name}</strong>
            <span>视频 ID：{video.id}</span>
          </div>)}
        </div>
      </section>}
    </>}
    {page==="settings"&&<>
      <section className="settings-card">
        <h3>外观</h3>
        <p>偏好仅保存在本机，不接触平台凭据及学习数据。</p>
        <div className="sf-settings-line">
          <div><strong>界面主题</strong>
            <p>主题设置会在下次打开学序时保留。</p></div>
          <ThemeModeSelector mode={mode} onChange={setMode}/>
        </div>
        <div className="sf-settings-line">
          <div><strong>紧凑卡片</strong><p>在小屏幕显示更多课程，不改变学习数据。</p></div>
          <Switch checked={compactCards} aria-label="紧凑卡片"
            onChange={next=>setCompactCards(next)}/>
        </div>
      </section>
      <section className="settings-card">
        <h3>平台扩展</h3>
        <p>当前已注册 {platformRegistry.length} 个平台。新增平台需先接入真实后端适配器，再注册 UI 元数据。</p>
        <div className="sf-section-note">UI 注册不等于已经支持登录、课程或视频播放。后续学习通等平台复用相同卡片与导航。</div>
      </section>
    </>}
  </AppShell>;
}

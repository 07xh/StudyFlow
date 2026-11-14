import {useCallback,useEffect,useState,type FormEvent} from "react";
import {BookOpen,LayoutDashboard,Settings,ShieldCheck,GraduationCap,RefreshCw,ChevronRight,Moon,Sun,PlayCircle} from "lucide-react";
import {initialPlatforms} from "./platforms";
import ZhidaoQrDialog from "./ZhidaoQrDialog";
import {MigratedCourseCard, ZhidaoLoginPanel} from "./components/ZhidaoMigration";
import {platformNames, presentCourse} from "./presentation";
import {fetchStatuses,fetchCoursesFromDesktop,friendlyBridgeError,isDesktop,openLegacyZhidao,request} from "./bridge";
import type {Config,Video} from "./bridge";
import type {Course,Platform,PlatformState} from "./types";

type Page = "home"|"courses"|"platforms"|"settings";
const names:Record<Platform,string>={zhidao:"知到",yuketang:"雨课堂"};

export default function App(){
  const [page,setPage]=useState<Page>("home");
  const [dark,setDark]=useState(()=>{
    try {return window.localStorage.getItem("studyflow-theme") !== "light";}
    catch {return true;}
  });
  const toggleTheme=()=>{
    setDark(current=>{
      try {window.localStorage.setItem("studyflow-theme",current?"light":"dark");}
      catch {/* Cosmetic preference only; never store credentials here. */}
      return !current;
    });
  };
  const [platforms,setPlatforms]=useState<Record<Platform,PlatformState>>(initialPlatforms);
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState("");
  const [qrOpen,setQrOpen]=useState(false);
  const [videos,setVideos]=useState<Video[]>([]);
  const [filter,setFilter]=useState<"all"|Platform>("all");
  const [selectedCourse,setSelectedCourse]=useState<Course|null>(null);
  const [config,setConfig]=useState<Config>({session_id:"",csrf_token:"",classroom_id:"",university_id:"",sign:""});
  const desktop=isDesktop();
  const courses=Object.values(platforms).flatMap(p=>p.courses);
  const visibleCourses=filter==="all"?courses:courses.filter(c=>c.platform===filter);
  const navigation:{id:Page;label:string;icon:typeof BookOpen}[]=[
    {id:"home",label:"总览",icon:LayoutDashboard},{id:"courses",label:"我的课程",icon:BookOpen},
    {id:"platforms",label:"平台连接",icon:ShieldCheck},{id:"settings",label:"设置",icon:Settings}
  ];

  const refresh=useCallback(async()=>{
    if(!desktop){setNotice("浏览器仅显示界面预览；请运行 Windows 安装版连接真实平台。");return}
    setBusy("status");setNotice("");
    try{
      const statuses=await fetchStatuses();
      setPlatforms(previous=>{
        const next={...previous};
        statuses.forEach(s=>{next[s.platform]={...s,courses:[]}});
        return next;
      });
    }catch(e){setNotice(friendlyBridgeError(e))}
    finally{setBusy("")}
  },[desktop]);

  useEffect(()=>{void refresh()},[refresh]);

  const sync=async(platform:Platform)=>{
    setBusy(platform);setNotice("");
    try{
      const list=await fetchCoursesFromDesktop(platform);
      setPlatforms(previous=>({...previous,[platform]:{...previous[platform],courses:list}}));
      setNotice(names[platform]+"已同步 "+list.length+" 门真实课程");
    }catch(e){setNotice(friendlyBridgeError(e))}
    finally{setBusy("")}
  };

  const configure=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setBusy("configure");setNotice("");
    try{
      await request<{saved:boolean}>({operation:"yuketang.configure",configuration:config});
      setConfig(previous=>({...previous,session_id:"",csrf_token:"",sign:""}));
      setNotice("会话已保存到 Windows 凭据管理器。现在可检测连接并读取课堂。");
      await refresh();
    }catch(e){setNotice(friendlyBridgeError(e))}
    finally{setBusy("")}
  };

  const clear=async()=>{
    setBusy("clear");
    try{
      await request<{cleared:boolean}>({operation:"yuketang.clear"});
      setPlatforms(previous=>({...previous,yuketang:{...initialPlatforms.yuketang}}));
      setVideos([]);setNotice("已清除学序保存的雨课堂会话；未更改原程序配置。");
    }catch(e){setNotice(friendlyBridgeError(e))}
    finally{setBusy("")}
  };

  const showVideos=async()=>{
    setBusy("videos");setNotice("");
    try{setVideos(await request<Video[]>({operation:"videos.list",platform:"yuketang"}))}
    catch(e){setNotice(friendlyBridgeError(e))}
    finally{setBusy("")}
  };

  const openZhidao=async()=>{
    setBusy("zhidao-login");
    try{await openLegacyZhidao();setNotice("已调用原版知到登录窗口；扫码完成后点击检测连接。")}
    catch(e){setNotice(e instanceof Error&&e.message==="LEGACY_NOT_AVAILABLE"?"未找到原版知到登录窗口，请检查原版安装。":friendlyBridgeError(e))}
    finally{setBusy("")}
  };

  return <div className={dark?"app dark":"app"}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><GraduationCap size={23}/></div><div><strong>学序</strong><small>StudyFlow</small></div></div>
      <div className="section-label">工作空间</div>
      <nav>{navigation.map(n=><button key={n.id} className={page===n.id?"nav active":"nav"} onClick={()=>setPage(n.id)}><n.icon size={19}/>{n.label}{page===n.id&&<ChevronRight size={15} className="right"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={18}/>本地优先 · 各平台凭据隔离</div><small>StudyFlow 0.1.0 · Windows 客户端</small></div>
    </aside>
    <main className="main">
      <header><div><span className="eyebrow">STUDYFLOW / WORKSPACE</span><h1>{({home:"学习总览",courses:"我的课程",platforms:"平台连接",settings:"偏好设置"} as Record<Page,string>)[page]}</h1><p className="subtitle">知到与雨课堂，统一管理，数据保持真实。</p></div><button className="theme-button" aria-label="切换主题" onClick={toggleTheme}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button></header>
      {notice&&<div className="notice" role="status">{notice}</div>}
      {page==="home"&&<><div className="hero"><div><span className="pill">{desktop?"本地服务 · 真实数据":"浏览器预览 · 暂无平台连接"}</span><h2>让学习井然有序</h2><p>统一入口、实时读取、明确显示同步结果。</p><button className="primary" onClick={()=>setPage("platforms")}>管理平台连接 <ChevronRight size={17}/></button></div><div className="hero-visual"><GraduationCap size={90} strokeWidth={1}/></div></div><div className="metrics"><div className="metric"><span>已连接平台</span><strong>{Object.values(platforms).filter(p=>p.status==="connected").length} <small>/ 2</small></strong></div><div className="metric"><span>已同步课程</span><strong>{courses.length}</strong></div><div className="metric"><span>本地服务</span><strong className="pending">{desktop?"已启动":"未启动"}</strong></div></div></>}
      {(page==="home"||page==="platforms")&&<section>
        <div className="section-head"><div><h3>学习平台</h3><p>状态来自真实接口检测，不会生成演示课程。</p></div><button className="secondary" disabled={!desktop||Boolean(busy)} onClick={()=>void refresh()}><RefreshCw size={16}/>检测连接</button></div>
        <div className="platform-grid">{(["zhidao","yuketang"] as Platform[]).map(id=><article className="platform-card" key={id}>
          <div className="platform-top"><div className={"platform-logo "+id}>{id==="zhidao"?"知":"雨"}</div><span className="status">{platforms[id].status==="connected"?"已验证":"未连接"}</span></div>
          <h3>{names[id]}</h3><p>{platforms[id].message}</p>
          <div className="actions"><button className="secondary" disabled={!desktop||Boolean(busy)} onClick={()=>void sync(id)}><RefreshCw size={16}/> {busy===id?"正在同步…":"同步课程"}</button>
          
          {id==="yuketang"&&<button className="secondary" disabled={!desktop||Boolean(busy)} onClick={()=>void showVideos()}><PlayCircle size={16}/>章节与视频</button>}
          </div>
        </article>)}</div>
      </section>}
      {(page==="home"||page==="courses")&&<section><div className="section-head"><div><h3>课程列表</h3><p>仅展示已成功从学习平台读取的课程。</p></div>{page==="home"&&<button className="text-button" onClick={()=>setPage("courses")}>查看全部 <ChevronRight size={16}/></button>}</div>
        {page==="courses"&&<div className="filters" role="group" aria-label="课程平台筛选">
          {(["all","zhidao","yuketang"] as const).map(item=><button type="button" key={item}
            className={filter===item?"filter active":"filter"} onClick={()=>{setFilter(item);setSelectedCourse(null);}}>
            {item==="all"?"全部课程":platformNames[item]}
          </button>)}
        </div>}
        {visibleCourses.length?<div className="course-grid">
          {visibleCourses.map(course=><MigratedCourseCard key={course.platform+":"+course.course_id}
            course={course} onInspect={setSelectedCourse}/>)}
        </div>
        :<div className="empty"><BookOpen size={35}/><strong>暂无真实课程数据</strong>
          <span>检测连接并成功同步课程后，这里才会显示实际记录。</span>
          <button className="secondary" onClick={()=>setPage("platforms")}>前往平台连接</button>
        </div>}
        {page==="courses"&&selectedCourse&&<div className="course-v2-detail" role="region" aria-label="课程详情">
          <div><span className="eyebrow">{platformNames[selectedCourse.platform]} / 课程详情</span>
            <h3>{selectedCourse.title}</h3>
            <p>{presentCourse(selectedCourse).detail}；课程视频进度只有真实平台核验后才能展示。</p>
          </div>
          <button type="button" className="secondary" onClick={()=>setSelectedCourse(null)}>关闭</button>
        </div>}
      </section>}
      {page==="platforms"&&<ZhidaoLoginPanel desktop={desktop} busy={Boolean(busy)} onOpenLegacy={()=>void openZhidao()} onOpenQr={()=>setQrOpen(true)}/>}
      {page==="platforms"&&<section className="settings-card"><h3>配置雨课堂当前登录会话</h3><p>仅使用本人已登录的会话；会话保存在 Windows 凭据管理器，不修改原版雨课堂文件。</p>
        <form className="credential-form" onSubmit={e=>void configure(e)}>
          {([{id:"session_id",label:"Session ID",type:"password"},{id:"csrf_token",label:"CSRF Token",type:"password"},{id:"classroom_id",label:"课堂 ID",type:"text"},{id:"university_id",label:"学校 ID",type:"text"},{id:"sign",label:"章节 Sign（可选）",type:"password"}] as const).map(f=><label key={f.id}><span>{f.label}</span><input type={f.type} required={f.id!=="sign"} autoComplete="off" value={config[f.id]} onChange={e=>setConfig(previous=>({...previous,[f.id]:e.target.value}))}/></label>)}
          <div className="actions"><button className="primary" disabled={!desktop||Boolean(busy)} type="submit">保存并验证</button><button className="secondary" type="button" disabled={!desktop||Boolean(busy)} onClick={()=>void clear()}>仅清除学序凭据</button></div>
        </form></section>}
      {page==="platforms"&&videos.length>0&&<section className="settings-card"><h3>雨课堂章节视频</h3><div className="video-list">{videos.map((v,i)=><div key={v.id+":"+i}><small>{v.chapter}</small><strong>{v.name}</strong><span>视频 ID：{v.id}</span></div>)}</div></section>}
      {page==="settings"&&<section className="settings-card"><h3>外观与显示</h3><p>浅色与深色偏好保存于本机，窄窗口自动调整卡片与侧栏；不修改平台数据。</p><button className="secondary" onClick={toggleTheme}>{dark?"切换浅色模式":"切换深色模式"}</button></section>}
      <footer className="studyflow-footer">知到新版 UI 迁移 · 原知到登录与雨课堂凭据功能均保留 · 进度以服务器记录为准</footer>
    </main>
    {qrOpen&&<ZhidaoQrDialog onClose={()=>setQrOpen(false)} onVerified={()=>{setNotice('知到服务器会话核验通过；正在更新连接状态');void refresh()}}/>}
  </div>;
}

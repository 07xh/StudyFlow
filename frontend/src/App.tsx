import {useState} from "react";
import {BookOpen, LayoutDashboard, Settings, ShieldCheck, GraduationCap, RefreshCw, ChevronRight, Moon, Sun} from "lucide-react";
import {initialPlatforms} from "./platforms";
import type {Platform} from "./types";

type Page = "home" | "courses" | "platforms" | "settings";
const names: Record<Platform,string> = {zhidao:"知到",yuketang:"雨课堂"};
export default function App(){
  const [page,setPage]=useState<Page>("home");
  const [dark,setDark]=useState(true);
  const [platforms]=useState(initialPlatforms);
  const courses=Object.values(platforms).flatMap(p=>p.courses);
  const navigation: {id:Page;label:string;icon:typeof BookOpen}[]=[
    {id:"home",label:"总览",icon:LayoutDashboard},{id:"courses",label:"我的课程",icon:BookOpen},
    {id:"platforms",label:"平台连接",icon:ShieldCheck},{id:"settings",label:"设置",icon:Settings}
  ];
  return <div className={dark?"app dark":"app"}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><GraduationCap size={23}/></div><div><strong>学序</strong><small>StudyFlow</small></div></div>
      <div className="section-label">工作空间</div>
      <nav>{navigation.map(n=><button key={n.id} className={page===n.id?"nav active":"nav"} onClick={()=>setPage(n.id)}><n.icon size={19}/>{n.label}{page===n.id&&<ChevronRight size={15} className="right"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={18}/>本地优先 · 独立平台会话</div><small>StudyFlow 0.1.0 · 开发预览</small></div>
    </aside>
    <main className="main">
      <header><div><span className="eyebrow">STUDYFLOW / WORKSPACE</span><h1>{({home:"学习总览",courses:"我的课程",platforms:"平台连接",settings:"偏好设置"} as Record<Page,string>)[page]}</h1><p className="subtitle">知到与雨课堂，统一管理，数据保持真实。</p></div><button className="theme-button" aria-label="切换主题" onClick={()=>setDark(!dark)}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button></header>
      {page==="home"&&<><div className="hero"><div><span className="pill">开发预览 · 未连接真实平台</span><h2>让学习井然有序</h2><p>统一入口、清晰的课程列表与可靠的连接状态。</p><button className="primary" onClick={()=>setPage("platforms")}>查看平台连接 <ChevronRight size={17}/></button></div><div className="hero-visual"><GraduationCap size={90} strokeWidth={1}/></div></div><div className="metrics"><div className="metric"><span>已连接平台</span><strong>{Object.values(platforms).filter(p=>p.status==="connected").length} <small>/ 2</small></strong></div><div className="metric"><span>真实课程</span><strong>{courses.length}</strong></div><div className="metric"><span>数据状态</span><strong className="pending">等待接入</strong></div></div></>}
      {(page==="home"||page==="platforms")&&<section><div className="section-head"><div><h3>学习平台</h3><p>平台状态独立展示，不以本地演示数据代替真实返回。</p></div></div><div className="platform-grid">{(["zhidao","yuketang"] as Platform[]).map(id=><article className="platform-card" key={id}><div className="platform-top"><div className={"platform-logo "+id}>{id==="zhidao"?"知":"雨"}</div><span className="status">未连接</span></div><h3>{names[id]}</h3><p>{platforms[id].message}</p><button className="secondary" disabled title="平台运行时尚未接入"><RefreshCw size={16}/> 等待接入</button></article>)}</div></section>}
      {(page==="home"||page==="courses")&&<section><div className="section-head"><div><h3>课程列表</h3><p>课程仅来自实际平台读取结果。</p></div>{page==="home"&&<button className="text-button" onClick={()=>setPage("courses")}>查看全部 <ChevronRight size={16}/></button>}</div><div className="empty"><BookOpen size={35}/><strong>暂无真实课程数据</strong><span>连接平台并成功读取课程后，将自动显示在这里。</span><button className="secondary" onClick={()=>setPage("platforms")}>前往平台连接</button></div></section>}
      {page==="settings"&&<section className="settings-card"><h3>外观</h3><p>界面主题仅保存在当前运行会话中。</p><button className="secondary" onClick={()=>setDark(!dark)}>{dark?"切换浅色模式":"切换深色模式"}</button></section>}
    </main>
  </div>;
}

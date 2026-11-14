import {useEffect,useState,type ReactNode} from "react";
import {
  Activity,BookOpen,ChevronDown,History,
  LayoutDashboard,Layers3,ListChecks,Moon,
  RefreshCw,Settings,Sun
} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import {NoticeBanner} from "./NoticeBanner";
import {PageSurface} from "./PageSurface";
import "./foundation.css";

export type Page="home"|"courses"|"tasks"|"platforms"|"platform-zhidao"|
  "platform-yuketang"|"records"|"logs"|"settings";
const workspaceNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"home",label:"首页",icon:LayoutDashboard},
  {id:"courses",label:"课程中心",icon:BookOpen},
  {id:"tasks",label:"学习任务",icon:ListChecks},
  {id:"platforms",label:"学习平台",icon:Layers3},
  {id:"records",label:"学习记录",icon:History},
  {id:"logs",label:"日志中心",icon:Activity}
];
const platformNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"platform-zhidao",label:"知到",icon:BookOpen},
  {id:"platform-yuketang",label:"雨课堂",icon:BookOpen}
];
const titles:Record<Page,string>={
  home:"学习总览",courses:"课程中心",tasks:"学习任务",platforms:"学习平台",
  "platform-zhidao":"知到","platform-yuketang":"雨课堂",
  records:"学习记录",logs:"日志中心",settings:"设置"
};

function readPlatformExpanded():boolean{
  try{return window.localStorage.getItem("studyflow.nav.platform-expanded")!=="false";}
  catch{return true;}
}

interface Props {
  page:Page;onNavigate:(next:Page)=>void;dark:boolean;onThemeToggle:()=>void;
  onRefresh:()=>void;desktop:boolean;notice:string;onDismissNotice:()=>void;
  compact:boolean;children:ReactNode;
  headerTitle?:string;
  currentPlatform?:string;
  currentCourseTitle?:string;
  courseProgress?:number|null;
}
export function AppShell({
  page,onNavigate,dark,onThemeToggle,onRefresh,desktop,notice,onDismissNotice,compact,children,headerTitle,currentPlatform,currentCourseTitle,courseProgress
}:Props){
  const [platformExpanded,setPlatformExpanded]=useState(readPlatformExpanded);

  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.platform-expanded",String(platformExpanded));}
    catch{/* The current navigation state remains available for this session. */}
  },[platformExpanded]);
  const platformActive=page==="platforms"||page==="platform-zhidao"||page==="platform-yuketang";
  const renderItem=(item:{id:Page;label:string;icon:LucideIcon},nested=false)=>
    <button key={item.id} type="button" title={item.label} aria-label={item.label}
      aria-current={page===item.id?"page":undefined}
      className={["nav",page===item.id?"active":"",nested?"sf-nav-child":""].filter(Boolean).join(" ")}
      onClick={()=>onNavigate(item.id)}>
      <item.icon size={nested?16:18}/>
      <span className="nav-label">{item.label}</span>
      {page===item.id&&<span className="sf-floating-nav__active-dot" aria-hidden="true"/>}
    </button>;
  const renderItems=(items:typeof workspaceNavigation)=><nav className="sf-floating-nav__nav" aria-label="主导航">
    {items.map(item=>item.id==="platforms"
      ?<div className="sf-platform-nav" key={item.id}>
        <div className="sf-platform-nav-parent">
          <button type="button" title="学习平台" aria-label="学习平台"
            className={["nav",platformActive?"active":""].filter(Boolean).join(" ")}
            aria-current={page==="platforms"?"page":undefined}
            onClick={()=>{setPlatformExpanded(true);onNavigate("platforms");}}>
            <Layers3 size={18}/><span className="nav-label">学习平台</span>
            {page==="platforms"&&<span className="sf-floating-nav__active-dot" aria-hidden="true"/>}
          </button>
          <button type="button" className="sf-nav-expand"
            aria-label={platformExpanded?"收起学习平台":"展开学习平台"}
            aria-expanded={platformExpanded} title={platformExpanded?"收起":"展开"}
            onClick={()=>setPlatformExpanded(current=>!current)}>
            <ChevronDown size={15} className={platformExpanded?"":"sf-chevron-closed"}/>
          </button>
        </div>
        {platformExpanded&&<div className="sf-subnav" role="group" aria-label="平台二级页面">
          {platformNavigation.map(child=>renderItem(child,true))}
        </div>}
      </div>
      :renderItem(item))}
  </nav>;

  return <div className={["app","sf-shell",dark?"dark":"",compact?"sf-compact":""].filter(Boolean).join(" ")}>
    <header className="sf-header sf-workspace-header">
      <div className="sf-workspace-platform" aria-label="当前学习平台">
        <span className="sf-workspace-platform-icon" aria-hidden="true"><Layers3 size={21}/></span>
        <div className="sf-workspace-platform-copy">
          <small>当前学习平台</small>
          <strong>{currentPlatform??"未选择平台"}</strong>
        </div>
      </div>
      <div className="sf-workspace-progress" aria-label="当前课程总进度">
        <div className="sf-workspace-progress-head">
          <div className="sf-workspace-progress-course">
            <small>当前课程总进度</small>
            <strong title={currentCourseTitle??"未选择课程"}>{currentCourseTitle??"未选择课程"}</strong>
          </div>
          <strong className="sf-workspace-progress-value">
            {courseProgress==null?"—":courseProgress.toFixed(1)+"%"}
          </strong>
        </div>
        <div className="sf-workspace-progress-track" role="progressbar"
          aria-label="服务器已核验课程进度" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={courseProgress??undefined}>
          <span style={{width:(courseProgress??0)+"%"}}/>
        </div>
      </div>
      <div className="sf-header-actions">
        <span className="sf-mode"><span className="sf-status-dot"/>
          {desktop?"Windows 桌面":"浏览器预览"}
        </span>
        <button className="theme-button" type="button" title="刷新连接"
          aria-label="刷新连接" disabled={!desktop} onClick={onRefresh}>
          <RefreshCw size={17}/>
        </button>
        <button className="theme-button sf-settings-button" type="button"
          title="设置" aria-label="设置" aria-current={page==="settings"?"page":undefined}
          onClick={()=>onNavigate("settings")}><Settings size={17}/></button>
        <button className="theme-button" type="button"
          aria-label={dark?"切换浅色主题":"切换深色主题"}
          onClick={onThemeToggle}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button>
      </div>
    </header>
    <aside className="sf-floating-nav" aria-label="主导航">
      <div className="sf-floating-nav__heading">功能菜单</div>
      {renderItems(workspaceNavigation)}
    </aside>
    <main className="main" id="main-content">
      <div className="sf-page-heading"><h1>{headerTitle??titles[page]}</h1></div>
      <NoticeBanner message={notice} onDismiss={onDismissNotice}/>
      <PageSurface page={page}>{children}</PageSurface>
    </main>
  </div>;
}

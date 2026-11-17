import type {ConnectionStatus} from "../types";
import type {PlatformProgressOverview} from "../presentation";
import {useEffect,useState,type ReactNode} from "react";
import {
  Activity,BookOpen,ChevronDown,History,
  LayoutDashboard,Layers3,ListChecks,Moon,Minus,Maximize2,X,
  RefreshCw,Settings,Sun
} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {NoticeBanner} from "./NoticeBanner";
import {PageSurface} from "./PageSurface";
import "./foundation.css";

export type Page="home"|"tasks"|"platforms"|"platform-zhidao"|
  "platform-yuketang"|"platform-xuexitong"|"platform-ucampus"|"records"|"logs";
const workspaceNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"home",label:"首页",icon:LayoutDashboard},
  {id:"tasks",label:"学习任务",icon:ListChecks},
  {id:"platforms",label:"学习平台",icon:Layers3},
  {id:"records",label:"学习记录",icon:History},
  {id:"logs",label:"日志中心",icon:Activity}
];
const platformNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"platform-zhidao",label:"知到",icon:BookOpen},
  {id:"platform-yuketang",label:"雨课堂",icon:BookOpen},
  {id:"platform-xuexitong",label:"学习通",icon:BookOpen},
  {id:"platform-ucampus",label:"U校园",icon:BookOpen}
];
const titles:Record<Page,string>={
  home:"学习总览",tasks:"学习任务",platforms:"学习平台",
  "platform-zhidao":"知到","platform-yuketang":"雨课堂","platform-xuexitong":"学习通","platform-ucampus":"U校园",
  records:"学习记录",logs:"日志中心"
};

function readPlatformExpanded():boolean{
  try{return window.localStorage.getItem("studyflow.nav.platform-expanded")!=="false";}
  catch{return true;}
}

interface Props {
  page:Page;onNavigate:(next:Page)=>void;settingsOpen:boolean;onOpenSettings:()=>void;dark:boolean;onThemeToggle:()=>void;
  onRefresh:()=>void;desktop:boolean;notice:string;onDismissNotice:()=>void;
  compact:boolean;children:ReactNode;
  headerTitle?:string;
  currentPlatform?:string;
  currentCourseTitle?:string;
  courseProgress?:number|null;platformOverview?:PlatformProgressOverview|null;selectedCourseId?:string;
  courseOptions?:{id:string;title:string}[];onCourseSelect?:(id:string)=>void;
  metricLabel?:string;courseEvidence?:string;courseVerifiedAt?:string|null;currentPlatformStatus?:ConnectionStatus;
}
export function AppShell({
  page,onNavigate,settingsOpen,onOpenSettings,dark,onThemeToggle,onRefresh,desktop,notice,onDismissNotice,compact,children,headerTitle,currentPlatform,currentCourseTitle,courseProgress,platformOverview,selectedCourseId="",courseOptions=[],onCourseSelect,metricLabel,courseEvidence,courseVerifiedAt,currentPlatformStatus
}:Props){
  const [platformExpanded,setPlatformExpanded]=useState(readPlatformExpanded);

  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.platform-expanded",String(platformExpanded));}
    catch{/* The current navigation state remains available for this session. */}
  },[platformExpanded]);
  const platformActive=page==="platforms"||page==="platform-zhidao"||page==="platform-yuketang"||page==="platform-xuexitong"||page==="platform-ucampus";
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
    <div className="sf-window-titlebar" data-tauri-drag-region aria-label="窗口标题栏">
      <div className="sf-window-titlebar-brand" data-tauri-drag-region>
        <Layers3 size={15} aria-hidden="true"/>
        <span data-tauri-drag-region>学序 · StudyFlow</span>
      </div>
      <div className="sf-window-titlebar-actions">
        <button className="sf-window-control sf-settings-button" type="button"
          title="应用设置（外观、更新与关于）" aria-label="应用设置" aria-haspopup="dialog" aria-expanded={settingsOpen}
          onClick={onOpenSettings}><Settings size={15}/></button>
        <span className="sf-window-control-separator" aria-hidden="true"/>
        <button className="sf-window-control" type="button" disabled={!desktop}
          title="最小化" aria-label="最小化窗口"
          onClick={()=>{if(desktop)void getCurrentWindow().minimize();}}><Minus size={15}/></button>
        <button className="sf-window-control" type="button" disabled={!desktop}
          title="最大化或还原" aria-label="最大化或还原窗口"
          onClick={()=>{if(desktop)void getCurrentWindow().toggleMaximize();}}><Maximize2 size={14}/></button>
        <button className="sf-window-control sf-window-close" type="button" disabled={!desktop}
          title="关闭" aria-label="关闭窗口"
          onClick={()=>{if(desktop)void getCurrentWindow().close();}}><X size={17}/></button>
      </div>
    </div>
    <header className="sf-header sf-workspace-header">
      <div className="sf-workspace-platform" aria-label="当前学习平台">
        <span className="sf-workspace-platform-icon" aria-hidden="true"><Layers3 size={21}/></span>
        <div className="sf-workspace-platform-copy">
          <small>当前学习平台</small>
          <strong>{currentPlatform??"全部平台"}</strong>
          {currentPlatform&&<small className={currentPlatformStatus==="connected"?"sf-connection-confirmed":"sf-connection-pending"}>{currentPlatformStatus==="connected"?"已连接":currentPlatformStatus==="error"?"连接异常":currentPlatformStatus==="connecting"?"连接中":"未连接"}</small>}
        </div>
      </div>
      <div className="sf-workspace-progress" aria-label={currentCourseTitle?"当前课程进度":"平台进度概览"}>
        {page.startsWith("platform-")?<div className="sf-workspace-progress-layout">
          <div className="sf-workspace-progress-summary">
            <div className="sf-workspace-progress-head">
              <div className="sf-workspace-progress-course">
                <small>{currentCourseTitle?metricLabel??"当前课程进度":platformOverview?.label??"平台课程进度概览"}</small>
                <strong title={currentCourseTitle??currentPlatform??""}>{currentCourseTitle??"全部课程"}</strong>
              </div>
              <strong className="sf-workspace-progress-value">
                {(currentCourseTitle?courseProgress:platformOverview?.percent)==null
                  ?"—":(currentCourseTitle?courseProgress!:platformOverview!.percent!).toFixed(1)+"%"}
              </strong>
            </div>
            {(currentCourseTitle?courseProgress:platformOverview?.percent)!=null&&
              <div className="sf-workspace-progress-track" role="progressbar"
                aria-label={currentCourseTitle?metricLabel??"当前课程进度":platformOverview?.label??"平台课程进度"}
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={(currentCourseTitle?courseProgress:platformOverview?.percent)??0}>
                <span style={{width:((currentCourseTitle?courseProgress:platformOverview?.percent)??0)+"%"}}/>
              </div>}
            <div className="sf-header-evidence">
              <span>{currentCourseTitle?courseEvidence??"待核验":platformOverview?.detail??"暂无课程进度数据"}</span>
              {currentCourseTitle&&<time>{courseVerifiedAt&&Number.isFinite(Date.parse(courseVerifiedAt))
                ?new Date(courseVerifiedAt).toLocaleString():"暂无核验时间"}</time>}
            </div>
          </div>
          <label className="sf-header-course-picker">选择课程
            <select aria-label="选择课程或全部课程" value={selectedCourseId}
              disabled={!courseOptions.length} onChange={event=>onCourseSelect?.(event.target.value)}>
              <option value="">{courseOptions.length?"全部课程":"请先同步课程"}</option>
              {courseOptions.map(course=><option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
          </label>
        </div>:<div className="sf-workspace-empty-progress">
          <div><small>当前页面</small><strong>{titles[page]}</strong></div>
        </div>}
      </div>
      <div className="sf-header-actions">
        <span className="sf-mode">
          {desktop?"Windows 桌面":"浏览器预览"}
        </span>
        <button className="theme-button" type="button" title="检测平台连接"
          aria-label="检测平台连接" disabled={!desktop} onClick={onRefresh}>
          <RefreshCw size={17}/>
        </button>
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
      <div className="sf-page-heading sf-sr-only"><h1>{headerTitle??titles[page]}</h1></div>
      <NoticeBanner message={notice} onDismiss={onDismissNotice}/>
      <PageSurface page={page}>{children}</PageSurface>
    </main>
  </div>;
}

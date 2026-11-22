import {useEffect,useId,useMemo,useRef,useState,type KeyboardEvent,type MouseEvent,type ReactNode} from "react";
import {getVersion} from "@tauri-apps/api/app";
import {invoke} from "@tauri-apps/api/core";
import {ArrowLeft,BookOpen,CheckCircle2,ChevronLeft,ChevronRight,ExternalLink,FileCode2,FileText,Globe2,Info,Layers3,Scale,Search,ShieldCheck} from "lucide-react";
import {friendlyBridgeError,type ZhidaoDocument} from "../bridge";
import {findLegalMatches,LEGAL_SEARCH_MAX_HIGHLIGHTS} from "./legalDocumentSearch";
import "./aboutOpenSource.css";

type Section="overview"|"source";
type DocumentId="terms"|"privacy"|"license"|"source";
type SourceKind="repository"|"releases"|"zhs"|"yuketang"|"chaoxing";
const sourceLinks:Readonly<Record<SourceKind,string>>={
  repository:"https://github.com/07xh/StudyFlow",
  releases:"https://github.com/07xh/StudyFlow/releases",
  zhs:"https://github.com/pjm314159/zhs",
  yuketang:"https://github.com/07xh/yuketang-heartbeat",
  chaoxing:"https://github.com/Samueli924/chaoxing",
};
const licenses=[
  {id:"license" as const,title:"GNU GPL v3 开源许可",detail:"完整许可证正文",icon:Scale},
  {id:"source" as const,title:"原版源码与来源",detail:"知到、雨课堂、学习通及许可来源登记",icon:FileCode2},
  {id:"terms" as const,title:"使用条款与第三方声明",detail:"产品与平台之间的关系",icon:FileText},
  {id:"privacy" as const,title:"隐私政策与数据说明",detail:"本机数据和凭据的处理方式",icon:ShieldCheck},
];
const upstream=[
  {kind:"repository" as const,title:"StudyFlow 源码",detail:"应用、前端与构建代码",note:"项目主仓库"},
  {kind:"zhs" as const,title:"ZHS",detail:"知到原版 Python 项目",note:"上游 · GPL-3.0"},
  {kind:"yuketang" as const,title:"雨课堂原版项目",detail:"07xh/yuketang-heartbeat · 原版任务与配置来源",note:"原版源码"},
  {kind:"chaoxing" as const,title:"Samueli924/chaoxing",detail:"学习通实现的源码来源记录",note:"上游 · GPL v3"},
];

/** Product-level About & Open Source workspace, independent of Zhidao account tools. */
export function AboutOpenSourcePanel({desktop,onOpenDeveloper}:{
  desktop:boolean;onOpenDeveloper:()=>void;
}){
  const [section,setSection]=useState<Section>("overview");
  const [version,setVersion]=useState<string|undefined>(undefined);
  const [viewer,setViewer]=useState<ZhidaoDocument|null>(null);
  const [reading,setReading]=useState<DocumentId|null>(null);
  const [error,setError]=useState("");
  const [linkError,setLinkError]=useState("");
  const [documentQuery,setDocumentQuery]=useState("");
  const [activeMatch,setActiveMatch]=useState(0);
  const searchId=useId(),overviewTabId=useId(),sourceTabId=useId(),overviewPanelId=useId(),sourcePanelId=useId();
  const tabRefs=useRef<Array<HTMLButtonElement|null>>([]);
  const requestRevision=useRef(0);
  const previousDocument=useRef<DocumentId|null>(null);
  const backButton=useRef<HTMLButtonElement|null>(null);
  const root=useRef<HTMLElement|null>(null);
  const matches=useMemo(()=>findLegalMatches(viewer?.content??"",documentQuery),[viewer?.content,documentQuery]);
  const highlighted=useMemo<ReactNode>(()=>{
    if(!viewer||matches.positions.length===0)return viewer?.content??"";
    const spans:ReactNode[]=[];
    let offset=0;
    matches.positions.forEach((hit,index)=>{
      spans.push(viewer.content.slice(offset,hit.start));
      spans.push(<mark key={index} data-legal-match={index}
        className={index===activeMatch?"sf-about-match-active":undefined}>
        {viewer.content.slice(hit.start,hit.end)}
      </mark>);
      offset=hit.end;
    });
    spans.push(viewer.content.slice(offset));
    return spans;
  },[viewer,matches,activeMatch]);

  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    void getVersion().then(value=>{if(active)setVersion(value);})
      .catch(()=>{if(active)setVersion("");});
    return ()=>{active=false;};
  },[desktop]);
  useEffect(()=>()=>{requestRevision.current+=1;},[]);
  useEffect(()=>{
    if(!viewer||typeof window==="undefined")return;
    const frame=window.requestAnimationFrame(()=>backButton.current?.focus());
    return ()=>window.cancelAnimationFrame(frame);
  },[viewer]);

  useEffect(()=>{
    if(!viewer||!documentQuery.trim()||!matches.positions[activeMatch])return;
    root.current?.querySelector<HTMLElement>(`mark[data-legal-match="${activeMatch}"]`)
      ?.scrollIntoView?.({block:"center",behavior:"auto"});
  },[viewer,documentQuery,activeMatch,matches]);

  function scrollTop(){
    const container=root.current?.closest(".sf-global-settings-content");
    if(container)container.scrollTop=0;
  }
  function switchSection(next:Section){
    requestRevision.current+=1;
    setSection(next);setViewer(null);setReading(null);setError("");setLinkError("");
    setDocumentQuery("");setActiveMatch(0);
    scrollTop();
  }
  function onTabKey(event:KeyboardEvent<HTMLButtonElement>,current:Section){
    let next:Section|undefined;
    if(event.key==="Home")next="overview";
    else if(event.key==="End")next="source";
    else if(event.key==="ArrowRight"||event.key==="ArrowLeft")
      next=current==="overview"?"source":"overview";
    if(!next)return;
    event.preventDefault();
    switchSection(next);
    tabRefs.current[next==="overview"?0:1]?.focus();
  }
  async function openDocument(id:DocumentId){
    if(!desktop||reading)return;
    const revision=++requestRevision.current;
    previousDocument.current=id;
    setReading(id);setError("");setViewer(null);
    setDocumentQuery("");setActiveMatch(0);
    try{
      const data=await invoke<ZhidaoDocument>("studyflow_read_document",{documentId:id});
      if(revision!==requestRevision.current)return;
      if(data.id!==id||typeof data.title!=="string"||typeof data.content!=="string")
        throw new Error("INVALID_DOCUMENT");
      setViewer(data);
      scrollTop();
    }catch(cause){
      if(revision===requestRevision.current)setError(friendlyBridgeError(cause));
    }finally{
      if(revision===requestRevision.current)setReading(null);
    }
  }
  function closeDocument(){
    requestRevision.current+=1;
    setViewer(null);setReading(null);setError("");
    setDocumentQuery("");setActiveMatch(0);
    scrollTop();
    const previous=previousDocument.current;
    if(typeof window!=="undefined")window.requestAnimationFrame(()=>{
      if(previous)root.current?.querySelector<HTMLButtonElement>(`button[data-document-id="${previous}"]`)?.focus();
    });
  }
  function openExternal(event:MouseEvent<HTMLAnchorElement>,kind:SourceKind){
    if(!desktop)return;
    event.preventDefault();setLinkError("");
    const operation=kind==="releases"?"studyflow_open_releases":"studyflow_open_source_site";
    const params=kind==="releases"?{}:{kind};
    void invoke(operation,params).catch(()=>{
      setLinkError("暂时无法打开外部页面，请检查系统默认浏览器后重试。");
    });
  }

  return <section ref={root} className="sf-about-workspace" aria-label="关于与开源">
    <header className="sf-about-identity">
      <span className="sf-about-identity-mark" aria-hidden="true"><Layers3 size={25}/></span>
      <div className="sf-about-identity-copy">
        <span className="sf-about-overline">STUDYFLOW · WINDOWS</span>
        <h2>学序 <span>StudyFlow</span></h2>
        <p>把课程信息、学习任务和进度核验集中在同一个桌面工作台。</p>
      </div>
      <span className="sf-about-version" aria-label="当前版本">{!desktop?"Windows 桌面端":version===undefined?"读取版本中":version?"v"+version:"版本暂不可用"}</span>
    </header>

    <div className="sf-about-tabs" role="tablist" aria-label="关于页面分类">
      <button ref={element=>{tabRefs.current[0]=element;}} type="button" role="tab"
        id={overviewTabId} aria-controls={overviewPanelId} tabIndex={section==="overview"?0:-1}
        aria-selected={section==="overview"} onKeyDown={event=>onTabKey(event,"overview")}
        className={section==="overview"?"active":""} onClick={()=>switchSection("overview")}>
        <Info size={15}/>产品概览
      </button>
      <button ref={element=>{tabRefs.current[1]=element;}} type="button" role="tab"
        id={sourceTabId} aria-controls={sourcePanelId} tabIndex={section==="source"?0:-1}
        aria-selected={section==="source"} onKeyDown={event=>onTabKey(event,"source")}
        className={section==="source"?"active":""} onClick={()=>switchSection("source")}>
        <BookOpen size={15}/>开源与许可
      </button>
    </div>

    {viewer
      ?<section className="sf-about-reader" role="tabpanel" id={sourcePanelId}
        aria-labelledby={sourceTabId} aria-label="法律文档阅读"
        onKeyDown={event=>{
          if(event.key==="Escape"){event.preventDefault();event.stopPropagation();closeDocument();}
        }}>
        <div className="sf-about-reader-heading">
          <button ref={backButton} type="button" className="sf-about-back"
            onClick={closeDocument}><ArrowLeft size={15}/>返回开源与许可</button>
          <h3>{viewer.title}</h3>
        </div>
        <div className="sf-about-search" role="search" aria-label="在法律文档中查找">
          <label htmlFor={searchId}><Search size={15}/>文内查找</label>
          <input id={searchId} type="search" value={documentQuery} maxLength={80}
            placeholder="查找关键词、协议条款或项目名"
            onChange={event=>{setDocumentQuery(event.currentTarget.value);setActiveMatch(0);}}/>
          <span className="sf-about-search-count" role="status" aria-live="polite">
            {!documentQuery.trim()?"输入关键词":matches.total===0?"没有匹配":
              matches.total>matches.positions.length
                ?`第 ${activeMatch+1} / ${matches.positions.length} 处（共 ${matches.total} 处，仅定位前 ${LEGAL_SEARCH_MAX_HIGHLIGHTS} 处）`
                :`第 ${activeMatch+1} / ${matches.total} 处`}
          </span>
          <div className="sf-about-search-nav">
            <button type="button" aria-label="上一处匹配" title="上一处匹配"
              disabled={!matches.positions.length}
              onClick={()=>setActiveMatch(current=>(current-1+matches.positions.length)%matches.positions.length)}>
              <ChevronLeft size={16}/>
            </button>
            <button type="button" aria-label="下一处匹配" title="下一处匹配"
              disabled={!matches.positions.length}
              onClick={()=>setActiveMatch(current=>(current+1)%matches.positions.length)}>
              <ChevronRight size={16}/>
            </button>
          </div>
        </div>
        <pre className="sf-about-document-text">{highlighted}</pre>
      </section>
      :section==="overview"
      ?<div className="sf-about-overview" role="tabpanel" id={overviewPanelId} aria-labelledby={overviewTabId}>
        <section className="sf-about-section">
          <h3>关于项目</h3>
          <p>StudyFlow 是独立开发的 Windows 学习助手，整合知到、雨课堂、学习通与 U校园的相关功能。各平台的本地任务状态与服务器核验结果分别展示，不将本地执行等同于官方完成记录。</p>
          <dl className="sf-about-facts">
            <div><dt>运行方式</dt><dd>Windows 桌面应用</dd></div>
            <div><dt>技术组成</dt><dd>Tauri · React · Python</dd></div>
            <div><dt>开源许可</dt><dd>GNU GPL v3</dd></div>
          </dl>
        </section>
        <section className="sf-about-section">
          <h3>项目入口</h3>
          <div className="sf-about-destinations">
            <a href={sourceLinks.repository} target="_blank" rel="noopener noreferrer"
              onClick={event=>openExternal(event,"repository")}>
              <FileCode2 size={18}/><span><strong>项目源码</strong><small>GitHub · 07xh/StudyFlow</small></span><ExternalLink size={15}/>
            </a>
            <a href={sourceLinks.releases} target="_blank" rel="noopener noreferrer"
              onClick={event=>openExternal(event,"releases")}>
              <CheckCircle2 size={18}/><span><strong>发行版本</strong><small>安装包与更新说明</small></span><ExternalLink size={15}/>
            </a>
            <button type="button" onClick={onOpenDeveloper}>
              <Globe2 size={18}/><span><strong>开发者网站</strong><small>在独立设置页面查看</small></span><ChevronRight size={15}/>
            </button>
          </div>
        </section>
        <p className="sf-about-disclaimer">独立第三方项目，不代表相关教学平台官方。开源项目来源和许可证详见「开源与许可」。</p>
      </div>
      :<div className="sf-about-source" role="tabpanel" id={sourcePanelId} aria-labelledby={sourceTabId}>
        <section className="sf-about-section">
          <div className="sf-about-section-heading">
            <h3>源代码与第三方来源</h3><span>保留出处与许可</span>
          </div>
          <div className="sf-about-source-list">
            {upstream.map(item=><a key={item.kind} href={sourceLinks[item.kind]}
              target="_blank" rel="noopener noreferrer"
              onClick={event=>openExternal(event,item.kind)}>
              <FileCode2 size={18}/>
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              <em>{item.note}</em><ExternalLink size={15}/>
            </a>)}
          </div>
          <p className="sf-about-hint">源码引用与修改记录以仓库中的来源登记为准；使用第三方项目不代表获得相应教学平台的官方授权。</p>
        </section>
        <section className="sf-about-section">
          <h3>许可与说明文档</h3>
          <div className="sf-about-legal-list">
            {licenses.map(item=><button key={item.id} type="button" data-document-id={item.id}
              disabled={!desktop||Boolean(reading)}
              onClick={()=>void openDocument(item.id)}>
              <item.icon size={18}/>
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              {reading===item.id?<span className="sf-about-loading">读取中…</span>:<ChevronRight size={16}/>}
            </button>)}
          </div>
          {!desktop&&<p className="sf-about-hint">完整随包法律文档需要在 Windows 桌面版中读取。</p>}
          {error&&<p role="alert" className="sf-about-error">{error}</p>}
        </section>
      </div>}
    {linkError&&<p role="alert" className="sf-about-error">{linkError}</p>}
  </section>;
}

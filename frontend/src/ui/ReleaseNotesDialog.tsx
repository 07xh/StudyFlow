import {useEffect,useState} from "react";
import {CheckCircle2,ExternalLink,History,RefreshCw,Sparkles} from "lucide-react";
import {OFFICIAL_RELEASES_URL,openOfficialReleases} from "../releaseNavigation";
import type {ReleaseChangelogEntry} from "../bridge";
import type {NotesDialogState} from "../useReleaseChangelog";
import {SettingsDialog} from "./SettingsDialog";
import "./releaseNotes.css";

function TextNotes({notes}:{notes:string}){
  if(!notes.trim())return <p className="sf-release-empty">本次 GitHub Release 未填写更新说明，可打开官方发布页查看。</p>;
  return <div className="sf-release-markdown">
    {notes.split(/\r?\n/).slice(0,220).map((source,index)=>{
      const line=source.trim();
      if(!line)return <div className="sf-release-gap" key={index}/>;
      const clean=(value:string)=>value.replace(/\*\*(.*?)\*\*/g,"$1").replace(/`([^`]+)`/g,"$1");
      const heading=/^#{1,5}\s+(.*)$/.exec(line);
      if(heading)return <h4 key={index}>{clean(heading[1])}</h4>;
      const bullet=/^(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
      if(bullet)return <p className="sf-release-bullet" key={index}><span aria-hidden="true">•</span>{clean(bullet[1])}</p>;
      return <p key={index}>{clean(line)}</p>;
    })}
  </div>;
}
function ReleaseCard({entry}:{entry:ReleaseChangelogEntry}){
  const when=entry.published_at?new Date(entry.published_at):null;
  const date=when&&!Number.isNaN(when.valueOf())?when.toLocaleDateString("zh-CN"):"";
  return <article className="sf-release-entry">
    <header>
      <div><strong>{entry.title||"学序 "+entry.version}</strong><span>{entry.version}</span></div>
      {date&&<time dateTime={entry.published_at}>{date}</time>}
    </header>
    <TextNotes notes={entry.notes}/>
  </article>;
}
export function ReleaseNotesDialog({state,dark,onClose,onOpenUpdates,onRetry}:{
  state:NotesDialogState|null;dark:boolean;onClose:()=>void;
  onOpenUpdates:()=>void;onRetry:()=>void;
}){
  const scope=state?.scope??"startup";
  const [browserError,setBrowserError]=useState("");
  useEffect(()=>{setBrowserError("");},[state?.scope,state?.version,state!==null]);
  const available=scope==="available";
  const startup=scope==="startup";
  return <SettingsDialog open={state!==null} dark={dark} compact
    kicker={available?"新版本 / 发布提醒":startup?"新版本 / 安装完成":"关于学序 / 版本记录"}
    title={available?"发现新版本":startup?"学序已更新":"历史更新日志"} onClose={onClose}>
    {state&&<div className="sf-release-notes">
      <div className="sf-release-summary">
        <span className="sf-release-icon">{scope==="history"?<History size={22}/>:<Sparkles size={22}/>}</span>
        <div><strong>{available?"学序有新版本可用":startup?"欢迎使用新版本":"学序版本记录"}</strong>
          <p>{available
            ?`当前版本：${state.installedVersion||"未知"} · 最新版本：${state.version}。以下是 GitHub Release 发布说明。`
            :startup?`当前安装版本：${state.version}。以下为本次更新内容。`
            :`当前安装版本：${state.version}。查看该版本及之前的官方更新记录。`}</p>
        </div>
      </div>
      <div className="sf-release-entries" aria-live="polite">
        {state.loading?<p className="sf-release-feedback">正在读取更新日志…</p>:
          state.error?<p className="sf-release-feedback" role="status">暂时无法获取 GitHub 更新日志，且没有匹配的内置说明。可以重试或打开官方发布页；不影响使用学序。</p>:
          state.entries.length===0?<p className="sf-release-feedback" role="status">当前版本尚无可匹配的已发布更新说明，暂不显示未经确认的改动。</p>:
          <>
            {state.source==="bundled"&&<p className="sf-release-feedback">当前网络无法读取 GitHub，以下是此安装包内置的候选版更新说明，可能与线上记录不同。</p>}
            {state.entries.length>1&&<p className="sf-release-merged"><CheckCircle2 size={15}/>包含 {state.entries.length} 个版本的更新内容</p>}
            {state.entries.map(entry=><ReleaseCard key={entry.version} entry={entry}/>)}
          </>}
      </div>
      <footer className="sf-release-actions">
        <a href={OFFICIAL_RELEASES_URL} target="_blank" rel="noopener noreferrer"
          onClick={event=>void openOfficialReleases(event,setBrowserError)}>
          <ExternalLink size={14}/>GitHub 完整记录
        </a>
        <div className="sf-release-action-buttons">
          {state.error&&<button type="button" className="secondary" onClick={onRetry}>
            <RefreshCw size={14}/>重新获取
          </button>}
          {available?<><button type="button" className="secondary" onClick={onClose}>暂不更新</button>
            <button type="button" className="primary" onClick={onOpenUpdates}>查看更新</button></>:
            <button type="button" className="primary" onClick={onClose}>
              {startup?"开始体验新版本":"关闭"}
            </button>}
        </div>
      </footer>
      {browserError&&<p role="status" className="sf-release-feedback">{browserError}</p>}
    </div>}
  </SettingsDialog>;
}

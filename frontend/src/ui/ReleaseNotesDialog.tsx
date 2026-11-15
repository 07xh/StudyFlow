import {useEffect,useState} from "react";
import {CheckCircle2,ExternalLink,History,Sparkles} from "lucide-react";
import {OFFICIAL_RELEASES_URL,openOfficialReleases} from "../releaseNavigation";
import type {ReleaseChangelogEntry} from "../bridge";
import type {NotesDialogState} from "../useReleaseChangelog";
import {SettingsDialog} from "./SettingsDialog";
import "./releaseNotes.css";

function TextNotes({notes}:{notes:string}){
  if(!notes.trim())return <p className="sf-release-empty">该版本未填写更新说明，请查看官方发布页。</p>;
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
export function ReleaseNotesDialog({state,dark,onClose}:{
  state:NotesDialogState|null;dark:boolean;onClose:()=>void;
}){
  const scope=state?.scope??"startup";
  const [browserError,setBrowserError]=useState("");
  useEffect(()=>{setBrowserError("");},[state?.scope,state?.version,state!==null]);
  return <SettingsDialog open={state!==null} dark={dark} compact
    kicker={scope==="startup"?"新版本 / 首次启动":"关于学序 / 版本记录"}
    title={scope==="startup"?"学序已更新":"历史更新日志"} onClose={onClose}>
    {state&&<div className="sf-release-notes">
      <div className="sf-release-summary">
        <span className="sf-release-icon">{scope==="startup"?<Sparkles size={22}/>:<History size={22}/>}</span>
        <div><strong>{scope==="startup"?"欢迎使用新版本":"学序版本记录"}</strong>
          <p>当前安装版本：{state.version}。{scope==="startup"?"以下是 GitHub 已发布的实际更新内容。":"查看当前版本及之前的官方更新记录。"}</p>
        </div>
      </div>
      <div className="sf-release-entries" aria-live="polite">
        {state.loading?<p className="sf-release-feedback">正在读取官方更新日志…</p>:
          state.error?<p className="sf-release-feedback" role="status">暂时无法获取 GitHub 更新日志，可打开官方发布页查看。此问题不影响使用学序。</p>:
          state.entries.length===0?<p className="sf-release-feedback" role="status">当前版本尚无可匹配的已发布更新说明，暂不显示未经确认的改动。</p>:
          <>{state.entries.length>1&&<p className="sf-release-merged"><CheckCircle2 size={15}/>包含 {state.entries.length} 个版本的已发布更新内容</p>}
          {state.entries.map(entry=><ReleaseCard key={entry.version} entry={entry}/>)}</>}
      </div>
      <footer className="sf-release-actions">
        <a href={OFFICIAL_RELEASES_URL} target="_blank" rel="noopener noreferrer"
          onClick={event=>void openOfficialReleases(event,setBrowserError)}>
          <ExternalLink size={14}/>GitHub 完整记录
        </a>
        <button type="button" className="primary" onClick={onClose}>
          {scope==="startup"?"开始体验新版本":"关闭"}
        </button>
      </footer>
      {browserError&&<p role="status" className="sf-release-feedback">{browserError}</p>}
    </div>}
  </SettingsDialog>;
}

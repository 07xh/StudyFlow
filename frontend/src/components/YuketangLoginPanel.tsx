import type {FormEvent} from "react";
import {BookOpen,KeyRound,RefreshCw,ShieldCheck,Trash2} from "lucide-react";
import type {Config,Video} from "../bridge";

const fields=[
  {id:"session_id",label:"Session ID",secret:true,required:true},
  {id:"csrf_token",label:"CSRF Token",secret:true,required:true},
] as const;

type FieldId=keyof Config;
type Props={
  config:Config;
  desktop:boolean;
  busy:boolean;
  connected:boolean;
  videos:Video[];
  onChange:(field:FieldId,value:string)=>void;
  onSubmit:()=>void;
  onClear:()=>void;
  onShowVideos:()=>void;
};

export function YuketangLoginPanel({config,desktop,busy,connected,videos,onChange,onSubmit,onClear,onShowVideos}:Props){
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    onSubmit();
  }
  return <div className="sf-platform-login">
    <div className="sf-login-panel-main">
      <div className="sf-login-panel-heading">
        <span className="sf-login-symbol"><KeyRound size={19}/></span>
        <div><h4>雨课堂会话配置</h4>
          <p>凭据保存到 Windows 凭据管理器</p>
        </div>
        <span className={connected?"sf-login-state connected":"sf-login-state"}>
          <ShieldCheck size={14}/>{connected?"接口验证通过":"等待验证"}
        </span>
      </div>
      <form className="sf-ykt-form" onSubmit={submit}>
        {fields.map(field=><label key={field.id}>
          <span>{field.label}</span>
          <input type={field.secret?"password":"text"} required={field.required}
            autoComplete="off" spellCheck={false} value={config[field.id]}
            onChange={event=>onChange(field.id,event.target.value)}/>
        </label>)}
        {(!config.classroom_id||!config.university_id)&&<p className="sf-muted">先在 <a href="#sf-ykt-content">课堂范围与内容</a> 填写课堂 ID 和学校 ID，再保存会话。</p>}
        <div className="sf-login-actions">
          <button className="primary" type="submit" disabled={!desktop||busy}>
            <ShieldCheck size={16}/>保存会话与课堂配置
          </button>
          <button className="secondary" type="button" disabled={!desktop||busy}
            onClick={onClear}><Trash2 size={16}/>清除学序凭据</button>
        </div>
      </form>
    </div>

  </div>;
}

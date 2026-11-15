import {useState,type FormEvent} from "react";
import {KeyRound,ShieldCheck,Trash2} from "lucide-react";
import type {Config} from "../bridge";
import {yuketangScopeIssues} from "../yuketangScopeValidation";

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
  onChange:(field:FieldId,value:string)=>void;
  onSubmit:()=>void;
  onOpenScope:()=>void;
  onClear:()=>void;
};

export function YuketangLoginPanel({config,desktop,busy,connected,onChange,onSubmit,onOpenScope,onClear}:Props){
  const [attempted,setAttempted]=useState(false);
  const issues=yuketangScopeIssues(config);
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(issues.length){
      setAttempted(true);
      return;
    }
    setAttempted(false);
    onSubmit();
  }
  return <div className="sf-platform-login">
    <div className="sf-login-panel-main">
      <div className="sf-login-panel-heading">
        <span className="sf-login-symbol"><KeyRound size={19}/></span>
        <div><h4>会话凭据</h4>
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
        {issues.length>0&&<div className={"sf-ykt-scope-prerequisite"+(attempted?" is-invalid":"")}
          role={attempted?"alert":"status"}>
          <strong>{attempted?"尚未保存：课堂信息不完整":"保存前需要补齐课堂信息"}</strong>
          <p>{issues.join("；")}。当前输入的 Session ID 和 CSRF Token 会保留。</p>
          <button className="secondary" type="button" disabled={!desktop||busy}
            onClick={onOpenScope}>前往填写课堂 ID、学校 ID</button>
        </div>}
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

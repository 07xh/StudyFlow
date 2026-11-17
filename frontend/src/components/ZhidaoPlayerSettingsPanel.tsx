import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {friendlyBridgeError,request,type ZhidaoPlayerSettings} from '../bridge';
import type {TaskRecorder} from '../activity';
import {Switch} from '../ui/Switch';
const SPEED_PRESETS=['0.5','0.75','1','1.25','1.5','2','2.5','3','4'];
const validSpeed=(speed:string)=>/^(?:0\.[5-9][0-9]?|[1-3](?:\.[0-9]{1,2})?|4(?:\.0{1,2})?)$/.test(speed);
export function ZhidaoPlayerSettingsPanel({desktop,onEvent}:{desktop:boolean;onEvent?:TaskRecorder}){
 const [saved,setSaved]=useState<ZhidaoPlayerSettings|null>(null);
 const [draft,setDraft]=useState<ZhidaoPlayerSettings|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const revision=useRef(0);
 const load=useCallback(async()=>{
  if(!desktop)return;const current=++revision.current;setBusy(true);setMessage('');
  try{const value=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.get'});if(current===revision.current){setSaved(value);setDraft(value);}}
  catch(error){if(current===revision.current)setMessage(friendlyBridgeError(error));}
  finally{if(current===revision.current)setBusy(false);}
 },[desktop]);
 useEffect(()=>{void load();return ()=>{revision.current++;};},[load]);
 const dirty=JSON.stringify(draft)!==JSON.stringify(saved);
 const speedValid=!!draft&&validSpeed(draft.speed);
 function update<K extends keyof ZhidaoPlayerSettings>(key:K,value:ZhidaoPlayerSettings[K]){setDraft(previous=>previous?{...previous,[key]:value}:null);}
 async function save(){
  if(!draft||busy||!speedValid)return;setBusy(true);setMessage('');
  try{
   const current=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.get'});
   const value=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.save',settings:{...draft,mode:current.mode}});
   setSaved(value);setDraft(value);setMessage('默认参数已保存，下次启动播放器时生效。');
   onEvent?.('保存播放器默认参数','success','下次启动时生效');
  }catch(error){setMessage(friendlyBridgeError(error));}finally{setBusy(false);}
 }
 async function prepare(){
  setBusy(true);setMessage('正在检查并准备播放组件…');
  try{await invoke('zhidao_player_prepare');setMessage('播放组件已准备完成。');}
  catch(error){setMessage(friendlyBridgeError(error));}finally{setBusy(false);}
 }
 return <section className="settings-card sf-player-defaults">
  <div className="section-head"><h3>官方播放器默认参数</h3><span>{dirty?'有未保存修改':'下次启动生效'}</span></div>
  {draft?<><div className="sf-zd-player-settings">
   <label>目标倍速（0.5–4×）<input type="number" min={0.5} max={4} step={0.01} value={draft.speed} disabled={busy} onChange={event=>update('speed',event.target.value)}/></label>
   <label>常用倍速<select disabled={busy} value={SPEED_PRESETS.includes(draft.speed)?draft.speed:''} onChange={event=>update('speed',event.target.value)}><option value="" disabled>自定义</option>{SPEED_PRESETS.map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label>
   <label>允许最小化窗口<Switch disabled={busy} checked={draft.allowMinimize} onChange={value=>update('allowMinimize',value)}/></label>
   <label>进入视频后自动播放<Switch disabled={busy} checked={draft.autoStart} onChange={value=>update('autoStart',value)}/></label>
   <label>本节结束后自动下一节<Switch disabled={busy} checked={draft.autoNext} onChange={value=>update('autoNext',value)}/></label>
  </div><p className="sf-muted">自定义值可精确到 0.01×。是否生效以官网 HTML5 播放器报告的实际倍速为准。</p>
  {!speedValid&&<p role="alert" className="sf-validation-error">请输入 0.5–4 之间的倍速，最多两位小数。</p>}<div className="actions">
   <button className="primary" disabled={busy||!dirty||!speedValid} onClick={()=>void save()}>保存默认参数</button>
   <button className="secondary" disabled={busy||!dirty} onClick={()=>{setDraft(saved);setMessage('');}}>撤销修改</button>
  </div></>:<p>{desktop?'等待读取本机参数':'请在 Windows 桌面版配置参数'}</p>}
  <button className="text-button" disabled={!desktop||busy||dirty} onClick={()=>void load()}>重新读取默认参数</button>
  <details className="sf-environment-tools"><summary>播放环境检查</summary><p>首次运行或播放组件异常时使用。</p><button className="secondary" disabled={!desktop||busy} onClick={()=>void prepare()}>检查 / 准备 WebView2</button></details>
  {message&&<p role="status">{message}</p>}
 </section>;
}

import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {friendlyBridgeError,request,type ZhidaoPlayerSettings} from '../bridge';
import type {TaskRecorder} from '../activity';
import {Switch} from '../ui/Switch';
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
 function update<K extends keyof ZhidaoPlayerSettings>(key:K,value:ZhidaoPlayerSettings[K]){setDraft(previous=>previous?{...previous,[key]:value}:null);}
 async function save(){
  if(!draft||busy)return;setBusy(true);setMessage('');
  try{
   const current=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.get'});
   const value=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.save',settings:{...draft,mode:current.mode}});
   const confirmed=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.get'});
   if(JSON.stringify(confirmed)!==JSON.stringify(value))throw new Error('PLAYER_SETTINGS_VERIFY_FAILED');
   setSaved(confirmed);setDraft(confirmed);setMessage('默认参数已保存，下次启动播放器时生效。');
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
   <label>播放倍速<select disabled={busy} value={draft.speed} onChange={event=>update('speed',event.target.value as ZhidaoPlayerSettings['speed'])}>{['1','1.25','1.5','2'].map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label>
   <label>允许最小化窗口<Switch disabled={busy} checked={draft.allowMinimize} onChange={value=>update('allowMinimize',value)}/></label>
   <label>进入视频后自动播放<Switch disabled={busy} checked={draft.autoStart} onChange={value=>update('autoStart',value)}/></label>
   <label>本节结束后自动下一节<Switch disabled={busy} checked={draft.autoNext} onChange={value=>update('autoNext',value)}/></label>
  </div><div className="actions">
   <button className="primary" disabled={busy||!dirty} onClick={()=>void save()}>保存默认参数</button>
   <button className="secondary" disabled={busy||!dirty} onClick={()=>{setDraft(saved);setMessage('');}}>撤销修改</button>
  </div></>:<p>{desktop?'等待读取本机参数':'请在 Windows 桌面版配置参数'}</p>}
  <button className="text-button" disabled={!desktop||busy||dirty} onClick={()=>void load()}>重新读取默认参数</button>
  <details className="sf-environment-tools"><summary>播放环境检查</summary><p>首次运行或播放组件异常时使用。</p><button className="secondary" disabled={!desktop||busy} onClick={()=>void prepare()}>检查 / 准备 WebView2</button></details>
  {message&&<p role="status">{message}</p>}
 </section>;
}

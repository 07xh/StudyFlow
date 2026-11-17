import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {friendlyBridgeError,request,type ZhidaoPlayerSettings} from '../bridge';
import type {TaskRecorder} from '../activity';
import {Switch} from '../ui/Switch';
import {SPEED_PRESETS,normalizePlayerSpeedInput} from '../playerSpeed';
export function ZhidaoPlayerSettingsPanel({desktop,onEvent}:{desktop:boolean;onEvent?:TaskRecorder}){
 const [saved,setSaved]=useState<ZhidaoPlayerSettings|null>(null);
 const [draft,setDraft]=useState<ZhidaoPlayerSettings|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [speedTouched,setSpeedTouched]=useState(false);
 const revision=useRef(0);
 const load=useCallback(async()=>{
  if(!desktop)return;const current=++revision.current;setBusy(true);setMessage('');
  try{const value=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.get'});if(current===revision.current){setSaved(value);setDraft(value);setSpeedTouched(false);}}
  catch(error){if(current===revision.current)setMessage(friendlyBridgeError(error));}
  finally{if(current===revision.current)setBusy(false);}
 },[desktop]);
 useEffect(()=>{void load();return ()=>{revision.current++;};},[load]);
 const dirty=JSON.stringify(draft)!==JSON.stringify(saved);
 const canonicalSpeed=draft?normalizePlayerSpeedInput(draft.speed):null;
 const speedValid=canonicalSpeed!==null;
 function update<K extends keyof ZhidaoPlayerSettings>(key:K,value:ZhidaoPlayerSettings[K]){setDraft(previous=>previous?{...previous,[key]:value}:null);}
 async function save(){
  const normalized=draft?normalizePlayerSpeedInput(draft.speed):null;
  if(!draft||busy||!normalized){setSpeedTouched(true);return;}
  setBusy(true);setMessage('');
  try{
   const current=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.get'});
   const value=await request<ZhidaoPlayerSettings>({operation:'zhidao.player.settings.save',settings:{...draft,speed:normalized,mode:current.mode}});
   setSaved(value);setDraft(value);setSpeedTouched(false);setMessage('默认参数已保存，下次启动播放器时生效。');
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
   <label>自定义倍速（0.5–4×）
    <input className="sf-zd-speed-input" type="text" inputMode="decimal"
      autoComplete="off" spellCheck={false} maxLength={6}
      aria-label="键盘直接输入播放倍速" aria-invalid={!speedValid}
      aria-describedby="sf-zd-speed-hint"
      placeholder="例如 1.75" value={draft.speed} disabled={busy||!desktop}
      onFocus={event=>event.currentTarget.select()}
      onChange={event=>{update('speed',event.currentTarget.value);setSpeedTouched(false);}}
      onBlur={event=>{const normalized=normalizePlayerSpeedInput(event.currentTarget.value);if(normalized)update('speed',normalized);setSpeedTouched(true);}}
      onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();void save();}}}/>
   </label>
   <label>常用倍速<select disabled={busy||!desktop} value={SPEED_PRESETS.includes(draft.speed)?draft.speed:''} onChange={event=>update('speed',event.target.value)}><option value="" disabled>自定义</option>{SPEED_PRESETS.map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label>
   <label>允许最小化窗口<Switch disabled={busy} checked={draft.allowMinimize} onChange={value=>update('allowMinimize',value)}/></label>
   <label>进入视频后自动播放<Switch disabled={busy} checked={draft.autoStart} onChange={value=>update('autoStart',value)}/></label>
   <label>本节结束后自动下一节<Switch disabled={busy} checked={draft.autoNext} onChange={value=>update('autoNext',value)}/></label>
  </div><p id="sf-zd-speed-hint" className="sf-muted">可直接用键盘输入小数，按 Enter 保存，或选择常用档位。输入精度 0.01×；实际倍速以播放器采样为准。</p>
  {!speedValid&&speedTouched&&<p role="alert" className="sf-validation-error">请输入 0.5–4 之间的倍速，最多两位小数。</p>}<div className="actions">
   <button className="primary" disabled={busy||!dirty||!speedValid||!desktop} onClick={()=>void save()}>保存默认参数</button>
   <button className="secondary" disabled={busy||!dirty} onClick={()=>{setDraft(saved);setSpeedTouched(false);setMessage('');}}>撤销修改</button>
  </div></>:<p>{desktop?'等待读取本机参数':'请在 Windows 桌面版配置参数'}</p>}
  <button className="text-button" disabled={!desktop||busy||dirty} onClick={()=>void load()}>重新读取默认参数</button>
  <details className="sf-environment-tools"><summary>播放环境检查</summary><p>首次运行或播放组件异常时使用。</p><button className="secondary" disabled={!desktop||busy} onClick={()=>void prepare()}>检查 / 准备 WebView2</button></details>
  {message&&<p role="status">{message}</p>}
 </section>;
}

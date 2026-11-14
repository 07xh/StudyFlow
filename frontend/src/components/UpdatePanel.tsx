import {useEffect,useRef,useState} from "react";
import {getVersion} from "@tauri-apps/api/app";
import {invoke} from "@tauri-apps/api/core";
import {Download,FolderOpen,RefreshCw} from "lucide-react";
import {request,type AvailableUpdate,type UpdateSettings} from "../bridge";

export function UpdatePanel({desktop,visible,onDownloaded}:{
  desktop:boolean;visible:boolean;onDownloaded:(message:string)=>void;
}){
  const [settings,setSettings]=useState<UpdateSettings>({channel:"stable",mode:"download"});
  const [current,setCurrent]=useState("");
  const [release,setRelease]=useState<AvailableUpdate|null>(null);
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [downloaded,setDownloaded]=useState("");
  const [message,setMessage]=useState("");
  const notify=useRef(onDownloaded);
  notify.current=onDownloaded;

  async function download(version:string,update:AvailableUpdate){
    const result=await request<{filename:string;sha256:string}>({operation:"updates.download",
      current_version:version,release_version:update.version});
    setDownloaded(result.filename);
    const text="新版本已下载并通过 SHA-256 校验，可在设置中打开更新目录安装。";
    setMessage(text);notify.current(text);
  }

  async function check(version:string,preference:UpdateSettings){
    setDownloaded("");setRelease(null);setMessage("正在检查更新…");
    const result=await request<{release:AvailableUpdate|null}>({operation:"updates.check",current_version:version});
    setRelease(result.release);
    if(!result.release){setMessage("暂无更新的已发布版本。");return;}
    setMessage(result.release.downloadable?"发现新版本。":"新版本尚未提供可校验的 Windows x64 安装包。");
    if(preference.mode==="download"&&result.release.downloadable){
      setMessage("正在下载并校验更新…");
      await download(version,result.release);
    }
  }

  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    setBusy(true);
    void Promise.all([getVersion(),request<UpdateSettings>({operation:"updates.settings.get"})])
      .then(async([version,preference])=>{
        if(!active)return;
        setCurrent(version);setSettings(preference);setLoaded(true);
        await check(version,preference);
      }).catch(()=>{if(active)setMessage("更新检查未完成，请检查网络后重试。");})
      .finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[desktop]);

  async function save(next:UpdateSettings){
    setBusy(true);
    try{
      setSettings(await request<UpdateSettings>({operation:"updates.settings.save",settings:next}));
      setRelease(null);setDownloaded("");setMessage("更新偏好已保存，点击检查更新以应用。");
    }catch{setMessage("无法保存更新偏好，请重试。");}
    finally{setBusy(false);}
  }

  async function perform(action:()=>Promise<void>){
    setBusy(true);
    try{await action();}
    catch{setMessage("更新操作未完成，请检查网络、发布文件和校验信息后重试。");}
    finally{setBusy(false);}
  }

  return <section className="settings-card" hidden={!visible}>
    <div className="section-head"><h3>版本与更新</h3><span>{current?"v"+current:"Windows 桌面版"}</span></div>
    <div className="sf-settings-line"><label htmlFor="update-channel">更新通道</label>
      <select id="update-channel" value={settings.channel} disabled={!desktop||busy||!loaded}
        onChange={e=>void save({...settings,channel:e.target.value as UpdateSettings["channel"]})}>
        <option value="stable">稳定版</option><option value="beta">Beta 版</option>
      </select></div>
    <div className="sf-settings-line"><label htmlFor="update-mode">下载方式</label>
      <select id="update-mode" value={settings.mode} disabled={!desktop||busy||!loaded}
        onChange={e=>void save({...settings,mode:e.target.value as UpdateSettings["mode"]})}>
        <option value="notify">A · 仅提示</option><option value="download">B · 后台下载并校验</option>
      </select></div>
    <div className="actions">
      <button className="secondary" disabled={!desktop||busy} onClick={()=>void perform(async()=>{
        const version=current||await getVersion();setCurrent(version);
        const preference=await request<UpdateSettings>({operation:"updates.settings.get"});
        setSettings(preference);setLoaded(true);await check(version,preference);
      })}><RefreshCw size={15}/>{busy?"处理中…":"检查更新"}</button>
      {release?.downloadable&&!downloaded&&<button className="primary" disabled={busy}
        onClick={()=>void perform(()=>download(current,release))}><Download size={15}/>下载 {release.version}</button>}
      {downloaded&&<button className="secondary" disabled={busy}
        onClick={()=>void perform(async()=>{await invoke("updates_open_folder");})}>
        <FolderOpen size={15}/>打开更新目录</button>}
    </div>
    {message&&<p role="status">{message}</p>}
    {release&&<div><strong>{release.version}</strong><p style={{whiteSpace:"pre-wrap"}}>{release.notes}</p></div>}
    {downloaded&&<p>{downloaded} · 关闭学序后运行安装包</p>}
  </section>;
}

import {useEffect,useRef,useState} from "react";
import {getVersion} from "@tauri-apps/api/app";
import {invoke} from "@tauri-apps/api/core";
import {Download,FolderOpen,History,RefreshCw} from "lucide-react";
import {friendlyUpdateError,request,type AvailableUpdate,type UpdateSettings} from "../bridge";
import {OFFICIAL_RELEASES_URL,openOfficialReleases,openLatestRelease} from "../releaseNavigation";

export function UpdatePanel({desktop,visible,onDownloaded,onOpenChangelog,embedded=false}:{
  desktop:boolean;visible:boolean;onDownloaded:(message:string)=>void;onOpenChangelog:()=>void;embedded?:boolean;
}){
  const [settings,setSettings]=useState<UpdateSettings>({channel:"beta",mode:"download",source:"auto",fallback:true});
  const [current,setCurrent]=useState("");
  const [sources,setSources]=useState<{github:boolean;proxy:boolean}>({github:true,proxy:true});
  const [release,setRelease]=useState<AvailableUpdate|null>(null);
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [downloaded,setDownloaded]=useState("");
  const [message,setMessage]=useState("");
  const notify=useRef(onDownloaded);
  notify.current=onDownloaded;

  async function download(version:string,update:AvailableUpdate){
    const result=await request<{filename:string;sha256:string;source:"github"|"gh-proxy.com"|"ghfast.top"|"cache"}>({operation:"updates.download",
      current_version:version,release_version:update.version});
    setDownloaded(result.filename);
    const used=result.source==="gh-proxy.com"?"gh-proxy.com":result.source==="ghfast.top"?"ghfast.top":result.source==="github"?"GitHub 官方源":"已缓存的校验通过安装包";
    const text="新版本已下载并通过 SHA-256 校验（"+used+"），可在设置中打开更新目录安装。";
    setMessage(text);notify.current(text);
  }

  async function check(version:string,preference:UpdateSettings){
    setRelease(null);setMessage("正在检查更新…");
    const result=await request<{release:AvailableUpdate|null}>({operation:"updates.check",current_version:version});
    setRelease(result.release);
    if(!result.release){
      setMessage(preference.channel==="stable"
        ?"稳定版通道当前没有检测到更新。RC 预发布版本请切换到 Beta 通道；本机版本请以顶部版本号为准。"
        :"没有检测到比本机版本更新的 Beta 发布版；若已下载安装包，仍需手动安装。");
      return;
    }
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
    void Promise.all([getVersion(),request<UpdateSettings>({operation:"updates.settings.get"}),request<{github:boolean;proxy:boolean}>({operation:"updates.sources"})])
      .then(async([version,preference,available])=>{
        if(!active)return;
        setCurrent(version);setSettings(preference);setSources(available);setLoaded(true);
        await check(version,preference);
      }).catch(error=>{if(active)setMessage(friendlyUpdateError(error));})
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
    catch(error){setMessage(friendlyUpdateError(error));}
    finally{setBusy(false);}
  }

  return <section className="settings-card" hidden={!visible}>
    <div className="section-head">{!embedded&&<h3>版本与更新</h3>}<span>{current?"v"+current:"Windows 桌面版"}</span></div>
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
    <div className="sf-settings-line"><label htmlFor="update-source">安装包下载源</label>
      <select id="update-source" value={settings.source} disabled={!desktop||busy||!loaded}
        onChange={e=>void save({...settings,source:e.target.value as UpdateSettings["source"]})}>
        <option value="auto">自动（公共代理优先，GitHub 兜底）</option>
        <option value="github">GitHub 官方源</option>
        <option value="proxy">国内公共 GitHub 代理</option>
      </select></div>
    <div className="sf-settings-line"><label htmlFor="update-fallback">故障切换</label>
      <label className="sf-inline-check"><input id="update-fallback" type="checkbox" checked={settings.fallback}
        disabled={!desktop||busy||!loaded}
        onChange={e=>void save({...settings,fallback:e.target.checked})}/>下载失败时自动尝试另一下载源</label></div>
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
    <p className="muted">当前版本 {current||"读取中"} · 更新包不会自动安装；手动安装后重启生效。</p>
    <div className="actions">
      <button className="secondary" type="button" disabled={!desktop||!current} onClick={onOpenChangelog}>
        <History size={15}/>历史更新日志
      </button>
      <a href={OFFICIAL_RELEASES_URL} target="_blank" rel="noopener noreferrer" onClick={event=>void openLatestRelease(event,setMessage)}>GitHub 最新版</a>
      <a href={OFFICIAL_RELEASES_URL} target="_blank" rel="noopener noreferrer" onClick={event=>void openOfficialReleases(event,setMessage)}>全部历史版本</a>
    </div>
    {release&&<div><strong>{release.version}</strong><p style={{whiteSpace:"pre-wrap"}}>{release.notes}</p></div>}
    {downloaded&&<p>{downloaded} · 关闭学序后运行安装包</p>}
  </section>;
}

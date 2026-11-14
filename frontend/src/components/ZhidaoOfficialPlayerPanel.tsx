import {useCallback,useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {CirclePlay,Download,RefreshCw,Square,ShieldCheck} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoPlayerSettings,type ZhidaoProgressSnapshot} from "../bridge";
import type {Course} from "../types";
import {Switch} from "../ui/Switch";

type PlayerStatus={
  state:"idle"|"running"|"exited"|"stopped";
  courseKey:string|null;
  runId:string|null;
  exitCode:number|null;
  event:string|null;
  positionSeconds:number|null;
  durationSeconds:number|null;
  visible:boolean|null;
  observedAt:string|null;
  message:string;
};
type Props={
  courses:Course[];
  desktop:boolean;
  onCoursesUpdated:(courses:Course[])=>void;
  onEvent?:(action:string,result:"success"|"warning",detail:string)=>void;
  courseId?:string;
  detailMode?:boolean;
};
const defaults:ZhidaoPlayerSettings={
  speed:"1.5",allowMinimize:true,autoStart:true,autoNext:true,mode:"official"
};
const speeds:["1","1.25","1.5","2"]=["1","1.25","1.5","2"];
const initialStatus:PlayerStatus={
  state:"idle",courseKey:null,runId:null,exitCode:null,event:null,positionSeconds:null,
  durationSeconds:null,visible:null,observedAt:null,message:"官方播放器尚未启动"
};
function timeLabel(value:number|null){
  if(value===null||!Number.isFinite(value)||value<0)return "—";
  const seconds=Math.floor(value);
  return Math.floor(seconds/60).toString().padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
}
function playerError(error:unknown){
  const code=error instanceof Error?error.message:"";
  if(code.includes("PLAYER_ALREADY_RUNNING"))return "官方播放器已经运行，请先关闭当前窗口。";
  if(code.includes("PLAYER_RUNNING"))return "请先关闭官方播放器，再清理网页登录数据。";
  if(code.includes("WEBVIEW2_SDK_UNAVAILABLE"))return "WebView2 组件准备失败；检查网络后可重试，原版播放器仍支持官方浏览器回退。";
  if(code.includes("PLAYER_RESOURCES_UNAVAILABLE"))return "安装包缺少官方播放器资源，请重新安装学序。";
  if(code.includes("COURSE_ROUTE_UNAVAILABLE"))return "该课程没有完整的官方播放路由，请重新同步课程。";
  if(code.includes("COURSE_NOT_FOUND"))return "当前登录会话中找不到这门课程，请重新同步。";
  if(code.includes("PLAYER_LAUNCH_FAILED"))return "官方播放器窗口启动失败。";
  return friendlyBridgeError(error);
}
export function ZhidaoOfficialPlayerPanel({courses,desktop,onCoursesUpdated,onEvent,courseId,detailMode=false}:Props){
  const [settings,setSettings]=useState<ZhidaoPlayerSettings>(defaults);
  const [selected,setSelected]=useState("");
  const [status,setStatus]=useState<PlayerStatus>(initialStatus);
  const [busy,setBusy]=useState<"prepare"|"start"|"stop"|"save"|null>(null);
  const [message,setMessage]=useState("");
  const [settingsLoaded,setSettingsLoaded]=useState(false);
  const [observations,setObservations]=useState<Array<{event:string;position:number;at:string}>>([]);
  const lastObservation=useRef("");
  const active= status.state==="running";

  useEffect(()=>{
    if(courseId){
      if(courses.some(course=>course.course_id===courseId)&&selected!==courseId)setSelected(courseId);
      return;
    }
    if(!courses.some(course=>course.course_id===selected))
      setSelected(courses[0]?.course_id??"");
  },[courses,selected,courseId]);

  useEffect(()=>{
    if(!desktop)return;
    let live=true;
    void request<ZhidaoPlayerSettings>({operation:"zhidao.player.settings.get"})
      .then(value=>{if(live){setSettings({...defaults,...value});setSettingsLoaded(true);}})
      .catch(error=>{if(live){setMessage(playerError(error));setSettingsLoaded(true);}});
    return ()=>{live=false;};
  },[desktop]);

  const refreshStatus=useCallback(async()=>{
    if(!desktop)return;
    try{
      const next=await invoke<PlayerStatus>("zhidao_player_status");
      setStatus(next);
      if(next.event&&next.positionSeconds!==null){
        const key=[next.event,next.positionSeconds,next.visible,next.observedAt].join(":");
        if(lastObservation.current!==key){
          lastObservation.current=key;
          setObservations(previous=>[{event:next.event!,position:next.positionSeconds!,at:next.observedAt||new Date().toISOString()},...previous].slice(0,10));
        }
      }
    }catch(error){
      setMessage(playerError(error));
    }
  },[desktop]);

  useEffect(()=>{
    void refreshStatus();
    if(!desktop)return;
    const timer=window.setInterval(()=>{void refreshStatus();},2000);
    return ()=>window.clearInterval(timer);
  },[desktop,refreshStatus]);

  function update<K extends keyof ZhidaoPlayerSettings>(key:K,value:ZhidaoPlayerSettings[K]){
    setSettings(previous=>({...previous,[key]:value}));
  }

  async function saveSettings(){
    setBusy("save");setMessage("");
    try{
      const stored=await request<ZhidaoPlayerSettings>({operation:"zhidao.player.settings.get"});
      const saved=await request<ZhidaoPlayerSettings>({
        operation:"zhidao.player.settings.save",settings:{...settings,mode:stored.mode}
      });
      setSettings(saved);setMessage("知到官方播放器设置已保存。");
      onEvent?.("保存播放参数","success","设置已保存到本机");
    }catch(error){
      const result=playerError(error);setMessage(result);
      onEvent?.("保存播放参数","warning",result);
    }finally{setBusy(null);}
  }

  async function prepare(){
    setBusy("prepare");setMessage("正在准备官方 WebView2 播放组件，首次运行可能需要下载。");
    try{
      await invoke<boolean>("zhidao_player_prepare");
      setMessage("WebView2 组件已准备完成。");
      onEvent?.("准备 WebView2","success","官方播放器组件已就绪");
    }catch(error){
      const result=playerError(error);setMessage(result);
      onEvent?.("准备 WebView2","warning",result);
    }finally{setBusy(null);}
  }

  async function start(){
    if(!selected)return;
    setBusy("start");setMessage("");
    try{
      const next=await invoke<PlayerStatus>("zhidao_player_start",{
        courseKey:selected,speed:settings.speed,allowMinimize:settings.allowMinimize,
        autoStart:settings.autoStart,autoNext:settings.autoNext
      });
      setStatus(next);
      const result="已启动原版官方 WebView2 播放器。请在网页内登录并进入课程；实际播放以页面状态为准。";
      setMessage(result);onEvent?.("启动官方播放器","success",result);
    }catch(error){
      const result=playerError(error);setMessage(result);
      onEvent?.("启动官方播放器","warning",result);
    }finally{setBusy(null);}
  }

  async function stop(){
    setBusy("stop");setMessage("");
    try{
      const next=await invoke<PlayerStatus>("zhidao_player_stop");
      setStatus(next);
      const result="已停止学序启动的官方播放器；可手动核验服务器课程记录。";
      setMessage(result);onEvent?.("停止官方播放器","success",result);
    }catch(error){
      const result=playerError(error);setMessage(result);
      onEvent?.("停止官方播放器","warning",result);
    }finally{setBusy(null);}
  }

  const current=courses.find(course=>course.course_id===selected);
  const position=timeLabel(status.positionSeconds);
  const duration=timeLabel(status.durationSeconds);
  const localPercent=status.positionSeconds!==null&&status.durationSeconds!==null&&status.durationSeconds>0
    ?Math.min(100,Math.max(0,status.positionSeconds/status.durationSeconds*100)):null;

  return <section className="legacy-playback-panel sf-zhidao-official-panel">
    <div className="section-head">
      <div><h3><CirclePlay size={17}/> {detailMode?"播放状态与参数调整":"知到官方 WebView2 播放器"}</h3></div>
      <span className={"legacy-run-state"+(active?" active":"")}>
        {active?"官方播放器运行中":status.state==="exited"?"播放器已退出":status.state==="stopped"?"已停止":"未启动"}
      </span>
    </div>
    <div className="sf-zd-official-grid">
      {detailMode
        ?<div className="sf-zd-official-course"><span>当前课程</span><strong>{current?.title??"课程未同步"}</strong></div>
        :<label className="sf-zd-official-course">
          选择课程
          <select value={selected} onChange={event=>setSelected(event.target.value)}
            disabled={!courses.length||active||busy!==null}>
            {courses.length===0&&<option value="">暂无已同步课程</option>}
            {courses.map(course=><option key={course.course_id} value={course.course_id}>
              {course.title} · {course.course_type==="ai"?"智慧课程":"共享课"}
            </option>)}
          </select>
        </label>}
      <div className="sf-zd-player-state">
        <span>本机播放器观测</span>
        <strong>{status.positionSeconds===null?"等待视频":position+" / "+duration}</strong>
        {!detailMode&&localPercent!==null&&<div className="sf-zd-local-track" role="progressbar"
          aria-label="本机 HTML5 视频播放位置" aria-valuemin={0} aria-valuemax={100} aria-valuenow={localPercent}>
          <span style={{width:localPercent+"%"}}/>
        </div>}
        <small>{status.message}</small>
      </div>
    </div>
    <div className="sf-zd-player-settings">
      <label>目标倍速
        <select value={settings.speed} disabled={!settingsLoaded||busy!==null}
          onChange={event=>update("speed",event.target.value as ZhidaoPlayerSettings["speed"])}>
          {speeds.map(speed=><option key={speed} value={speed}>{speed}×</option>)}
        </select>
      </label>
      <label><span>允许最小化窗口</span>
        <Switch checked={settings.allowMinimize} disabled={!settingsLoaded||busy!==null}
          onChange={checked=>update("allowMinimize",checked)}/>
      </label>
      <label><span>进入视频后自动播放</span>
        <Switch checked={settings.autoStart} disabled={!settingsLoaded||busy!==null}
          onChange={checked=>update("autoStart",checked)}/>
      </label>
      <label><span>本节结束后自动下一节</span>
        <Switch checked={settings.autoNext} disabled={!settingsLoaded||busy!==null}
          onChange={checked=>update("autoNext",checked)}/>
      </label>
    </div>
    <div className="sf-zd-progress-actions">
      <button className="primary" type="button" disabled={!desktop||!selected||active||busy!==null}
        onClick={()=>void start()}>
        <CirclePlay size={15}/>{busy==="start"?"启动中…":"打开官方播放器"}
      </button>
      <button className="secondary" type="button" disabled={!desktop||busy!==null}
        onClick={()=>void prepare()}>
        <Download size={15}/>{busy==="prepare"?"准备中…":"准备 WebView2"}
      </button>
      <button className="secondary" type="button" disabled={!desktop||!active||busy!==null}
        onClick={()=>void stop()}>
        <Square size={14}/>{busy==="stop"?"停止中…":"停止播放器"}
      </button>
      <button className="secondary" type="button" disabled={!desktop||busy!==null}
        onClick={()=>void saveSettings()}>
        <ShieldCheck size={15}/>{busy==="save"?"保存中…":"保存参数"}
      </button>
      <button className="secondary" type="button" disabled={!desktop||busy!==null}
        onClick={()=>void refreshStatus()}>
        <RefreshCw size={15}/>刷新状态
      </button>
    </div>
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    {detailMode
      ?<div className="sf-zd-local-observations sf-zd-local-observations-expanded">
        <strong>本机播放观测 · {observations.length}</strong>
        {observations.length===0?<p>尚无可用的 HTML5 播放观测。</p>
          :<ul>{observations.map((item,index)=><li key={index}>
            <strong>{item.event}</strong><span>{timeLabel(item.position)}</span>
            <time>{new Date(item.at).toLocaleTimeString()}</time>
          </li>)}</ul>}
      </div>
      :<details className="sf-zd-local-observations">
        <summary>展开本地播放观测（{observations.length}）</summary>
        {observations.length===0?<p>尚无可用的 HTML5 播放观测。</p>
          :<ul>{observations.map((item,index)=><li key={index}>
            <strong>{item.event}</strong><span>{timeLabel(item.position)}</span>
            <time>{new Date(item.at).toLocaleTimeString()}</time>
          </li>)}</ul>}
      </details>}
    <p className="sf-zd-progress-note">
      {current?.course_type==="shared"?"共享课使用原始课程路由；":"智慧课程使用课程与班级 ID。"}
      仅控制官网顶层页面识别到的主视频；本机播放位置不是服务器学习进度。自动下一节无法安全识别时会要求手动切换。
      正常关闭 WebView2 后会自动进行一次单课只读核验；若回退到系统浏览器则需手动核验。
    </p>
  </section>;
}

import {sameStatusSnapshot} from "../statusSnapshot";
import {useCallback,useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {CirclePlay,RefreshCw,Square} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoPlayerSettings} from "../bridge";
import type {Course} from "../types";
import type {ActivityEntry,TaskRecorder} from "../activity";
import {RunParameters} from "./RunParameters";

export type PlayerStatus={
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
  onEvent?:TaskRecorder;
  courseId?:string;
  detailMode?:boolean;
  events?:ActivityEntry[];
  onOpenTasks?:()=>void;
};
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
  if(code.includes("TASK_RUN_CHANGED"))return "运行任务已变化，请刷新状态后再操作。";
  if(code.includes("PLAYER_ALREADY_RUNNING"))return "官方播放器已经运行，请先关闭当前窗口。";
  if(code.includes("PLAYER_RUNNING"))return "请先关闭官方播放器，再清理网页登录数据。";
  if(code.includes("WEBVIEW2_SDK_UNAVAILABLE"))return "WebView2 组件准备失败；检查网络后可重试，原版播放器仍支持官方浏览器回退。";
  if(code.includes("PLAYER_RESOURCES_UNAVAILABLE"))return "安装包缺少官方播放器资源，请重新安装学序。";
  if(code.includes("COURSE_ROUTE_UNAVAILABLE"))return "该课程没有完整的官方播放路由，请重新同步课程。";
  if(code.includes("COURSE_NOT_FOUND"))return "当前登录会话中找不到这门课程，请重新同步。";
  if(code.includes("PLAYER_LAUNCH_FAILED"))return "官方播放器窗口启动失败。";
  return friendlyBridgeError(error);
}
export function ZhidaoOfficialPlayerPanel({courses,desktop,onEvent,courseId,detailMode=false,events=[],onOpenTasks}:Props){
  const [selected,setSelected]=useState("");
  const [status,setStatus]=useState<PlayerStatus>(initialStatus);
  const [busy,setBusy]=useState<"prepare"|"start"|"stop"|"save"|null>(null);
  const [message,setMessage]=useState("");
  const [settingsLoaded,setSettingsLoaded]=useState(false);
  const [observations,setObservations]=useState<Array<{event:string;position:number;at:string;courseKey:string;runId:string}>>([]);
  const lastObservation=useRef("");
  const selectedRef=useRef(selected);
  selectedRef.current=courseId??selected;
  const statusRevision=useRef(0);
  const statusInFlight=useRef(false);
  const actionInFlight=useRef(false);
  const active= status.state==="running";
  const ownsStatus=Boolean(selected&&status.courseKey===selected);
  const runningCourse=courses.find(course=>course.course_id===status.courseKey);
  const viewObservations=ownsStatus?observations.filter(item=>item.courseKey===selected&&item.runId===status.runId):[];

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
      .then(()=>{if(live)setSettingsLoaded(true);})
      .catch(error=>{if(live){setMessage(playerError(error));setSettingsLoaded(true);}});
    return ()=>{live=false;};
  },[desktop]);

  const refreshStatus=useCallback(async()=>{
    if(!desktop||statusInFlight.current||actionInFlight.current)return;
    statusInFlight.current=true;
    const revision=++statusRevision.current;
    let timeoutId:number|undefined;
    try{
      // Do not let one hung native read freeze the official player's panel.
      const next=await Promise.race<PlayerStatus>([
        invoke<PlayerStatus>("zhidao_player_status"),
        new Promise<never>((_,reject)=>{
          timeoutId=window.setTimeout(()=>reject(new Error("PLAYER_STATUS_TIMEOUT")),15000);
        })
      ]);
      if(revision!==statusRevision.current||actionInFlight.current)return;
      setStatus(previous=>sameStatusSnapshot(previous,next)?previous:next);
      if(next.event&&next.positionSeconds!==null&&next.courseKey&&next.runId&&next.courseKey===selectedRef.current){
        const key=[next.runId,next.courseKey,next.event,next.positionSeconds,next.visible,next.observedAt].join(":");
        if(lastObservation.current!==key){
          lastObservation.current=key;
          setObservations(previous=>[{event:next.event!,position:next.positionSeconds!,at:next.observedAt||new Date().toISOString(),courseKey:next.courseKey!,runId:next.runId!},...previous].slice(0,10));
        }
      }
    }catch(error){
      if(revision===statusRevision.current&&!actionInFlight.current){
        // Last observation is not live playback while native status is unknown.
        setStatus(previous=>{
          const unknown={...previous,event:null,visible:null,positionSeconds:null,durationSeconds:null,observedAt:null,message:"播放器状态暂不可读取；不代表播放已停止"};
          return sameStatusSnapshot(previous,unknown)?previous:unknown;
        });
        setMessage(error instanceof Error&&error.message==="PLAYER_STATUS_TIMEOUT"
          ?"官方播放器状态查询超时；播放位置待重新读取。":playerError(error));
      }
    }finally{
      if(timeoutId!==undefined)window.clearTimeout(timeoutId);
      statusInFlight.current=false;
    }
  },[desktop]);

  useEffect(()=>{
    void refreshStatus();
    if(!desktop)return;
    const timer=window.setInterval(()=>{void refreshStatus();},2000);
    return ()=>{statusRevision.current++;window.clearInterval(timer);};
  },[desktop,refreshStatus]);

  async function start(){
    if(!selected||actionInFlight.current)return;
    actionInFlight.current=true;
    statusRevision.current++;
    setBusy("start");setMessage("");
    try{
      // The settings dialog can save while this player panel stays mounted.
      // Fetch the persisted version for every NEW playback, not a stale mount-time copy.
      // Fail closed if the read fails rather than silently start with old defaults.
      const currentSettings=await request<ZhidaoPlayerSettings>({operation:"zhidao.player.settings.get"});
      const next=await invoke<PlayerStatus>("zhidao_player_start",{
        courseKey:selected,speed:currentSettings.speed,allowMinimize:currentSettings.allowMinimize,
        autoStart:currentSettings.autoStart,autoNext:currentSettings.autoNext
      });
      setStatus(next);
      const result="已启动原版官方 WebView2 播放器。请在网页内登录并进入课程；实际播放以页面状态为准。";
      setMessage(result);onEvent?.("启动官方播放器","success",result,{courseId:selected,runId:next.runId??undefined,runner:"official",parameters:{speed:currentSettings.speed,allowMinimize:currentSettings.allowMinimize,autoStart:currentSettings.autoStart,autoNext:currentSettings.autoNext}});
    }catch(error){
      const result=playerError(error);setMessage(result);
      onEvent?.("启动官方播放器","warning",result,{courseId:selected,runner:"official"});
    }finally{actionInFlight.current=false;setBusy(null);void refreshStatus();}
  }

  async function stop(){
    if(!ownsStatus||!active||!status.runId||actionInFlight.current)return;
    actionInFlight.current=true;
    statusRevision.current++;
    setBusy("stop");setMessage("");
    try{
      const latest=await invoke<PlayerStatus>("zhidao_player_status");
      if(latest.courseKey!==selected||latest.runId!==status.runId||latest.state!=="running"){
        setStatus(latest);setMessage("运行任务已变化，请查看学习任务后再操作。");return;
      }
      const next=await invoke<PlayerStatus>("zhidao_player_stop",{expectedRunId:status.runId});
      setStatus(next);
      const result="已停止学序启动的官方播放器；可手动核验服务器课程记录。";
      setMessage(result);onEvent?.("停止官方播放器","success",result,{courseId:latest.courseKey??undefined,runId:latest.runId??undefined,runner:"official"});
    }catch(error){
      const result=playerError(error);setMessage(result);
      onEvent?.("停止官方播放器","warning",result,{courseId:status.courseKey??undefined,runId:status.runId??undefined,runner:"official"});
    }finally{actionInFlight.current=false;setBusy(null);void refreshStatus();}
  }

  const current=courses.find(course=>course.course_id===selected);
  const position=timeLabel(ownsStatus?status.positionSeconds:null);
  const duration=timeLabel(ownsStatus?status.durationSeconds:null);
  const localPercent=ownsStatus&&status.positionSeconds!==null&&status.durationSeconds!==null&&status.durationSeconds>0
    ?Math.min(100,Math.max(0,status.positionSeconds/status.durationSeconds*100)):null;

  return <section className="legacy-playback-panel sf-zhidao-official-panel">
    <div className="section-head">
      <div><h3><CirclePlay size={17}/> {detailMode?"官方播放器运行状态":"知到官方 WebView2 播放器"}</h3></div>
      <span className={"legacy-run-state"+(active?" active":"")}>
        {active?(ownsStatus?"当前课程正在播放":"其他课程任务运行中"):status.state==="exited"?"播放器已退出":status.state==="stopped"?"已停止":"未启动"}
      </span>
    </div>
    {active&&!ownsStatus&&<p className="sf-task-context" role="status">
      {runningCourse?runningCourse.title+" 正在运行":"运行课程未确认"}；此处不会显示该任务的播放位置或停止它。
      {onOpenTasks&&<button className="text-button" onClick={onOpenTasks}>查看运行任务</button>}
    </p>}
    <div className="sf-zd-progress-actions">
      <button className="primary" type="button" disabled={!desktop||!settingsLoaded||!selected||active||busy!==null}
        onClick={()=>void start()}>
        <CirclePlay size={15}/>{busy==="start"?"启动中…":"打开官方播放器"}
      </button>
      <button className="secondary" type="button" disabled={!desktop||!active||!ownsStatus||!status.runId||busy!==null}
        onClick={()=>void stop()}>
        <Square size={14}/>{busy==="stop"?"停止中…":"停止播放器"}
      </button>
      <button className="secondary" type="button" disabled={!desktop||busy!==null}
        onClick={()=>void refreshStatus()}>
        <RefreshCw size={15}/>刷新状态
      </button>
    </div>
    <div className="sf-zd-official-grid">
      {detailMode
        ?null
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
        <strong>{!ownsStatus?"当前课程暂无播放观测":status.positionSeconds===null?"等待视频":position+" / "+duration}</strong>
        {!detailMode&&localPercent!==null&&<div className="sf-zd-local-track" role="progressbar"
          aria-label="本机 HTML5 视频播放位置" aria-valuemin={0} aria-valuemax={100} aria-valuenow={localPercent}>
          <span style={{width:localPercent+"%"}}/>
        </div>}
        {ownsStatus&&<small>{status.message}</small>}
      </div>
    </div>

    {ownsStatus&&<RunParameters parameters={events.find(event=>event.runner==="official"&&event.runId===status.runId&&event.courseId===selected&&event.parameters)?.parameters}/>}
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    <details className="sf-zd-local-observations">
      <summary>本地播放诊断（{viewObservations.length}）</summary>
      {viewObservations.length===0?<p>暂无当前课程的播放采样。</p>:<ul>{viewObservations.map((item,index)=><li key={index}><strong>{item.event}</strong><span>{timeLabel(item.position)}</span><time>{new Date(item.at).toLocaleTimeString()}</time></li>)}</ul>}
    </details>
    <details className="sf-technical-note"><summary>进度与播放说明</summary><p className="sf-zd-progress-note">
      {current?.course_type==="shared"?"共享课使用原始课程路由；":"智慧课程使用课程与班级 ID。"}
      仅控制官网顶层页面识别到的主视频；本机播放位置不是服务器学习进度。自动下一节无法安全识别时会要求手动切换。
      正常关闭 WebView2 后会自动进行一次单课只读核验；若回退到系统浏览器则需手动核验。
    </p></details>
  </section>;
}

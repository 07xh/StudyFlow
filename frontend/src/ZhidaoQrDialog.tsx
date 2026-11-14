import {useCallback,useEffect,useRef,useState} from "react";
import {RefreshCw,ShieldCheck,X} from "lucide-react";
import {zhidaoQrCommand,type ZhidaoQrStage,type ZhidaoQrState} from "./bridge";

const labels:Record<ZhidaoQrStage,string>={
  idle:"尚未开始扫码",busy:"已有扫码任务正在运行",
  requesting:"正在从知到获取二维码…",ready:"使用知到 App 扫描二维码",
  scanned:"已扫码，请在手机上确认",confirming:"正在核验官方登录会话…",
  verified:"知到登录已通过服务端验证",unavailable:"认证服务暂时不可用，请稍后重试",
  rejected:"服务器未接受本次登录，请重新扫码",expired:"二维码已过期，请重新扫码",
  cancelled:"已取消扫码登录",failed:"登录任务未完成，请检查网络和运行环境",
  "environment-error":"知到扫码组件不可用，请检查本地安装"
};
const terminal=new Set<ZhidaoQrStage>(["verified","unavailable","rejected","expired","cancelled","failed","environment-error"]);

type Props={onClose:()=>void;onVerified:()=>void};
export default function ZhidaoQrDialog({onClose,onVerified}:Props){
  const [state,setState]=useState<ZhidaoQrState>({stage:"idle",image_png_base64:null});
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const live=useRef(true);
  const stage=useRef<ZhidaoQrStage>("idle");
  const generation=useRef(0);
  const pollBusy=useRef(false);
  const startedRef=useRef(false);
  const onVerifiedRef=useRef(onVerified);
  onVerifiedRef.current=onVerified;

  const apply=useCallback((next:ZhidaoQrState)=>{
    if(!live.current)return;
    stage.current=next.stage;
    setState(next.stage==="ready"||next.stage==="requesting"
      ?next:{...next,image_png_base64:null});
    if(next.stage==="verified")onVerifiedRef.current();
  },[]);

  const start=useCallback(async()=>{
    if(busy)return;
    const current=++generation.current;
    setBusy(true);setMessage("");
    setState({stage:"requesting",image_png_base64:null});
    stage.current="requesting";
    try{
      const result=await zhidaoQrCommand("start");
      if(live.current&&generation.current===current)apply(result);
    }catch(e){
      if(live.current&&generation.current===current){
        stage.current="failed";setState({stage:"failed",image_png_base64:null});
        setMessage(e instanceof Error?e.message:"无法启动知到扫码服务");
      }
    }finally{if(live.current&&generation.current===current)setBusy(false)}
  },[apply,busy]);

  useEffect(()=>{
    live.current=true;
    const launch=window.setTimeout(()=>{startedRef.current=true;void start()},0);
    const timer=window.setInterval(async()=>{
      if(!live.current||pollBusy.current||terminal.has(stage.current)||stage.current==="idle")return;
      pollBusy.current=true;
      const current=generation.current;
      try{
        const result=await zhidaoQrCommand("status");
        if(live.current&&current===generation.current)apply(result);
      }catch(e){
        if(live.current&&current===generation.current)
          setMessage(e instanceof Error?e.message:"扫码状态暂时无法读取");
      }finally{pollBusy.current=false}
    },900);
    return ()=>{
      live.current=false;generation.current++;
      window.clearTimeout(launch);
      window.clearInterval(timer);
      if(startedRef.current&&!terminal.has(stage.current))void zhidaoQrCommand("cancel").catch(()=>{});
    };
    // A dialog instance starts exactly one attempt on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const cancel=async()=>{
    generation.current++;
    stage.current="cancelled";
    setState({stage:"cancelled",image_png_base64:null});
    try{await zhidaoQrCommand("cancel")}
    catch(e){setMessage(e instanceof Error?e.message:"取消扫码时发生错误")}
    onClose();
  };
  const retry=async()=>{
    generation.current++;
    try{await zhidaoQrCommand("cancel")}
    catch{setMessage("上次扫码清理失败，请重新打开窗口后再试");return}
    void start();
  };
  const image=state.image_png_base64;
  const showImage=(state.stage==="ready"||state.stage==="requesting")&&Boolean(image);
  return <div className="qr-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)void cancel()}}>
    <section className="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title">
      <div className="qr-header"><div><h3 id="qr-title">知到 · 扫码登录</h3><p>使用官方知到 App 扫码，学序只显示本次登录状态。</p></div><button className="qr-icon-button" aria-label="关闭扫码窗口" onClick={()=>void cancel()}><X size={20}/></button></div>
      <div className="qr-image-area">{showImage
        ?<img className="qr-image" src={`data:image/png;base64,${image}`} alt="本次知到登录二维码" draggable={false}/>
        :<div className="qr-placeholder"><ShieldCheck size={42}/><span>{state.stage==="ready"?"二维码图片尚未生成":labels[state.stage]}</span></div>}</div>
      <p className="qr-stage" role="status">{labels[state.stage]}</p>
      {message&&<p className="qr-error" role="alert">{message}</p>}
      <div className="qr-footer"><button className="secondary" onClick={()=>void cancel()}>取消</button>
        <button className="secondary" disabled={busy||!terminal.has(state.stage)} onClick={()=>void retry()}><RefreshCw size={16}/>重新扫码</button></div>
      <p className="qr-privacy">二维码仅用于本次登录；扫码后立即隐藏，结束时自动删除临时图片。Cookie 不会发送到前端。</p>
    </section>
  </div>;
}

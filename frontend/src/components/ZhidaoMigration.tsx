import {useRef,useState} from "react";
import {FileJson2,KeyRound,ScanLine} from "lucide-react";
import {friendlyBridgeError,request} from "../bridge";

export function ZhidaoLoginPanel({desktop,busy,onOpenNative,onImported}:{
  desktop:boolean;busy:boolean;onOpenNative:()=>void;onImported:()=>void
}){
  const [cookieMode,setCookieMode]=useState(false);
  const [cookie,setCookie]=useState("");
  const [importing,setImporting]=useState(false);
  const [message,setMessage]=useState("");
  const fileInput=useRef<HTMLInputElement>(null);
  const locked=!desktop||busy||importing;

  async function importCookie(content:string,mode:"text"|"file"){
    if(locked||!content.trim())return;
    setImporting(true);setMessage("");
    try{
      const response=await request<{imported:boolean;message:string}>({
        operation:"zhidao.cookie.import",content,mode
      });
      setMessage(response.message);
      if(response.imported){onImported();setCookie("");setCookieMode(false);}
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setImporting(false);setCookie("");}
  }

  return <div className="sf-platform-login">
    <div className="sf-login-panel-main">
      <div className="sf-login-panel-heading">
        <span className="sf-login-symbol"><ScanLine size={20}/></span>
        <div><h4>知到账号登录</h4><p>选择已有登录方式</p></div>
      </div>
      <div className="sf-login-actions">
        <button className="primary" type="button" disabled={locked} onClick={onOpenNative}>
          <ScanLine size={16}/>学序内扫码登录
        </button>
        <button className="secondary" type="button" disabled={locked}
          aria-expanded={cookieMode} onClick={()=>setCookieMode(current=>!current)}>
          <KeyRound size={16}/>输入 Cookie
        </button>
        <button className="secondary" type="button" disabled={locked}
          onClick={()=>fileInput.current?.click()}>
          <FileJson2 size={16}/>导入 Cookie 文件
        </button>
        <input ref={fileInput} type="file" accept=".json,application/json"
          aria-label="选择本机 ZHS Cookie JSON 文件"
          style={{position:"absolute",width:1,height:1,opacity:0,pointerEvents:"none"}}
          disabled={locked}
          onChange={event=>{
            const input=event.currentTarget,file=input.files?.[0];
            input.value="";
            if(!file)return;
            if(file.size>262144){setMessage("文件超过原版支持的 256 KiB 上限。");return;}
            void file.text().then(value=>importCookie(value,"file"))
              .catch(()=>setMessage("无法读取选择的文件。"));
          }}/>
      </div>
      {cookieMode&&<div className="sf-login-actions">
        <input type="password" spellCheck={false} autoComplete="off"
          aria-label="本人的知到 Cookie 请求头"
          placeholder="粘贴本人 Cookie 请求头" value={cookie}
          disabled={locked} onChange={event=>setCookie(event.target.value)}/>
        <button className="secondary" type="button" disabled={locked||!cookie.trim()}
          onClick={()=>void importCookie(cookie,"text")}>
          {importing?"核验中":"验证并导入"}
        </button>
      </div>}
      {message&&<p role="status" className="sf-login-result">{message}</p>}
    </div>
  </div>;
}

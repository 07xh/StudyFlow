import {useState} from "react";
import {BookOpen, ChevronRight, FileJson2, KeyRound, LockKeyhole, ScanLine} from "lucide-react";
import {friendlyBridgeError, request} from "../bridge";
import {platformNames, presentCourse} from "../presentation";
import type {Course} from "../types";

export function MigratedCourseCard({course, onInspect}: {course: Course; onInspect: (course: Course) => void}) {
  const data = presentCourse(course);
  return <article className="course-v2">
    <div className="course-v2-top">
      <span className={"course-v2-type " + course.platform}>
        {platformNames[course.platform]}
        {course.course_type ? " · " + (course.course_type === "ai" ? "智慧课程" : "共享课程") : ""}
      </span>
      <span className={"course-v2-evidence " + data.status}>{data.label}</span>
    </div>
    <h3 title={course.title}>{course.title}</h3>
    <p>{data.detail}</p>
    {data.percent !== null && <div className="course-v2-progress">
      <div className="course-v2-track" role="progressbar" aria-label="服务器已核验进度"
        aria-valuenow={data.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="course-v2-fill" style={{width: data.percent + "%"}}/>
      </div>
      <span>{data.percent.toFixed(1)}%</span>
    </div>}
    <button className="secondary course-v2-button" type="button" onClick={() => onInspect(course)}>
      <BookOpen size={15}/> 查看课程信息 <ChevronRight size={15}/>
    </button>
  </article>;
}

type LoginMethod = "qr" | "text" | "file";
const methods: {id: LoginMethod; label: string; icon: typeof ScanLine; message: string}[] = [
  {id: "qr", label: "扫码登录", icon: ScanLine,
   message: "使用学序内的原版 ZHS 扫码流程，保留二维码刷新、服务端核验和临时图片清理。"},
  {id: "text", label: "输入 Cookie", icon: KeyRound,
   message: "复用原版 Cookie 文本解析、凭据原子替换和服务器核验失败回滚。仅在本机处理，不写入日志。"},
  {id: "file", label: "导入 Cookie 文件", icon: FileJson2,
   message: "复用原版 ZHS 0.1.5 JSON Cookie 导入校验；服务器未确认时恢复导入前的本机登录状态。"},
];

export function ZhidaoLoginPanel({desktop, busy, onOpenLegacy, onOpenNative, onImported}: {
  desktop: boolean; busy: boolean; onOpenLegacy: () => void; onOpenNative: () => void; onImported: () => void
}) {
  const [method, setMethod] = useState<LoginMethod>("qr");
  const [cookieText, setCookieText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const selected = methods.find(m => m.id === method)!;
  const locked = !desktop || busy || importBusy;

  async function importCookie(content: string, mode: "file" | "text") {
    if (!content.trim() || locked) return;
    setImportBusy(true);
    setImportMessage("");
    try {
      const result = await request<{imported: boolean; message: string}>({
        operation: "zhidao.cookie.import", content, mode
      });
      setImportMessage(result.message);
      if (result.imported) {
        setCookieText("");
        onImported();
      }
    } catch (error) {
      setImportMessage(friendlyBridgeError(error));
    } finally {
      setImportBusy(false);
      setCookieText("");
    }
  }

  return <section className="login-v2">
    <div className="section-head"><div><h3>知到登录与连接</h3>
      <p>登录方式归属知到平台；沿用原版凭据验证与失败回滚。</p></div></div>
    <div className="login-v2-body">
      <div className="login-v2-main">
        <div className="login-v2-tabs" role="tablist" aria-label="知到登录方式">
          {methods.map(m => <button className={m.id === method ? "login-v2-tab selected" : "login-v2-tab"}
            role="tab" type="button" aria-selected={m.id === method} key={m.id}
            onClick={() => {setMethod(m.id);setImportMessage("");}}>
            <m.icon size={17}/>{m.label}
          </button>)}
        </div>
        <div className="login-v2-description" role="tabpanel">
          <div className="login-v2-illustration"><selected.icon size={23}/></div>
          <h3>{selected.label}</h3><p>{selected.message}</p>
          {method === "qr" ? <div className="actions">
              <button className="secondary" type="button" disabled={locked}
                onClick={onOpenNative}><ScanLine size={16}/>学序内扫码</button>
              <button className="secondary" type="button" disabled={locked}
                onClick={onOpenLegacy}><ScanLine size={16}/>原版扫码备用</button>
            </div>
            : method === "text" ? <div className="actions">
                <input type="password" autoComplete="off" spellCheck={false}
                  aria-label="本人知到 Cookie 请求头"
                  placeholder="粘贴本人 Cookie 请求头"
                  value={cookieText} disabled={locked}
                  onChange={event=>setCookieText(event.target.value)}/>
                <button className="secondary" type="button" disabled={locked || !cookieText.trim()}
                  onClick={()=>void importCookie(cookieText,"text")}>
                  {importBusy?"正在验证…":"验证并导入"}
                </button>
              </div>
              : <div className="actions">
                  <label className="secondary" aria-disabled={locked}>
                    <FileJson2 size={16}/>选择 ZHS Cookie JSON
                    <input type="file" accept=".json,application/json" disabled={locked}
                      aria-label="选择 ZHS Cookie JSON 文件"
                      onChange={async event=>{
                        const input=event.currentTarget;
                        const file=input.files?.[0];
                        input.value="";
                        if(!file)return;
                        if(file.size>262144){
                          setImportMessage("Cookie 文件超过原版支持的 256 KiB 上限。");
                          return;
                        }
                        try{await importCookie(await file.text(),"file");}
                        catch{setImportMessage("无法读取所选 Cookie 文件。");}
                      }}/>
                  </label>
                </div>}
          {importMessage&&<p className="login-v2-result" role="status">{importMessage}</p>}
        </div>
      </div>
      <aside className="login-v2-guide">
        <h3><LockKeyhole size={17}/> 会话验证流程</h3>
        <ol><li>选择原版支持的登录方式</li><li>由原版模块保存或更新本机会话</li><li>通过服务端核验后同步真实课程</li></ol>
        <p>Cookie 只在本机临时处理；不会写入学序日志、浏览器本地存储或云端服务。</p>
      </aside>
    </div>
  </section>;
}

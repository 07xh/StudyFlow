import {useState} from "react";
import {BookOpen, ChevronRight, FileJson2, KeyRound, LockKeyhole, ScanLine} from "lucide-react";
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
   message: "使用知到原版 WPF 登录窗口，沿用现有二维码刷新、失效处理和自动清理。完成后返回学序检测连接。"},
  {id: "text", label: "直接输入 Cookie", icon: KeyRound,
   message: "原知到软件支持遮蔽式输入。为避免在新界面尚未审核的路径中收集凭据，学序暂时不提供此入口。"},
  {id: "file", label: "导入 Cookie 文件", icon: FileJson2,
   message: "文件导入和失败回滚仍在原知到仓库中。学序尚未迁入安全文件选择与验证流程。"},
];

export function ZhidaoLoginPanel({desktop, busy, onOpenLegacy}: {
  desktop: boolean; busy: boolean; onOpenLegacy: () => void
}) {
  const [method, setMethod] = useState<LoginMethod>("qr");
  const selected = methods.find(m => m.id === method)!;
  return <section className="login-v2">
    <div className="section-head"><div><h3>知到登录与连接</h3>
      <p>保留原版登录能力，不将本地凭据存在等同于服务器确认。</p></div></div>
    <div className="login-v2-body">
      <div className="login-v2-main">
        <div className="login-v2-tabs" role="tablist" aria-label="知到登录方式">
          {methods.map(m => <button className={m.id === method ? "login-v2-tab selected" : "login-v2-tab"}
            role="tab" type="button" aria-selected={m.id === method} key={m.id} onClick={() => setMethod(m.id)}>
            <m.icon size={17}/>{m.label}
          </button>)}
        </div>
        <div className="login-v2-description" role="tabpanel">
          <div className="login-v2-illustration"><selected.icon size={23}/></div>
          <h3>{selected.label}</h3><p>{selected.message}</p>
          {method === "qr" ? <button className="secondary" type="button" disabled={!desktop || busy}
              onClick={onOpenLegacy}><ScanLine size={16}/>打开原版知到扫码窗口</button>
            : <button className="secondary" type="button" disabled title="当前尚未迁入对应安全验证通道">
              <LockKeyhole size={16}/>新界面暂未开放
            </button>}
        </div>
      </div>
      <aside className="login-v2-guide">
        <h3><LockKeyhole size={17}/> 会话验证流程</h3>
        <ol><li>打开原版知到并完成个人登录</li><li>返回学序检测服务端登录状态</li><li>服务端确认后读取真实课程数据</li></ol>
        <p>学序不在普通网页预览中采集 Cookie、二维码令牌或账号密码。旧版软件保持独立运行。</p>
      </aside>
    </div>
  </section>;
}

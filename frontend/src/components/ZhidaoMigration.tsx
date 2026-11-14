import {BookOpen,ChevronRight,ScanLine,ShieldCheck} from "lucide-react";
import {platformNames,presentCourse} from "../presentation";
import type {Course} from "../types";

export function MigratedCourseCard({course,onInspect}:{course:Course;onInspect:(course:Course)=>void}){
  const data=presentCourse(course);
  return <article className="course-v2">
    <div className="course-v2-top">
      <span className={"course-v2-type "+course.platform}>
        {platformNames[course.platform]}
        {course.course_type?" · "+(course.course_type==="ai"?"智慧课程":"共享课程"):""}
      </span>
      <span className={"course-v2-evidence "+data.status}>{data.label}</span>
    </div>
    <h3 title={course.title}>{course.title}</h3>
    <p>{data.detail}</p>
    {data.percent!==null&&<div className="course-v2-progress">
      <div className="course-v2-track" role="progressbar" aria-label="服务器已核验进度"
        aria-valuenow={data.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="course-v2-fill" style={{width:data.percent+"%"}}/>
      </div>
      <span>{data.percent.toFixed(1)}%</span>
    </div>}
    <button className="secondary course-v2-button" type="button" onClick={()=>onInspect(course)}>
      <BookOpen size={15}/>课程详情<ChevronRight size={15}/>
    </button>
  </article>;
}

export function ZhidaoLoginPanel({desktop,busy,onOpenLegacy,onOpenNative}:{
  desktop:boolean;busy:boolean;onOpenLegacy:()=>void;onOpenNative:()=>void
}){
  return <div className="sf-platform-login">
    <div className="sf-login-panel-main">
      <div className="sf-login-panel-heading">
        <span className="sf-login-symbol"><ScanLine size={20}/></span>
        <div><h4>知到账号登录</h4>
          <p>使用知到 App 扫码，完成后由学序重新检测真实登录状态。</p>
        </div>
      </div>
      <div className="sf-login-actions">
        <button className="primary" type="button" disabled={!desktop||busy} onClick={onOpenNative}>
          <ScanLine size={16}/>学序内扫码登录
        </button>
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={onOpenLegacy}>
          打开原版登录窗口
        </button>
      </div>
    </div>
    <aside className="sf-login-panel-aside">
      <h4><ShieldCheck size={16}/>登录步骤</h4>
      <ol><li>点击学序内扫码登录</li><li>使用知到 App 扫描并确认</li>
        <li>服务端验证通过后自动更新连接状态</li></ol>
      <p>二维码只在本次登录过程中显示，Cookie 不会进入前端存储。</p>
    </aside>
  </div>;
}

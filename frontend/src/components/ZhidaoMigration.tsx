import {BookOpen,ChevronRight,ScanLine} from "lucide-react";
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
  return <section className="login-v2">
    <div className="section-head"><h3>知到登录</h3></div>
    <div className="sf-login-panel">
      <div className="sf-login-icon"><ScanLine size={22}/></div>
      <div className="sf-login-label"><strong>扫码登录</strong><span>选择登录入口</span></div>
      <div className="actions">
        <button className="primary" type="button" disabled={!desktop||busy} onClick={onOpenNative}>
          <ScanLine size={15}/>学序内扫码
        </button>
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={onOpenLegacy}>
          原版扫码
        </button>
      </div>
    </div>
  </section>;
}

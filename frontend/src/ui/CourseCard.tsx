import {BookOpen,ChevronRight} from "lucide-react";
import type {Course} from "../types";
import {presentCourse} from "../presentation";
import {platformInfo} from "./registry";

/** Progress is never displayed without server_verified evidence and timestamp. */
export function CourseCard({course,onInspect}:{course:Course;onInspect:(item:Course)=>void}){
  const definition=platformInfo(course.platform);
  const progress=presentCourse(course);
  return <article className="course-card sf-course-card">
    <div className="sf-course-head">
      <div className={"sf-course-icon sf-provider-"+(definition?.color??"neutral")}><BookOpen size={19}/></div>
      <span className="course-provider">{definition?.name??course.platform}</span>
    </div>
    <strong title={course.title}>{course.title}</strong>
    <small>{course.course_type==="ai"?"智慧课程":course.course_type==="shared"?"共享课程":"课程"}{course.platform==="zhidao"?"":" · ID："+course.course_id}</small>
    <div className="sf-course-evidence">{progress.label} · {progress.detail}</div>
    <div className="sf-progress-area">
      <div className="sf-progress-label">
        <span>{course.course_type==="ai"?"满进度知识点占比":course.course_type==="shared"?"已完成视频占比":"学习进度"}</span>
        <span>{progress.percent===null?"未核验":progress.percent.toFixed(1)+"%"}</span>
      </div>
      {progress.percent!==null
        ?<div className="sf-progress" role="progressbar" aria-label={course.course_type==="ai"?"服务器已核验满进度知识点占比":"服务器已核验已完成视频占比"}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <div style={{width:progress.percent+"%"}}/>
        </div>
        :<div className="sf-progress sf-progress-empty"/>}
    </div>
    <button className="secondary sf-course-details" type="button" onClick={()=>onInspect(course)}>
      课程详情 <ChevronRight size={15}/>
    </button>
  </article>;
}

import {BookOpen,ChevronRight} from "lucide-react";
import type {Course} from "../types";
import {presentCourse,courseMetric,type YuketangVideoSummary} from "../presentation";
import {platformInfo} from "./registry";

/** Progress is never displayed without server_verified evidence and timestamp. */
export function CourseCard({course,onInspect,yuketangSummary}:{course:Course;onInspect:(item:Course)=>void;yuketangSummary?:YuketangVideoSummary}){
  const definition=platformInfo(course.platform);
  const progress=presentCourse(course,yuketangSummary);
  const metric=courseMetric(course,yuketangSummary);
  return <article className="course-card sf-course-card">
    <div className="sf-course-head">
      <div className={"sf-course-icon sf-provider-"+(definition?.color??"neutral")}><BookOpen size={19}/></div>
      <span className="course-provider">{definition?.name??course.platform}</span>
    </div>
    <strong title={course.title}>{course.title}</strong>
    <small>{course.course_type==="ai"?"智慧课程":course.course_type==="shared"?"共享课程":"课程"}</small>
    <div className="sf-course-evidence">{progress.label} · {progress.detail}</div>
    <div className="sf-progress-area">
      <div className="sf-progress-label">
        <span>{metric.label}</span>
        <span>{progress.percent===null?progress.label:progress.percent.toFixed(1)+"%"}</span>
      </div>
      {progress.percent!==null
        ?<div className="sf-progress" role="progressbar" aria-label={"服务器已核验 · "+metric.label}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <div style={{width:progress.percent+"%"}}/>
        </div>
        :null}
    </div>
    <button className="secondary sf-course-details" type="button" onClick={()=>onInspect(course)}>
      课程详情 <ChevronRight size={15}/>
    </button>
  </article>;
}

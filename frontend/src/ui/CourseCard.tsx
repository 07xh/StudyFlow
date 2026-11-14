import {BookOpen} from "lucide-react";
import type {Course} from "../types";
import {platformInfo} from "./registry";

interface Props {course:Course}
export function CourseCard({course}:Props){
  const progress=course.progress_percent;
  const hasProgress=typeof progress==="number"&&Number.isFinite(progress)&&progress>=0&&progress<=100;
  const definition=platformInfo(course.platform);
  return <article className="course-card sf-course-card">
    <div className="sf-course-head">
      <div className={"sf-course-icon sf-provider-"+(definition?.color??"neutral")}><BookOpen size={21}/></div>
      <span className="course-provider">{definition?.name??course.platform}</span>
    </div>
    <strong>{course.title}</strong>
    <small>课程 ID：{course.course_id}</small>
    <div className="sf-progress-area">
      <div className="sf-progress-label">
        <span>学习进度</span>
        <span>{hasProgress?progress+"%":"暂无平台确认数据"}</span>
      </div>
      {hasProgress&&<div className="sf-progress" role="progressbar" aria-label={course.title+"学习进度"}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div style={{width:progress+"%"}}/>
      </div>}
    </div>
  </article>;
}

import {BookOpen,Search} from "lucide-react";
import type {Course,Platform,PlatformState} from "../types";
import {platformNames,type YuketangVideoSummary} from "../presentation";
import {CourseCard} from "./CourseCard";
import {EmptyState} from "./EmptyState";

type Props={
  platform:Platform;
  state:PlatformState;
  query:string;
  feedback:{phase:"idle"|"syncing"|"synced"|"failed";error:string};
  yuketangSummaries:Record<string,YuketangVideoSummary>;
  onQueryChange:(value:string)=>void;
  inspectCourse:(course:Course)=>void;
  onLogin:()=>void;
};

/** Controlled course search and evidence-only course cards for every platform. */
export function PlatformCourseList({platform,state,query,feedback,yuketangSummaries,onQueryChange,inspectCourse,onLogin}:Props){
    const platformCourses=state.courses;
    const search=query.trim().toLocaleLowerCase();
    const visible=platformCourses.filter(course=>
      course.title.toLocaleLowerCase().includes(search)||
      course.course_id.toLocaleLowerCase().includes(search));
    return <section className="sf-platform-courses" aria-label={platformNames[platform]+"课程列表"}>
      <div className="section-head"><h3>课程列表</h3>
        <span className="sf-muted" role="status" aria-live="polite">
          {feedback.phase==="syncing"?"正在自动读取真实课程…":
           feedback.phase==="failed"?"课程同步失败，可点击「同步课程列表」重试":
           feedback.phase==="synced"?"已同步真实课程":""}
        </span>
      </div>
      <div className="sf-search-toolbar">
        <label className="sf-search"><Search size={16}/><input type="search"
          placeholder="搜索当前平台课程名称或 ID" value={query} onChange={event=>onQueryChange(event.target.value)}
          aria-label="搜索当前平台课程"/></label>
      </div>
      {visible.length>0
        ?<div className="course-grid">{visible.map(course=>
          <CourseCard course={course} yuketangSummary={course.platform==="yuketang"?yuketangSummaries[course.course_id]:undefined} onInspect={inspectCourse} key={course.platform+":"+course.course_id}/>)}</div>
        :<EmptyState icon={BookOpen}
          title={platformCourses.length>0?"未找到匹配课程":"暂无真实课程数据"}
          description={platformCourses.length>0
            ?"可以更换搜索词。当前只显示"+platformNames[platform]+"课程。"
            :state.status==="connected"
              ?feedback.phase==="syncing"?"正在自动读取课程，请稍候。"
              :feedback.phase==="failed"
                ?"读取失败："+feedback.error+"；请点击「同步课程列表」重试。"
                :"已自动尝试读取当前平台课程；如课程尚未出现，可点击「同步课程列表」重试。"
              :"请点击上方「账号与连接」登录当前平台，登录通过后会自动同步真实课程。"}
          action={state.status!=="connected"
            ?<button className="secondary" type="button"
              onClick={onLogin}>
                前往账号登录
              </button>:undefined}/>}
    </section>;
  }

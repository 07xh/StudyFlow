import {BookOpen,CheckCircle2,ChevronRight,CircleGauge,GraduationCap,ListChecks,RefreshCw} from "lucide-react";
import type {Course,Platform,PlatformState} from "../types";
import {PlatformCard} from "./PlatformCard";
import {platformRegistry} from "./registry";
import {presentCourse,courseMetric,platformNames,type YuketangVideoSummary} from "../presentation";
import {EmptyState} from "./EmptyState";

type MetricsProps={courseCount:number;learningCount:number;completedCount:number;unverifiedCount:number};
export function CourseMetrics({courseCount,learningCount,completedCount,unverifiedCount}:MetricsProps){
  return <section className="sf-metrics-grid" aria-label="学习统计">
    <article className="sf-metric-card">
      <span className="sf-metric-icon"><BookOpen size={21}/></span>
      <div><small>全部课程</small><strong>{courseCount}<em>门</em></strong></div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon play"><ListChecks size={21}/></span>
      <div><small>部分内容已完成</small><strong>{learningCount}<em>门</em></strong>
</div>
    </article>
    <article className="sf-metric-card">
      <span className="sf-metric-icon done"><CheckCircle2 size={21}/></span>
      <div><small>内容全部完成</small><strong>{completedCount}<em>门</em></strong>
</div>
    </article>
    <article className="sf-metric-card"><span className="sf-metric-icon progress"><CircleGauge size={21}/></span><div><small>待核验课程</small><strong>{unverifiedCount}<em>门</em></strong></div></article>
  </section>;
}

type RecentCoursesProps={
  courses:Course[];
  yuketangSummaries:Record<string,YuketangVideoSummary>;
  onOpenPlatforms:()=>void;
  inspectCourse:(course:Course)=>void;
};
export function RecentCourses({courses,yuketangSummaries,onOpenPlatforms,inspectCourse}:RecentCoursesProps){
  return <section className="sf-recent-section">
    <div className="section-head">
      <h3>课程概览</h3>
      <button className="text-button" type="button" onClick={onOpenPlatforms}>
        查看学习平台<ChevronRight size={16}/>
      </button>
    </div>
    {courses.length===0
      ?<EmptyState icon={BookOpen} title="暂无已同步课程"
          description="先完成平台登录，连接验证通过后会自动同步真实课程。"
          action={<button className="secondary" type="button" onClick={onOpenPlatforms}>管理平台登录</button>}/>
      :<div className="sf-recent-list">
        {courses.slice(0,4).map(course=>{
          const data=presentCourse(course,course.platform==="yuketang"?yuketangSummaries[course.course_id]:undefined);
          return <article className="sf-recent-row" key={course.platform+":"+course.course_id}>
            <div className={"sf-recent-thumb "+course.platform}>
              {course.platform==="zhidao"?<GraduationCap size={27}/>:<BookOpen size={27}/>}
            </div>
            <div className="sf-recent-main">
              <div className="sf-recent-title-line">
                <span className={"sf-course-platform-tag "+course.platform}>{platformNames[course.platform]}</span>
                <strong title={course.title}>{course.title}</strong>
                {data.percent===100&&<span className="sf-completed-tag">内容全部完成</span>}
              </div>
              <div className="sf-recent-progress-label">
                <span>{data.percent===null?"暂无平台核验记录":courseMetric(course,course.platform==="yuketang"?yuketangSummaries[course.course_id]:undefined).label+"："+data.percent.toFixed(1)+"%"}</span>
                {course.stale&&<span>数据可能已过期</span>}
              </div>
              {data.percent!==null&&<div className="sf-recent-track" role="progressbar"
                aria-label="服务器已核验进度" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={data.percent}><span style={{width:data.percent+"%"}}/></div>}
            </div>
            <button className="secondary sf-recent-detail" type="button"
              onClick={()=>inspectCourse(course)}>
              课程详情
            </button>
          </article>;
        })}
      </div>}
  </section>;
}


type PlatformOverviewProps={
  platforms:Record<Platform,PlatformState>;
  desktop:boolean;
  busy:boolean;
  syncing:Record<Platform,boolean>;
  onRefresh:()=>void;
  onSync:(platform:Platform)=>void;
  onLogin:(platform:Platform)=>void;
  onEnterCourses:(platform:Platform)=>void;
};
export function PlatformOverview({platforms,desktop,busy,syncing,onRefresh,onSync,onLogin,onEnterCourses}:PlatformOverviewProps){
  return <section className="sf-platform-section">
    <div className="section-head">
      <h3>学习平台</h3>
      <button className="secondary sf-refresh" type="button" disabled={!desktop||busy}
        onClick={onRefresh}><RefreshCw size={15}/>检测连接</button>
    </div>
    <div className="platform-grid sf-platform-grid">
      {platformRegistry.map(definition=><PlatformCard key={definition.id}
        definition={definition} state={platforms[definition.id]} desktop={desktop}
        busy={busy||syncing[definition.id]} expanded={false}
        onSync={()=>onSync(definition.id)}
        onToggleLogin={()=>onLogin(definition.id)}
        onEnterCourses={()=>onEnterCourses(definition.id)}>
        {null}
      </PlatformCard>)}
    </div>
  </section>;
}

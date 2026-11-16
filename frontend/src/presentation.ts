import type {Course, Platform} from "./types";

export const platformNames: Record<Platform, string> = {zhidao: "知到", yuketang: "雨课堂", xuexitong: "学习通", ucampus: "U校园"};

export type CoursePresentation = {
  status: "cached" | "verified" | "unverified";
  label: string;
  detail: string;
  percent: number | null;
};

/** Only confirmed server readings from a completed classroom video scan can form a rate. */
export type YuketangVideoSummary = {
  total:number; verified:number; completed:number;
  complete:boolean; scanning:boolean; checkedAt:number|null;
};
export type PlatformProgressOverview = {
  percent:number|null; label:string; detail:string;
  verifiedCount:number; totalCount:number;
};

export function presentCourse(course: Course, summary?:YuketangVideoSummary): CoursePresentation {
  if (course.stale) {
    return {status: "cached", label: "历史缓存待核验", detail: "历史记录仅供参考，请重新同步核验", percent: null};
  }
  if(course.platform==="yuketang"&&summary){
    if(summary.complete&&summary.total>0&&summary.verified===summary.total){
      return {status:"verified",label:"视频进度已核验",
        detail:`已确认完成 ${summary.completed}/${summary.total} 节视频 · 非官方课程总进度`,
        percent:summary.completed/summary.total*100};
    }
    if(summary.total>0){
      return {status:"unverified",label:summary.scanning?"核验中":"部分已核验",
        detail:`已核验 ${summary.verified}/${summary.total} 节 · 已确认完成 ${summary.completed} 节；未核验不计为未完成`,
        percent:null};
    }
    if(summary.scanning)return {status:"unverified",label:"核验中",
      detail:"正在读取真实课程视频与服务器进度",percent:null};
    if(summary.complete)return {status:"unverified",label:"暂无可核验视频",
      detail:"服务器未返回视频学习项",percent:null};
  }
  const value = course.progress_percent;
  // A numeric progress value alone is not evidence of platform verification.
  if (course.progress_evidence === "server_verified" && typeof value === "number" &&
      Number.isFinite(value) && value >= 0 && value <= 100 && Boolean(course.verified_at)) {
    const detail = course.course_type === "ai"
      ? course.progress_metric === "official_ai_schedule"
        ? "知到课程列表返回的学习进度（schedule）；掌握度另行统计"
        : "满进度知识点占比，不代表官方课程总进度或掌握度"
      : course.course_type === "shared"
        ? "已完成视频占比，不代表观看时长"
        : "平台返回的上次核验记录";
    return {status: "verified", label: "服务器已核验", detail, percent: value};
  }
  return {status: "unverified", label: "未核验", detail: "暂无可确认的服务器学习进度", percent: null};
}

export function courseKey(course: Course): string {
  return course.platform + ":" + course.course_id;
}

export function selectedSessionCourse(courses: Course[], selected: Course | null): Course | null {
  return selected ? courses.find(course => courseKey(course) === courseKey(selected)) ?? null : null;
}


/** Describe the actual server-derived measure, not a fictional official total. */
export function courseMetric(course:Course, summary?:YuketangVideoSummary){
 const evidence=presentCourse(course,summary);
 return {...evidence,label:course.platform==="yuketang"?"已完成视频占比":
   course.course_type==='ai'?(course.progress_metric==='official_ai_schedule'?'知到课程进度':'满进度知识点占比'):
   course.course_type==='shared'?'已完成视频占比':'平台记录进度',
   evidenceLabel:evidence.label,
   verifiedAt:course.platform==="yuketang"&&summary?.checkedAt
     ?new Date(summary.checkedAt).toISOString():course.verified_at??null};
}

/** Incomplete verification never produces an invented platform-wide percentage.
 * Video completion for Rain Classroom is weighted by the number of confirmed videos;
 * other platforms use the mean of their individually labeled verified course metrics. */
export function platformProgressOverview(
  courses:Course[], yuketang:Record<string,YuketangVideoSummary>={}
):PlatformProgressOverview{
  const current=courses.filter(course=>!course.stale);
  const metrics=current.map(course=>courseMetric(course,course.platform==="yuketang"?yuketang[course.course_id]:undefined));
  const verifiedCount=metrics.filter(metric=>metric.percent!==null).length;
  const totalCount=current.length;
  const rain=current.length>0&&current.every(course=>course.platform==="yuketang");
  const complete=totalCount>0&&verifiedCount===totalCount;
  const scanning=current.some(course=>course.platform==="yuketang"&&yuketang[course.course_id]?.scanning);
  let percent:number|null=null;
  if(complete&&rain){
    const summaries=current.map(course=>yuketang[course.course_id]);
    const total=summaries.reduce((sum,summary)=>sum+summary.total,0);
    if(total>0)percent=summaries.reduce((sum,summary)=>sum+summary.completed,0)/total*100;
  }else if(complete){
    percent=metrics.reduce((sum,metric)=>sum+(metric.percent??0),0)/totalCount;
  }
  const label=rain?"平台视频完成概览":"平台课程进度概览";
  const videoSummary=rain?current.map(course=>yuketang[course.course_id]).filter(
    (summary):summary is YuketangVideoSummary=>summary!==undefined):[];
  const totalVideos=videoSummary.reduce((count,summary)=>count+summary.total,0);
  const verifiedVideos=videoSummary.reduce((count,summary)=>count+summary.verified,0);
  const completedVideos=videoSummary.reduce((count,summary)=>count+summary.completed,0);
  const detail=totalCount===0?"暂无已同步课程":
    percent!==null?`已核验 ${verifiedCount}/${totalCount} 门 · ${rain?"按服务器已核验视频汇总":"课程进度均值"}，非官方总进度`:
    rain&&totalVideos>0?`服务器已核验 ${verifiedVideos}/${totalVideos} 节视频 · 已确认完成 ${completedVideos} 节 · ${scanning?"核验中":"总体进度待核验"}`:
    `已核验 ${verifiedCount}/${totalCount} 门 · ${scanning?"正在读取服务器学习进度":"总体进度待核验"}`;
  return {percent,label,detail,verifiedCount,totalCount};
}

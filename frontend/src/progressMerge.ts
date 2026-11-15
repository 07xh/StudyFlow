import type {Course} from "./types";

/** Compare only authenticated, current-server evidence; not local player time. */
function verificationTime(course:Course):number|null{
  if(course.platform!=="zhidao"||course.stale||
     course.progress_evidence!=="server_verified"||
     typeof course.progress_percent!=="number"||
     !Number.isFinite(course.progress_percent)||
     course.progress_percent<0||course.progress_percent>100||
     !course.verified_at)return null;
  const value=Date.parse(course.verified_at);
  return Number.isFinite(value)?value:null;
}

/** An older concurrent response cannot overwrite newer server-verified progress.
 * A new server verification IS allowed to decrease; the platform is authoritative.
 * Unverified or stale results are never promoted using an old login's evidence.
 */
export function mergeZhidaoEvidence(previous:Course[],incoming:Course[]):Course[]{
  const byId=new Map(previous.filter(course=>course.platform==="zhidao")
    .map(course=>[course.course_id,course] as const));
  return incoming.map(course=>{
    if(course.platform!=="zhidao"||course.stale)return course;
    const prior=byId.get(course.course_id);
    // Neither timestamp nor title proves account identity; require both records
    // to belong to the same authenticated session before retaining old values.
    if(!prior||!course.session_marker||!prior.session_marker||
       course.session_marker!==prior.session_marker)return course;
    const priorAt=verificationTime(prior);
    const nextAt=verificationTime(course);
    if(priorAt===null||nextAt===null||nextAt>=priorAt)return course;
    return {...course,progress_percent:prior.progress_percent,
      progress_evidence:prior.progress_evidence,verified_at:prior.verified_at};
  });
}

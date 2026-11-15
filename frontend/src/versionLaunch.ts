/** Desktop-only upgrade prompt state. No lesson progress or credentials are stored here. */
export const LAST_SEEN_VERSION_KEY="studyflow.version.last-seen.v1";
const LEGACY_STORAGE_KEYS=[
  "studyflow.appearance.v2",
  "studyflow.nav.platform-expanded",
  "studyflow.cards.compact",
  "studyflow.platform-login.expanded.v1",
  "studyflow.activity.v1",
];

export type LaunchDecision="fresh"|"upgrade"|"unchanged";
/** Snapshot this during initial render, before other UI effects write defaults. */
export function readLaunchSnapshot():{previous:string|null;existing:boolean}{
  if(typeof window==="undefined")return {previous:null,existing:false};
  try{
    const storage=window.localStorage;
    const previous=storage.getItem(LAST_SEEN_VERSION_KEY);
    return {previous,existing:previous!==null||LEGACY_STORAGE_KEYS.some(key=>storage.getItem(key)!==null)};
  }catch{return {previous:null,existing:false};}
}
export function markVersionSeen(version:string):void{
  try{window.localStorage.setItem(LAST_SEEN_VERSION_KEY,version);}
  catch{/* A storage failure must not block startup. */}
}
export function validVersion(value:string):boolean{
  return /^v?\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
function parse(version:string):{numbers:number[];pre:string[]}|null{
  if(!validVersion(version))return null;
  const match=/^v?(\d+(?:\.\d+){1,3})(?:-([0-9A-Za-z.-]+))?/.exec(version)!;
  return {numbers:match[1].split(".").map(Number),pre:match[2]?.split(".")??[]};
}
/** Version precedence including prereleases such as rc.9 < rc.10. */
export function compareVersions(left:string,right:string):number{
  const a=parse(left),b=parse(right);
  if(!a||!b)return left.replace(/^v/,"")===right.replace(/^v/,"")?0:1;
  for(let i=0;i<4;i++){
    const diff=(a.numbers[i]??0)-(b.numbers[i]??0);
    if(diff)return Math.sign(diff);
  }
  if(!a.pre.length||!b.pre.length)return a.pre.length===b.pre.length?0:a.pre.length?-1:1;
  for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++){
    if(i>=a.pre.length)return -1;
    if(i>=b.pre.length)return 1;
    const x=a.pre[i],y=b.pre[i];
    if(x===y)continue;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn&&yn)return Math.sign(Number(x)-Number(y));
    if(xn!==yn)return xn?-1:1;
    return x<y?-1:1;
  }
  return 0;
}
export function decideLaunch(current:string,previous:string|null,existing:boolean):LaunchDecision{
  if(!validVersion(current))return "unchanged";
  if(previous===null)return existing?"upgrade":"fresh";
  return compareVersions(current,previous)>0?"upgrade":"unchanged";
}

/** A newly published GitHub Release is a different notification from an installed upgrade. */
export const LAST_DISMISSED_RELEASE_KEY="studyflow.release.dismissed.v1";
export function shouldPromptForRelease(installed:string,published:string,dismissed:string|null):boolean{
  if(!validVersion(installed)||!validVersion(published))return false;
  return compareVersions(published,installed)>0
    && (!dismissed||!validVersion(dismissed)||compareVersions(published,dismissed)>0);
}
export function readDismissedRelease():string|null{
  try{return window.localStorage.getItem(LAST_DISMISSED_RELEASE_KEY);}
  catch{return null;}
}
export function markReleaseDismissed(version:string):void{
  if(!validVersion(version))return;
  try{window.localStorage.setItem(LAST_DISMISSED_RELEASE_KEY,version);}
  catch{/* Notification preferences must never block the app. */}
}

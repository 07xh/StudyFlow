/// <reference types="vite/client" />
import type {ReleaseChangelogEntry} from "./bridge";
import {compareVersions,validVersion} from "./versionLaunch";

/**
 * Release candidate notes are bundled into the installer at build time.
 * GitHub Actions publishes each candidate with the same docs/ file as --notes-file.
 * When the GitHub API is unavailable, the installed version still has readable notes.
 */
const documents=import.meta.glob<string>("../../docs/RELEASE_CANDIDATE_*.md",{
  eager:true,query:"?raw",import:"default"
});

export function bundledReleaseNotes(current:string,previous?:string,history=false):ReleaseChangelogEntry[]{
  if(!validVersion(current))return [];
  const entries:ReleaseChangelogEntry[]=[];
  for(const [path,notes] of Object.entries(documents)){
    const match=/RELEASE_CANDIDATE_(\d+(?:\.\d+){2})_RC(\d+)\.md$/.exec(path);
    if(!match||!notes.trim())continue;
    const version=`v${match[1]}-rc.${match[2]}`;
    if(compareVersions(version,current)>0)continue;
    if(previous&&validVersion(previous)&&compareVersions(version,previous)<=0)continue;
    if(!previous&&!history&&compareVersions(version,current)!==0)continue;
    entries.push({
      version,
      title:(notes.split(/\r?\n/,1)[0]||"").replace(/^#\s*/,"").slice(0,160),
      notes:notes.slice(0,16000),
      published_at:""
    });
  }
  entries.sort((a,b)=>compareVersions(b.version,a.version));
  return entries.slice(0,history?12:15);
}

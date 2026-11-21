/** Pure read-only selectors for the Xuexitong chapter workspace.
 *  A chapter label is not an official course percentage. The selectors never
 *  infer progress from the total number of discovered tasks.
 */
import type {XuexitongTaskItem} from "./bridge";

export type XuexitongChapter = {
  id: string;
  title: string;
  completed: boolean;
  locked: boolean;
};
export type ChapterFilter = "all" | "pending" | "completed" | "locked";
export type TaskFilter = "all" | "video" | "audio" | "document" |
  "workid" | "read" | "live" | "flash" | "other";
export type CompletionFilter = "all" | "pending" | "completed" | "unknown";

function includesSearch(value:string, query:string):boolean {
  return value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function chapterOverview(chapters:readonly XuexitongChapter[]){
  const total = chapters.length;
  const locked = chapters.filter(chapter=>chapter.locked).length;
  const completed = chapters.filter(chapter=>!chapter.locked&&chapter.completed).length;
  return {total,locked,completed,pending:total-locked-completed};
}

export function filterXuexitongChapters(
  chapters:readonly XuexitongChapter[],query:string,status:ChapterFilter
):XuexitongChapter[] {
  return chapters.filter(chapter=>
    (includesSearch(chapter.title,query)||includesSearch(chapter.id,query))&&
    (status==="all" ||
      (status==="locked"&&chapter.locked) ||
      (status==="completed"&&!chapter.locked&&chapter.completed) ||
      (status==="pending"&&!chapter.locked&&!chapter.completed)));
}

export function filterXuexitongTasks(
  tasks:readonly XuexitongTaskItem[],query:string,kind:TaskFilter,
  completion:CompletionFilter
):XuexitongTaskItem[] {
  const known = new Set(["video","audio","document","workid","read","live","flash"]);
  return tasks.filter(task=>
    (includesSearch(task.title,query)||includesSearch(task.id,query)) &&
    (kind==="all" || (kind==="other"?!known.has(task.type):task.type===kind)) &&
    (completion==="all" ||
      (completion==="completed"&&task.completed===true) ||
      (completion==="pending"&&task.completed===false) ||
      (completion==="unknown"&&task.completed===null)));
}

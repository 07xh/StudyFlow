import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {RefreshCw} from "lucide-react";
import {friendlyBridgeError,request,type Video} from "../bridge";
import type {Course} from "../types";

type Props={course:Course;desktop:boolean;connected:boolean;scopeDirty:boolean};
type LoadState="idle"|"loading"|"ready"|"blocked"|"error";

/** Scoped, read-only chapter metadata from the selected, currently saved Rain Classroom. */
export function YuketangCourseDetailPanel({course,desktop,connected,scopeDirty}:Props){
  const [videos,setVideos]=useState<Video[]>([]);
  const [state,setState]=useState<LoadState>("idle");
  const [message,setMessage]=useState("");
  const revision=useRef(0);

  const load=useCallback(async()=>{
    const current=++revision.current;
    setVideos([]);setMessage("");
    if(!desktop){
      setState("blocked");setMessage("请使用学序 Windows 桌面版读取真实课堂章节。");return;
    }
    if(scopeDirty){
      setState("blocked");setMessage("课堂范围尚未保存，请先在账号与连接中保存，再同步课程列表。");return;
    }
    if(!connected){
      setState("blocked");setMessage("雨课堂会话未确认，请先在账号与连接中检查登录状态。");return;
    }
    setState("loading");
    try{
      const result=await request<Video[]>({
        operation:"videos.list",platform:"yuketang",course_id:course.course_id
      });
      if(current!==revision.current)return;
      if(!Array.isArray(result)||result.some(item=>
        !item||typeof item.id!=="string"||typeof item.name!=="string"||typeof item.chapter!=="string"
      ))throw new Error("INVALID_IPC_RESPONSE");
      setVideos(result);setState("ready");
    }catch(error){
      if(current!==revision.current)return;
      setState("error");setMessage(friendlyBridgeError(error));
    }
  },[course.course_id,desktop,connected,scopeDirty]);

  useEffect(()=>{void load();return ()=>{revision.current++;};},[load]);

  const chapters=useMemo(()=>{
    const groups=new Map<string,Video[]>();
    for(const video of videos){
      const chapter=video.chapter.trim()||"未命名章节";
      if(!groups.has(chapter))groups.set(chapter,[]);
      groups.get(chapter)!.push(video);
    }
    return Array.from(groups.entries());
  },[videos]);

  return <section className="sf-ykt-course-chapters" aria-label="雨课堂章节视频">
    <div className="sf-zd-detail-heading">
      <div><span className="eyebrow">当前课堂 / 只读章节</span><h3>章节与视频</h3>
        <p>使用已保存的雨课堂会话读取当前课程，不读取其他课堂。</p></div>
      <button type="button" className="secondary" disabled={!desktop||!connected||scopeDirty||state==="loading"}
        onClick={()=>void load()}><RefreshCw size={14}/>{state==="loading"?"读取中…":"刷新章节"}</button>
    </div>
    {state==="loading"&&<p role="status">正在读取真实课堂章节…</p>}
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    {state==="ready"&&<div className="sf-ykt-videos">
      {chapters.length===0?<p className="sf-muted">接口已返回，但当前课堂没有可识别的视频章节；请核对课堂范围或平台内容类型。</p>
      :<><p className="sf-muted">已读取 {chapters.length} 个章节、{videos.length} 个视频。</p>
        {chapters.map(([name,items])=><div className="sf-ykt-chapter-group" key={name}>
          <div className="sf-ykt-videos-title"><strong>{name}</strong><span>{items.length} 个视频</span></div>
          {items.map(video=><div className="sf-ykt-video-row" key={video.id}>
            <strong>{video.name}</strong>
          </div>)}
        </div>)}</>}
    </div>}
    <p className="sf-muted">以上是平台返回的章节视频清单，不等于服务器确认的学习进度；没有完成记录时不显示完成百分比。</p>
  </section>;
}

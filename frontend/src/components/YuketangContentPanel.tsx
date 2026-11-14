import type {Config,Video} from '../bridge';
export function YuketangContentPanel({config,videos,desktop,busy,connected,onChange,onShowVideos}:{config:Config;videos:Video[];desktop:boolean;busy:boolean;connected:boolean;onChange:(field:keyof Config,value:string)=>void;onShowVideos:()=>void}){
 return <section className="settings-card" id="sf-ykt-content">
  <div className="section-head"><h3>课堂范围与内容</h3></div>
  <div className="sf-content-scope">
   <label>课堂 ID<input value={config.classroom_id} onChange={event=>onChange('classroom_id',event.target.value)} disabled={!desktop||busy}/></label>
   <label>学校 ID<input value={config.university_id} onChange={event=>onChange('university_id',event.target.value)} disabled={!desktop||busy}/></label>
   <label>章节 Sign（可选）<input type="password" autoComplete="off" value={config.sign} onChange={event=>onChange('sign',event.target.value)} disabled={!desktop||busy}/></label>
  </div>
  <p className="sf-muted">范围修改后，使用上方“保存会话与课堂配置”一并保存。读取与批量任务采用已保存的课堂范围。</p>
  <button className="secondary" disabled={!desktop||busy||!connected} onClick={onShowVideos}>读取已配置课堂的章节视频</button>
  {videos.length>0?<div className="sf-ykt-videos"><div className="sf-ykt-videos-title"><strong>当前课堂章节与视频</strong><span>{videos.length} 条记录</span></div>{videos.map((video,index)=><div className="sf-ykt-video-row" key={video.id+':'+index}><span>{video.chapter}</span><strong>{video.name}</strong></div>)}</div>:<p className="sf-muted">尚未读取当前课堂的章节记录。</p>}
 </section>;
}

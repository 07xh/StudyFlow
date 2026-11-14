import type {Config,Video} from '../bridge';
export function YuketangContentPanel({config,videos,desktop,busy,connected,dirty,hasSession,hasSign,onChange,onSave,onShowVideos}:{config:Config;videos:Video[];desktop:boolean;busy:boolean;connected:boolean;dirty:boolean;hasSession:boolean;hasSign:boolean;onChange:(field:keyof Config,value:string)=>void;onSave:()=>void;onShowVideos:()=>void}){
 return <section className="settings-card" id="sf-ykt-content">
  <div className="sf-content-scope">
   <label>课堂 ID<input type="text" value={config.classroom_id} onChange={event=>onChange('classroom_id',event.target.value)} disabled={!desktop||busy}/></label>
   <label>学校 ID<input type="text" value={config.university_id} onChange={event=>onChange('university_id',event.target.value)} disabled={!desktop||busy}/></label>
   <label>章节 Sign（可选）<input type="password" autoComplete="off" placeholder={hasSign?'已保存，修改后替换':'未设置'} value={config.sign} onChange={event=>onChange('sign',event.target.value)} disabled={!desktop||busy}/></label>
  </div>
  <p className="sf-muted">{hasSession?'读取与批量任务使用已保存的课堂范围。':'首次使用请填写课堂范围，并在账号区保存登录会话。'}</p>
  <div className="actions">
   <button className="primary" disabled={!desktop||busy||!hasSession||!dirty||!/^\d{1,24}$/.test(config.classroom_id.trim())||!/^\d{1,24}$/.test(config.university_id.trim())} onClick={onSave}>保存课堂范围</button>
   <button className="secondary" disabled={!desktop||busy||!connected||dirty} onClick={onShowVideos}>读取已配置课堂的章节视频</button>
  </div>
  {videos.length>0?<div className="sf-ykt-videos"><div className="sf-ykt-videos-title"><strong>当前课堂章节与视频</strong><span>{videos.length} 条记录</span></div>{videos.map((video,index)=><div className="sf-ykt-video-row" key={video.id+':'+index}><span>{video.chapter}</span><strong>{video.name}</strong></div>)}</div>:<p className="sf-muted">尚未读取当前课堂的章节记录。</p>}
 </section>;
}

const labels:Record<string,string>={speed:'播放倍速',limit_minutes:'观看时间限制（分钟）',learn_optional:'包含选学资源',allowMinimize:'允许最小化',autoStart:'自动播放',autoNext:'自动下一节',video_speed:'视频倍速',heartbeat_interval:'心跳间隔（秒）',max_concurrent_videos:'并发数量',completion_threshold:'本地阈值（%）',skip_completed:'跳过已完成',use_concurrent:'并发模式',test_mode:'测试模式',test_video_count:'测试视频数量',auto_richtext:'图文处理',debug:'调试输出',richtext_stay_seconds:'图文停留（秒）',richtext_skip_delay:'图文间隔（秒）'};
export function RunParameters({parameters}:{parameters?:Record<string,string|number|boolean>}){
 return <details className="sf-run-parameters"><summary>本次启动参数</summary>
  {parameters&&Object.keys(parameters).some(key=>labels[key])?<dl>{Object.entries(parameters).filter(([key])=>labels[key]).map(([key,value])=><div key={key}><dt>{labels[key]}</dt><dd>{typeof value==='boolean'?(value?'开启':'关闭'):String(value)}</dd></div>)}</dl>:<p>本次任务没有可关联的启动参数记录。</p>}
 </details>;
}

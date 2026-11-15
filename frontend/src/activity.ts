import type {Platform} from './types';
import {platformNames} from './presentation';
export type EventResult='success'|'warning'|'info';
export type Runner='official'|'zhs'|'yuketang';
export type EventContext={courseId?:string;runId?:string;runner?:Runner;parameters?:Record<string,string|number|boolean>};
export type ActivityEntry=EventContext&{id:string;at:string;platform:string;action:string;result:EventResult;detail:string};
export type TaskRecorder=(action:string,result:EventResult,detail:string,context?:EventContext)=>void;
const parameterNames=new Set(['speed','allowMinimize','autoStart','autoNext','video_speed','heartbeat_interval','max_concurrent_videos','completion_threshold','skip_completed','use_concurrent','test_mode','test_video_count','auto_richtext','debug','richtext_stay_seconds','richtext_skip_delay']);
export function cleanContext(input:EventContext={}):EventContext{
 const context:EventContext={};
 if(typeof input.courseId==='string'&&input.courseId.length<=256)context.courseId=input.courseId;
 if(typeof input.runId==='string'&&input.runId.length<=256)context.runId=input.runId;
 if(input.runner==='official'||input.runner==='zhs'||input.runner==='yuketang')context.runner=input.runner;
 if(input.parameters&&typeof input.parameters==='object'){
  context.parameters=Object.fromEntries(Object.entries(input.parameters).filter(([key,value])=>parameterNames.has(key)&&(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=32)));
 }
 return context;
}
export function storedActivity(value:unknown):ActivityEntry[]{
 if(!Array.isArray(value))return [];
 return value.filter(item=>item&&typeof item==='object'&&typeof item.id==='string'&&typeof item.at==='string'&&Number.isFinite(Date.parse(item.at))&&typeof item.platform==='string'&&typeof item.action==='string'&&['success','warning','info'].includes(item.result)&&typeof item.detail==='string').slice(0,100).map(item=>({id:item.id,at:item.at,platform:item.platform,action:item.action,result:item.result,detail:item.detail,...cleanContext(item)}));
}
export function courseEvents(events:ActivityEntry[],platform:Platform,courseId:string):ActivityEntry[]{
 return events.filter(event=>event.platform===platformNames[platform]&&event.courseId===courseId);
}
export function executionEvents(events:ActivityEntry[]):ActivityEntry[]{
 return events.filter(event=>event.runner||/启动|停止|核验|同步学习进度/.test(event.action));
}

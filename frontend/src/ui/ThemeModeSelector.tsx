import {Monitor,Moon,Sun} from "lucide-react";
import type {ThemeMode} from "./useAppearance";

/** Adapted from LightC-UI 2.18.3's three-mode ThemeToggle interaction. */
const options=[
  {value:"light" as const,label:"浅色",icon:Sun},
  {value:"dark" as const,label:"深色",icon:Moon},
  {value:"system" as const,label:"跟随系统",icon:Monitor}
];
export function ThemeModeSelector({mode,onChange}:{mode:ThemeMode;onChange:(next:ThemeMode)=>void}){
  return <div role="group" aria-label="主题模式" className="sf-theme-options">
    {options.map(item=><button key={item.value} className={mode===item.value?"sf-theme-choice active":"sf-theme-choice"}
      type="button" aria-pressed={mode===item.value} title={item.label} onClick={()=>onChange(item.value)}>
      <item.icon size={16}/><span>{item.label}</span>
    </button>)}
  </div>;
}

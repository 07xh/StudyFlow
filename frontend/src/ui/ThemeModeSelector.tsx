import {Monitor,Moon,Sun} from "lucide-react";
import type {ThemeMode} from "./useAppearance";

type Props={mode:ThemeMode;onChange:(next:ThemeMode)=>void};

/** StudyFlow's three-state theme selector. */
export function ThemeModeSelector({mode,onChange}:Props){
  return <div role="group" aria-label="主题模式" className="sf-theme-options">
    <button type="button" className={mode==="light"?"sf-theme-choice active":"sf-theme-choice"}
      aria-pressed={mode==="light"} title="浅色" onClick={()=>onChange("light")}>
      <Sun size={16}/><span>浅色</span>
    </button>
    <button type="button" className={mode==="dark"?"sf-theme-choice active":"sf-theme-choice"}
      aria-pressed={mode==="dark"} title="深色" onClick={()=>onChange("dark")}>
      <Moon size={16}/><span>深色</span>
    </button>
    <button type="button" className={mode==="system"?"sf-theme-choice active":"sf-theme-choice"}
      aria-pressed={mode==="system"} title="跟随系统" onClick={()=>onChange("system")}>
      <Monitor size={16}/><span>跟随系统</span>
    </button>
  </div>;
}

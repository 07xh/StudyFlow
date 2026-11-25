import {ThemeModeSelector} from "./ThemeModeSelector";
import {Switch} from "./Switch";
import type {ThemeMode} from "./useAppearance";

type Props={
  mode:ThemeMode;
  onModeChange:(mode:ThemeMode)=>void;
  compactCards:boolean;
  onCompactChange:(checked:boolean)=>void;
};

/** Shared appearance settings; preferences are owned by the app shell. */
export function AppearanceSettings({mode,onModeChange,compactCards,onCompactChange}:Props){
  return <section className="settings-card">
        <h3>外观</h3>
        <p className="sf-muted">外观偏好即时生效，无需另行保存。</p>
        <div className="sf-settings-line">
          <div><strong>界面主题</strong></div>
          <ThemeModeSelector mode={mode} onChange={onModeChange}/>
        </div>
        <div className="sf-settings-line">
          <div><strong>紧凑卡片</strong></div>
          <Switch checked={compactCards} aria-label="紧凑卡片" onChange={onCompactChange}/>
        </div>
      </section>;
}

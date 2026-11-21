import {useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {ArrowUpRight,ExternalLink,Globe2} from "lucide-react";
import "./developerSite.css";

const AUTHOR_SITE_URL="https://0701000.xyz/";

/** In-app introduction and a single external entry, not an embedded website. */
export function DeveloperSitePanel({desktop}:{desktop:boolean}){
  const [error,setError]=useState("");
  return <section className="sf-developer-site" aria-label="开发者网站介绍">
    <div className="sf-developer-site-hero">
      <div className="sf-developer-site-icon" aria-hidden="true"><Globe2 size={25}/></div>
      <span className="sf-developer-site-overline">STUDYFLOW · 开发者</span>
      <h3>开发者网站</h3>
      <p>这里是学序 StudyFlow 的开发者网站入口。你可以通过独立网站进一步了解开发者及其其他项目。</p>
    </div>
    <div className="sf-developer-site-card">
      <div className="sf-developer-site-card-copy">
        <strong>访问独立网站</strong>
        <p>网站在浏览器中打开，不嵌入学习助手，也不影响你在各学习平台的登录状态和学习进度。</p>
      </div>
      <a className="sf-developer-site-link" href={AUTHOR_SITE_URL}
        target="_blank" rel="noopener noreferrer"
        onClick={event=>{
          if(!desktop)return;
          event.preventDefault();
          setError("");
          void invoke("studyflow_open_author_site").catch(()=>{
            setError("暂时无法打开开发者网站。请检查系统默认浏览器后重试。");
          });
        }}>
        <ExternalLink size={16}/>访问开发者网站<ArrowUpRight size={15}/>
      </a>
    </div>
    {error&&<p className="sf-developer-site-error" role="status">{error}</p>}
  </section>;
}

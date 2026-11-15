import {useEffect,useId,useRef,useState} from "react";
import type {ReactNode} from "react";
import {ChevronDown,ChevronRight,Search,X} from "lucide-react";

export type RecordFilterOption={id:string;label:string;count:number};
type RecordToolbarProps={
  filters:RecordFilterOption[];
  activeFilter:string;
  onFilter:(id:string)=>void;
  search:string;
  onSearch:(value:string)=>void;
  chapters:string[];
  chapter:string;
  onChapter:(value:string)=>void;
  visibleCount:number;
  totalCount:number;
  onExpandAll:(open:boolean)=>void;
};

/** Shared, platform-neutral course-record controls. No IO or inferred progress. */
export function CourseRecordToolbar({
  filters,activeFilter,onFilter,search,onSearch,chapters,chapter,onChapter,
  visibleCount,totalCount,onExpandAll
}:RecordToolbarProps){
  const [searchOpen,setSearchOpen]=useState(false);
  const inputId=useId();
  const inputRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(searchOpen)inputRef.current?.focus();},[searchOpen]);
  // Closing a compact search must not leave an invisible filter applied.
  const closeSearch=()=>{
    onSearch("");
    setSearchOpen(false);
  };
  const toggleSearch=()=>{
    if(searchOpen)closeSearch();
    else setSearchOpen(true);
  };
  return <div className="sf-record-toolbar" aria-label="章节学习记录筛选">
    <div className="sf-record-toolbar-main">
      <div className="sf-ykt-progress-filters sf-record-status-tabs" role="group" aria-label="筛选学习状态">
        {filters.map(option=><button key={option.id} type="button"
          className={activeFilter===option.id?"active":""}
          aria-pressed={activeFilter===option.id}
          onClick={()=>onFilter(option.id)}>
          {option.label}<span>{option.count}</span>
        </button>)}
      </div>
      <div className="sf-record-toolbar-actions">
        <label className="sf-record-chapter-select">
          <span className="sf-visually-hidden">章节筛选</span>
          <select aria-label="章节筛选" value={chapter} onChange={event=>onChapter(event.target.value)}>
            <option value="">全部章节</option>
            {chapters.map(name=><option value={name} key={name}>{name}</option>)}
          </select>
        </label>
        <button type="button" className={"secondary sf-record-search-toggle"+(searchOpen||search?" active":"")}
          aria-label={searchOpen?"收起搜索":"搜索学习记录"}
          aria-expanded={searchOpen} onClick={toggleSearch}>
          <Search size={15}/>{search&&!searchOpen&&<span className="sf-record-search-dot" aria-hidden="true"/>}
        </button>
        <div className="sf-ykt-expand-actions">
          <button type="button" className="secondary" onClick={()=>onExpandAll(true)}>展开全部</button>
          <button type="button" className="secondary" onClick={()=>onExpandAll(false)}>收起全部</button>
        </div>
      </div>
    </div>
    {searchOpen&&<div className="sf-record-search-field">
      <label htmlFor={inputId}>搜索章节与学习内容</label>
      <input ref={inputRef} id={inputId} type="search" autoComplete="off" placeholder="输入章节、知识点或视频名称"
        value={search} onChange={event=>onSearch(event.target.value)}
        onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();closeSearch();}}}/>
      {search&&<button className="secondary" type="button" aria-label="清除搜索"
        onClick={()=>onSearch("")}><X size={15}/></button>}
    </div>}
    <div className="sf-record-filter-result" aria-live="polite">
      显示 {visibleCount} / {totalCount} 条已读取记录
      {search&&<span> · 正在搜索“{search}”</span>}
    </div>
  </div>;
}

type ChapterGroupProps={
  title:string;
  meta:string;
  expanded:boolean;
  onToggle:()=>void;
  children:ReactNode;
};

/** Same chapter accordion across providers, retaining provider-specific lesson rows. */
export function CourseChapterGroup({title,meta,expanded,onToggle,children}:ChapterGroupProps){
  const detailId=useId();
  return <section className="sf-ykt-chapter-group sf-record-chapter">
    <button type="button" className="sf-ykt-chapter-toggle"
      aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>
      <span className="sf-ykt-chapter-name">
        {expanded?<ChevronDown size={16}/>:<ChevronRight size={16}/>}
        <strong>{title}</strong>
      </span>
      <span className="sf-ykt-chapter-stats">{meta}</span>
    </button>
    {expanded&&<div className="sf-zd-detail-list sf-zd-detail-list-expanded sf-record-chapter-rows"
      id={detailId}>{children}</div>}
  </section>;
}

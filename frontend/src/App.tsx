import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  AlertCircle, BookOpen, CheckCircle2, ChevronRight, CloudOff, GraduationCap,
  LayoutDashboard, LockKeyhole, Moon, RefreshCw, Settings, ShieldCheck,
  Sun, ScanLine, FileJson2, KeyRound, Info, Monitor
} from "lucide-react";
import {fetchCourses, fetchPlatformStatuses, friendlyBridgeError, getStudyFlowTransport} from "./bridge";
import {initialPlatforms} from "./platforms";
import {courseKey, describeConnection, platformNames, presentCourse} from "./presentation";
import type {Course, Platform, PlatformState} from "./types";

type Page = "home" | "courses" | "platforms" | "settings";
type LoginMethod = "qr" | "cookie" | "file";

const order: Platform[] = ["zhidao", "yuketang"];
const navigation: {id: Page; label: string; icon: typeof BookOpen}[] = [
  {id: "home", label: "学习总览", icon: LayoutDashboard},
  {id: "courses", label: "我的课程", icon: BookOpen},
  {id: "platforms", label: "平台连接", icon: ShieldCheck},
  {id: "settings", label: "偏好设置", icon: Settings}
];
const titles: Record<Page, string> = {
  home: "学习总览", courses: "我的课程", platforms: "平台连接", settings: "偏好设置"
};

function storedTheme(): boolean {
  try { return window.localStorage.getItem("studyflow-theme") !== "light"; }
  catch { return true; }
}

function CourseCard({course, onInspect}: {course: Course; onInspect: (item: Course) => void}) {
  const evidence = presentCourse(course);
  return <article className="course-card">
    <div className="course-card-top">
      <span className={"course-type " + course.platform}>
        {platformNames[course.platform]}{course.course_type ? " · " + (course.course_type === "ai" ? "智慧课程" : "共享课程") : ""}
      </span>
      <span className={"evidence " + evidence.status}>{evidence.label}</span>
    </div>
    <h3 title={course.title}>{course.title}</h3>
    <p>{evidence.detail}</p>
    {evidence.percent !== null && <div className="course-progress">
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={evidence.percent} aria-label="服务器上次核验的课程进度">
        <div className="progress-fill" style={{width: evidence.percent + "%"}} />
      </div>
      <span>{evidence.percent.toFixed(1)}%</span>
    </div>}
    <button className="secondary course-action" onClick={() => onInspect(course)}>
      查看课程信息 <ChevronRight size={16}/>
    </button>
  </article>;
}

function ConnectionCard({platform, state, loading, onRefresh}: {
  platform: Platform; state: PlatformState; loading: boolean; onRefresh: () => void
}) {
  const connected = state.status === "connected";
  return <article className="platform-card">
    <div className="platform-top">
      <div className={"platform-logo " + platform}>{platform === "zhidao" ? "知" : "雨"}</div>
      <span className={"connection-label " + state.status}>
        {connected ? <CheckCircle2 size={15}/> : <CloudOff size={15}/>}
        {describeConnection(state)}
      </span>
    </div>
    <h3>{platformNames[platform]}</h3>
    <p>{state.message}</p>
    <div className="platform-footer">
      <span>{connected ? "会话检查已完成" : "不代表账号已登录"}</span>
      <button className="secondary" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={15} className={loading ? "spin" : ""}/>
        检查连接
      </button>
    </div>
  </article>;
}

const loginModes: {id: LoginMethod; label: string; icon: typeof ScanLine; description: string}[] = [
  {id: "qr", label: "扫码登录", icon: ScanLine,
   description: "旧知到桌面端具有二维码刷新、过期处理和自动清理逻辑。学序尚未迁入这套认证流程。"},
  {id: "cookie", label: "直接输入 Cookie", icon: KeyRound,
   description: "为了避免网页预览收集敏感凭据，学序尚未开放 Cookie 输入。后续仅允许在受保护的 Windows 桌面通道中完成验证。"},
  {id: "file", label: "导入 Cookie 文件", icon: FileJson2,
   description: "旧版文件导入与失败回滚逻辑保留在原仓库；学序待完成本机安全文件选择及会话校验后才会启用。"},
];

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [dark, setDark] = useState(storedTheme);
  const [platforms, setPlatforms] = useState<Record<Platform, PlatformState>>({...initialPlatforms});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [courseErrors, setCourseErrors] = useState<Partial<Record<Platform, string>>>({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | Platform>("all");
  const [loginMode, setLoginMode] = useState<LoginMethod>("qr");
  const [inspected, setInspected] = useState<Course | null>(null);
  const updateSerial = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++updateSerial.current;
    const transport = getStudyFlowTransport();
    // Never display courses cached from a previous account/host during a new check.
    setPlatforms({...initialPlatforms});
    setCourseErrors({});
    setErrorMessage(null);
    if (!transport) {
      setLoading(false);
      setErrorMessage("桌面 IPC 运行时尚未接入。此处不会展示模拟课程或模拟登录状态。");
      return;
    }
    setLoading(true);
    try {
      const statuses = await fetchPlatformStatuses(transport);
      const next = {...initialPlatforms};
      const errors: Partial<Record<Platform, string>> = {};
      await Promise.all(statuses.map(async state => {
        next[state.platform] = state;
        if (state.status !== "connected") return;
        try { next[state.platform] = {...state, courses: await fetchCourses(transport, state.platform)}; }
        catch (err) { errors[state.platform] = friendlyBridgeError(err); }
      }));
      if (ticket !== updateSerial.current) return;
      setPlatforms(next);
      setCourseErrors(errors);
    } catch (err) {
      if (ticket !== updateSerial.current) return;
      setPlatforms({...initialPlatforms});
      setErrorMessage(friendlyBridgeError(err));
    } finally {
      if (ticket === updateSerial.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { updateSerial.current += 1; };
  }, [refresh]);

  const toggleTheme = () => {
    setDark(current => {
      try { window.localStorage.setItem("studyflow-theme", current ? "light" : "dark"); }
      catch { /* Theme persistence is best effort and never touches credentials. */ }
      return !current;
    });
  };

  const courses = useMemo(() => order.flatMap(id => platforms[id].courses), [platforms]);
  const filteredCourses = filter === "all" ? courses : courses.filter(c => c.platform === filter);
  const connectedCount = order.filter(id => platforms[id].status === "connected").length;
  const pendingPlatform = order.some(id => platforms[id].status !== "connected");

  const openDetail = (course: Course) => {
    setInspected(course);
    setPage("courses");
  };

  return <div className={dark ? "app dark" : "app"}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><GraduationCap size={23}/></div>
        <div className="brand-text"><strong>学序</strong><small>StudyFlow</small></div>
      </div>
      <div className="section-label">工作空间</div>
      <nav aria-label="主导航">
        {navigation.map(item => <button type="button" key={item.id}
            className={page === item.id ? "nav active" : "nav"}
            onClick={() => {setPage(item.id); setInspected(null);}}
            title={item.label} aria-current={page === item.id ? "page" : undefined}>
          <item.icon size={19}/><span className="nav-text">{item.label}</span>
          {page === item.id && <ChevronRight size={15} className="nav-arrow"/>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy"><ShieldCheck size={18}/>本地优先 · 平台会话隔离</div>
        <small>StudyFlow · UI 迁移版</small>
      </div>
    </aside>
    <main className="main">
      <header className="page-header">
        <div><span className="eyebrow">STUDYFLOW / WORKSPACE</span>
          <h1>{titles[page]}</h1>
          <p className="subtitle">知到与雨课堂统一展示，课程与登录状态只采用真实读取结果。</p>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-button" onClick={() => void refresh()} disabled={loading} title="重新检查平台与课程" aria-label="刷新">
            <RefreshCw size={18} className={loading ? "spin" : ""}/>
          </button>
          <button type="button" className="icon-button" onClick={toggleTheme} title="切换主题" aria-label="切换主题">
            {dark ? <Sun size={18}/> : <Moon size={18}/>}
          </button>
        </div>
      </header>
      {errorMessage && <div className="notice" role="status"><Info size={18}/><span>{errorMessage}</span></div>}
      {page === "home" && <>
        <div className="hero">
          <div><span className="hero-pill">知到 UI 迁移 · 开发阶段</span>
            <h2>让学习井然有序</h2>
            <p>统一管理平台连接、真实课程与进度核验证据，不以本地估算代替服务器记录。</p>
            <button className="primary" type="button" onClick={() => setPage("platforms")}>管理平台连接 <ChevronRight size={17}/></button>
          </div>
          <div className="hero-visual" aria-hidden="true"><GraduationCap size={88} strokeWidth={1}/></div>
        </div>
        <div className="metrics">
          <div className="metric"><span>已核验连接</span><strong>{connectedCount} <small>/ 2</small></strong></div>
          <div className="metric"><span>已读取课程</span><strong>{courses.length}</strong></div>
          <div className="metric"><span>读取状态</span><strong className="metric-state">{loading ? "正在检查" : errorMessage ? "未接入" : pendingPlatform ? "部分未连接" : "已核验"}</strong></div>
        </div>
      </>}
      {(page === "home" || page === "platforms") && <section>
        <div className="section-head"><div><h2>学习平台</h2><p>账号会话与课程数据按平台独立核验。</p></div></div>
        <div className="platform-grid">
          {order.map(id => <ConnectionCard key={id} platform={id} state={platforms[id]} loading={loading} onRefresh={() => void refresh()}/>)}
        </div>
        {order.filter(id => courseErrors[id]).map(id =>
          <div key={id} className="inline-alert"><AlertCircle size={17}/>{platformNames[id]}：{courseErrors[id]}</div>)}
      </section>}
      {(page === "home" || page === "courses") && <section>
        <div className="section-head">
          <div><h2>课程列表</h2><p>仅显示平台实际返回的数据；未核验进度不展示百分比。</p></div>
          {page === "home" && <button className="text-button" type="button" onClick={() => setPage("courses")}>查看全部 <ChevronRight size={16}/></button>}
        </div>
        {page === "courses" && <div className="filters" role="group" aria-label="课程平台筛选">
          {(["all", ...order] as const).map(id => <button type="button" key={id}
            className={filter === id ? "filter active" : "filter"} onClick={() => {setFilter(id); setInspected(null);}}>
            {id === "all" ? "全部课程" : platformNames[id]}
          </button>)}
        </div>}
        {filteredCourses.length ? <div className="course-grid">
          {filteredCourses.map(course => <CourseCard key={courseKey(course)} course={course} onInspect={openDetail}/>)}
        </div> : <div className="empty"><BookOpen size={35}/>
          <strong>{loading ? "正在读取真实课程…" : filter === "all" ? "暂无真实课程数据" : "该平台暂无已读取课程"}</strong>
          <span>完成桌面运行时连接并成功读取课程后，列表才会出现实际课程。</span>
          <button className="secondary" type="button" onClick={() => setPage("platforms")}>查看平台连接</button>
        </div>}
        {page === "courses" && inspected && <div className="detail-card" role="region" aria-label="课程信息">
          <div><span className="eyebrow">{platformNames[inspected.platform]} / 课程信息</span>
            <h3>{inspected.title}</h3>
            <p>{presentCourse(inspected).detail}。课程章节与播放器控制尚未接入学序桌面运行时。</p>
          </div>
          <button className="icon-button" type="button" onClick={() => setInspected(null)} aria-label="关闭课程信息">×</button>
        </div>}
      </section>}
      {page === "platforms" && <section>
        <div className="section-head"><div><h2>知到登录与连接</h2><p>保留旧版的三种登录入口设计，真实认证通道尚待迁移。</p></div></div>
        <div className="login-layout">
          <div className="login-card">
            <div className="login-mode-tabs" role="tablist" aria-label="知到登录方式">
              {loginModes.map(method => <button type="button" key={method.id}
                role="tab" aria-selected={loginMode === method.id}
                className={loginMode === method.id ? "login-mode active" : "login-mode"}
                onClick={() => setLoginMode(method.id)}>
                <method.icon size={18}/><span>{method.label}</span>
              </button>)}
            </div>
            <div className="login-method" role="tabpanel">
              <div className="method-icon"><LockKeyhole size={23}/></div>
              <h3>{loginModes.find(m => m.id === loginMode)?.label}</h3>
              <p>{loginModes.find(m => m.id === loginMode)?.description}</p>
              <button className="secondary" disabled title="受保护的桌面认证通道尚未实现">等待安全登录通道</button>
            </div>
          </div>
          <aside className="login-help">
            <h3><Info size={18}/> 连接流程</h3>
            <ol><li>接入学序 Windows 本地 IPC 运行时</li><li>由平台专属登录模块验证会话</li><li>服务器确认后读取并显示真实课程</li></ol>
            <p>现阶段不会在浏览器预览中收集或保存 Cookie。旧版知到二维码刷新与失效清理逻辑在原项目中保留。</p>
          </aside>
        </div>
      </section>}
      {page === "settings" && <section className="settings-grid">
        <article className="settings-card"><h2><Sun size={20}/> 外观与显示</h2>
          <p>主题偏好只存储在当前设备的本地浏览器环境，不与平台账号或课程数据混合。</p>
          <button className="secondary" onClick={toggleTheme} type="button">
            {dark ? <Sun size={17}/> : <Moon size={17}/>}
            {dark ? "切换浅色模式" : "切换深色模式"}
          </button>
        </article>
        <article className="settings-card"><h2><Monitor size={20}/> Windows 显示适配</h2>
          <p>窗口宽度变化时，侧边导航折叠、课程卡片单列显示；布局使用相对尺寸，适配常见高 DPI 缩放。</p>
          <span className="settings-note">不同缩放比例的 Windows 真机测试尚待完成。</span>
        </article>
        <article className="settings-card"><h2><ShieldCheck size={20}/> 数据与隐私</h2>
          <p>课程来自本机 IPC，页面不会模拟读取结果；知到、雨课堂凭据由各自平台模块隔离管理。</p>
          <span className="settings-note">本阶段尚未提供账户删除和退出登录操作，相关操作不得假装成功。</span>
        </article>
      </section>}
      <footer className="main-footer"><ShieldCheck size={15}/> 第三方非官方 · 数据以平台确认记录为准 · StudyFlow UI 迁移中</footer>
    </main>
  </div>;
}

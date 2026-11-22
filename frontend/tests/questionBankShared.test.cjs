const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");

function mockBridge(){
 const calls=[];
 let stored=[];
 let count=0;
 let mode="fixed";
 const providers=[
  {id:"yanxi",name:"言溪题库",description:"Token 搜题",
   homepage:"https://tk.enncy.cn/",quota_unit:"次",supports_check:true}
 ];
 const snapshot=()=>({
   providers:providers.map(p=>({...p})),
   tokens:stored.map(({secret,...t})=>({...t})),
   rotation_modes:{yanxi:mode},
 });
 const mock={
  friendlyBridgeError:e=>String(e?.message||e),
  questionBankList:async()=>snapshot(),
  questionBankAddToken:async(provider_id,label,token)=>{
   calls.push(["add",provider_id,label,token]);
   stored.push({id:String(++count).padStart(32,"0"),provider_id,label,
     secret:token,active:stored.length===0});
   return snapshot();
  },
  questionBankImportTokens:async(provider_id,lines)=>{
   calls.push(["import",provider_id,lines]);
   const rows=lines.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
   let added=0;
   for(const raw of rows){
    if(stored.some(t=>t.secret===raw))continue;
    stored.push({id:String(++count).padStart(32,"0"),provider_id,
      label:"Token "+String(count).padStart(3,"0"),secret:raw,active:stored.length===0});
    added++;
   }
   if(stored.length>1)mode="round_robin";
   return {...snapshot(),added,skipped:rows.length-added};
  },
  questionBankSetRotation:async(provider_id,next)=>{
   calls.push(["rotation",provider_id,next]);mode=next;return snapshot();
  },
  questionBankCheckToken:async(token_id,include_quota)=>{
   calls.push(["check",token_id,include_quota]);
   stored=stored.map(t=>t.id===token_id
    ?{...t,validity:"valid",checked_at:"2026-11-22T09:00:00Z",
       ...(include_quota?{remaining:12,balance_at:"2026-11-22T09:00:00Z"}:{})}
    :t);
   return snapshot();
  },
  questionBankSelectToken:async id=>{
   calls.push(["select",id]);
   stored=stored.map(t=>({...t,active:t.id===id}));return snapshot();
  },
  questionBankRemoveToken:async id=>{
   calls.push(["remove",id]);
   const wasActive=stored.find(t=>t.id===id)?.active;
   stored=stored.filter(t=>t.id!==id);
   if(wasActive&&stored.length)stored[0].active=true;
   return snapshot();
  },
  questionBankQuery:async(provider_id,question,token_id)=>{
   calls.push(["query",provider_id,question,token_id]);
   return {found:true,answer:"B",remaining:8,status:"matched",
    provider_id,provider_name:"言溪题库",
    token_id:token_id||stored.find(t=>t.active)?.id,
    token_label:stored.find(t=>t.id===(token_id||stored.find(t=>t.active)?.id))?.label||"",
    verified:false};
  },
 };
 return {calls,mock,providers};
}
const modalMocks={
 "@tauri-apps/api/core":{invoke:async()=>{}},
 "../ui/SettingsDialog":({open,children})=>open?React.createElement("section",{"aria-label":"二级题库浮窗"},children):null,
 "../ui/ConfirmDialog":({open,onConfirm})=>open?React.createElement("button",{onClick:onConfirm},"继续检测"):null,
};
function settings(mock){
 return load("components/QuestionBankSettingsPanel.tsx",{
  "bridge.ts":mock,...modalMocks
 }).QuestionBankSettingsPanel;
}
function button(view,label){
 const found=view.root.findAllByType("button").find(b=>textOf(b).includes(label));
 assert.ok(found,"missing button: "+label);
 return found;
}
async function renderSettings(mock){
 let view;
 const Panel=settings(mock);
 await act(async()=>{view=create(React.createElement(Panel,{desktop:true}));});
 return view;
}

test("overview and secondary dialog keep bulk import, rotation and existing token tools",async()=>{
 const {calls,mock}=mockBridge();
 const view=await renderSettings(mock);
 assert.doesNotMatch(textOf(view.root),/手动查询参考资料|查询参考答案/);
 const link=view.root.findAllByType("a").find(a=>a.props["aria-label"]==="言溪题库 官网");
 assert.equal(link.props.href,"https://tk.enncy.cn/");
 assert.equal(link.props.rel,"noopener noreferrer");
 await act(async()=>button(view,"管理").props.onClick());
 const field=view.root.findAllByType("textarea").find(t=>t.props.placeholder?.includes("第 1 条 Token"));
 assert.ok(field);
 await act(async()=>field.props.onChange({target:{value:"aaaaaaaaaaaaaaaa\nbbbbbbbbbbbbbbbb\naaaaaaaaaaaaaaaa"}}));
 await act(async()=>button(view,"批量导入并加密保存").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="import").length,1);
 assert.match(textOf(view.root),/Token 2/);
 assert.doesNotMatch(textOf(view.root),/bbbbbbbbbbbbbbbb/);
 const strategy=view.root.findAllByType("select").find(s=>s.props.value==="round_robin");
 assert.ok(strategy);
 await act(async()=>strategy.props.onChange({target:{value:"fixed"}}));
 assert.deepEqual(calls.at(-1),["rotation","yanxi","fixed"]);
 await act(async()=>button(view,"设默认").props.onClick());
 assert.equal(calls.at(-1)[0],"select");
 const deleteButton=view.root.findAllByType("button").find(b=>b.props["aria-label"]==="删除 Token Token 002");
 await act(async()=>deleteButton.props.onClick());
 assert.match(textOf(view.root),/Token 1/);
});

test("one click checks all tokens; quota check is an explicitly confirmed second operation",async()=>{
 const {calls,mock}=mockBridge();
 const view=await renderSettings(mock);
 await act(async()=>button(view,"管理").props.onClick());
 const field=view.root.findAllByType("textarea")[0];
 await act(async()=>field.props.onChange({target:{value:"aaaaaaaaaaaaaaaa\nbbbbbbbbbbbbbbbb"}}));
 await act(async()=>button(view,"批量导入并加密保存").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="check").length,0);
 await act(async()=>button(view,"检测全部").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="check").length,2);
 assert.ok(calls.filter(c=>c[0]==="check").every(c=>c[2]===false));
 assert.match(textOf(view.root),/已识别可用2/);
 assert.match(textOf(view.root),/未知/);
 await act(async()=>button(view,"检测并更新余量").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="check").length,2);
 await act(async()=>button(view,"继续检测").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="check").length,4);
 assert.ok(calls.slice(-2).every(c=>c[2]===true));
 assert.match(textOf(view.root),/24 次/);
 assert.match(textOf(view.root),/2 \/ 2 条有余量记录/);
});

test("provider rows derive from registered providers, each with its own official site",async()=>{
 const {mock,providers}=mockBridge();
 providers.push({id:"next",name:"新题库",description:"可扩展适配器",
   homepage:"https://example.org/",quota_unit:"点",supports_check:false});
 const view=await renderSettings(mock);
 assert.match(textOf(view.root),/新题库/);
 const links=view.root.findAllByType("a").map(a=>a.props.href);
 assert.deepEqual(links.sort(),["https://example.org/","https://tk.enncy.cn/"]);
 assert.doesNotMatch(textOf(view.root),/手动查询参考资料/);
});

test("any question row sends normalized text and options only after explicit search",async()=>{
 const {calls,mock}=mockBridge();
 await mock.questionBankAddToken("yanxi","一号","aaaaaaaaaaaaaaaa");
 calls.length=0;
 const {QuestionBankQuestionAction}=load("components/QuestionBankQuestionAction.tsx",{"bridge.ts":mock});
 const question={title:"示例知到普通作业题",question_type:"单选",
  options:[{key:"A",text:"甲"},{key:"B",text:"乙"}]};
 let view;
 await act(async()=>{view=create(React.createElement(QuestionBankQuestionAction,{desktop:true,question}));});
 assert.equal(calls.length,0);
 await act(async()=>button(view,"题库查题").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="query").length,0);
 await act(async()=>button(view,"查询这道题").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="query").length,1);
 assert.deepEqual(calls[0].slice(0,3),["query","yanxi",question]);
 assert.match(textOf(view.root),/参考答案（未核验）/);
 assert.match(textOf(view.root),/剩余次数：8/);
 assert.equal(calls.filter(c=>c[0]==="submit").length,0);
});

test("web-only question bank action is hidden",()=>{
 const {QuestionBankQuestionAction}=load("components/QuestionBankQuestionAction.tsx",{
  "bridge.ts":{questionBankList:async()=>({providers:[],tokens:[]})}
 });
 let view;
 act(()=>{view=create(React.createElement(QuestionBankQuestionAction,{
  desktop:false,question:{title:"题目"}
 }));});
 assert.equal(view.toJSON(),null);
});

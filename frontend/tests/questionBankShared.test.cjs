const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");

function mockBridge(){
 const calls=[];
 let stored=[];
 const provider={id:"yanxi",name:"言溪题库",description:"Token 搜题"};
 const snapshot=()=>({providers:[provider],tokens:stored.map(({secret,...t})=>({...t})),rotation_modes:{yanxi:mode}});
 let count=0;
 let mode="fixed";
 const mock={
  friendlyBridgeError:e=>String(e?.message||e),
  questionBankList:async()=>snapshot(),
  questionBankAddToken:async(provider_id,label,token)=>{
   calls.push(["add",provider_id,label,token]);
   stored.push({id:String(++count).padStart(32,"0"),provider_id,label,active:stored.length===0});
   return snapshot();
  },
  questionBankImportTokens:async(provider_id,lines)=>{
   calls.push(["import",provider_id,lines]);
   const rows=lines.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
   let added=0;
   for(const raw of rows){
    if(stored.some(t=>t.secret===raw))continue;
    stored.push({id:String(++count).padStart(32,"0"),provider_id,label:"Token "+String(count).padStart(3,"0"),
      secret:raw,active:stored.length===0});added++;
   }
   if(stored.length>1)mode="round_robin";
   return {...snapshot(),added,skipped:rows.length-added};
  },
  questionBankSetRotation:async(provider_id,next)=>{
   calls.push(["rotation",provider_id,next]);mode=next;return snapshot();
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
 return {calls,mock};
}

test("one provider supports newline-separated bulk token import without exposing secrets",async()=>{
 const {calls,mock}=mockBridge();
 const {QuestionBankSettingsPanel}=load("components/QuestionBankSettingsPanel.tsx",{"bridge.ts":mock});
 let view;
 await act(async()=>{view=create(React.createElement(QuestionBankSettingsPanel,{desktop:true}));});
 const click=label=>view.root.findAllByType("button").find(b=>textOf(b).includes(label));
 const field=view.root.findAllByType("textarea").find(t=>t.props.placeholder?.includes("第 1 条 Token"));
 assert.ok(field);
 await act(async()=>field.props.onChange({target:{value:"aaaaaaaaaaaaaaaa\nbbbbbbbbbbbbbbbb\naaaaaaaaaaaaaaaa"}}));
 await act(async()=>click("批量导入并加密保存").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="import").length,1);
 assert.match(textOf(view.root),/Token（2）/);
 assert.doesNotMatch(textOf(view.root),/bbbbbbbbbbbbbbbb/);
 const mode=view.root.findAllByType("select").find(s=>s.props.value==="round_robin");
 assert.ok(mode,"two new tokens should enable automatic rotation");
 await act(async()=>mode.props.onChange({target:{value:"fixed"}}));
 assert.deepEqual(calls.at(-1),["rotation","yanxi","fixed"]);
 const choose=view.root.findAllByType("button").filter(b=>textOf(b)==="设为默认");
 await act(async()=>choose[0].props.onClick());
 assert.equal(calls.at(-1)[0],"select");
 const deleteButton=view.root.findAllByType("button").find(b=>b.props["aria-label"]==="删除 Token Token 002");
 await act(async()=>deleteButton.props.onClick());
 assert.match(textOf(view.root),/Token（1）/);
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
 const click=label=>view.root.findAllByType("button").find(b=>textOf(b).includes(label));
 await act(async()=>click("题库查题").props.onClick());
 assert.equal(calls.filter(c=>c[0]==="query").length,0);
 await act(async()=>click("查询这道题").props.onClick());
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

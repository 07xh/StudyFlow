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
 const snapshot=()=>({providers:[provider],tokens:stored.map(t=>({...t}))});
 let count=0;
 const mock={
  friendlyBridgeError:e=>String(e?.message||e),
  questionBankList:async()=>snapshot(),
  questionBankAddToken:async(provider_id,label,token)=>{
   calls.push(["add",provider_id,label,token]);
   stored.push({id:String(++count).padStart(32,"0"),provider_id,label,active:stored.length===0});
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
 return {calls,mock};
}

test("shared settings manages multiple named tokens with explicit selection and no plaintext reply",async()=>{
 const {calls,mock}=mockBridge();
 const {QuestionBankSettingsPanel}=load("components/QuestionBankSettingsPanel.tsx",{"bridge.ts":mock});
 let view;
 await act(async()=>{view=create(React.createElement(QuestionBankSettingsPanel,{desktop:true}));});
 const input=placeholder=>view.root.findAllByType("input").find(i=>i.props.placeholder?.includes(placeholder));
 const click=label=>view.root.findAllByType("button").find(b=>textOf(b).includes(label));
 async function add(label,token){
  await act(async()=>input("言溪账号").props.onChange({target:{value:label}}));
  await act(async()=>input("本人的题库").props.onChange({target:{value:token}}));
  await act(async()=>click("加密保存 Token").props.onClick());
 }
 await add("一号","aaaaaaaaaaaaaaaa");
 await add("二号","bbbbbbbbbbbbbbbb");
 assert.equal(calls.filter(c=>c[0]==="add").length,2);
 assert.match(textOf(view.root),/已保存 Token（2）/);
 assert.match(textOf(view.root),/二号/);
 assert.doesNotMatch(textOf(view.root),/bbbbbbbbbbbbbbbb/);
 const choose=view.root.findAllByType("button").filter(b=>textOf(b)==="设为默认");
 await act(async()=>choose[0].props.onClick());
 assert.equal(calls.at(-1)[0],"select");
 const deleteButton=view.root.findAllByType("button").find(b=>b.props["aria-label"]==="删除 Token 二号");
 await act(async()=>deleteButton.props.onClick());
 assert.match(textOf(view.root),/已保存 Token（1）/);
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

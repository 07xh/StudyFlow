const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");

test("Yanxi settings and reference query are explicit and do not submit an exercise",async()=>{
  const calls=[];
  const mock={
    friendlyBridgeError:e=>String(e?.message||e),
    yanxiStatus:async()=>({configured:false}),
    yanxiSaveToken:async token=>{calls.push(["save",token]);return {configured:true};},
    yanxiClearToken:async()=>{calls.push(["clear"]);return {configured:false};},
    yanxiQuery:async(title,options,type)=>{
      calls.push(["query",title,options,type]);
      return {found:true,answer:"B",remaining:5,status:"matched",source:"yanxi_external_unverified"};
    },
  };
  const {YanxiQuestionBankPanel}=load("components/YanxiQuestionBankPanel.tsx",{"bridge.ts":mock});
  const question={question_id:42,question_type:1,content:"题干一",
    options:[{id:1,content:"错误"},{id:2,content:"正确"}]};
  let view;
  await act(async()=>{view=create(React.createElement(YanxiQuestionBankPanel,{desktop:true,questions:[question]}));});
  assert.equal(calls.length,0,"mounting must never send a paid lookup");
  const password=view.root.findAllByType("input").find(x=>x.props.type==="password");
  await act(async()=>password.props.onChange({target:{value:"token12345678"}}));
  const button=label=>view.root.findAllByType("button").find(x=>textOf(x).includes(label));
  await act(async()=>button("保存 Token").props.onClick());
  assert.equal(calls.filter(x=>x[0]==="save").length,1);
  const selector=view.root.findAllByType("select")[0];
  await act(async()=>selector.props.onChange({target:{value:"42"}}));
  assert.equal(calls.filter(x=>x[0]==="query").length,0);
  await act(async()=>button("查询参考答案").props.onClick());
  assert.deepEqual(calls.find(x=>x[0]==="query"),
    ["query","题干一","A. 错误\\nB. 正确","单选"]);
  assert.match(textOf(view.root),/言溪参考答案（未验证）/);
  assert.match(textOf(view.root),/剩余次数：5/);
  await act(async()=>button("清除").props.onClick());
  assert.equal(calls.at(-1)[0],"clear");
});

test("Yanxi panel is not mounted for web-only usage",()=>{
  const {YanxiQuestionBankPanel}=load("components/YanxiQuestionBankPanel.tsx",{
    "bridge.ts":{yanxiStatus:async()=>({configured:false})},
  });
  let view;
  act(()=>{view=create(React.createElement(YanxiQuestionBankPanel,{desktop:false}));});
  assert.equal(view.toJSON(),null);
});

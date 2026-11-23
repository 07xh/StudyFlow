const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
const snapshot=(count)=>({
  providers:[{id:"bank",name:"示例题库",description:"",supports_check:true}],
  tokens:Array.from({length:count},(_,i)=>({
    id:String(i+1).padStart(32,"0"),provider_id:"bank",
    label:"Token "+(i+1),validity:"valid",active:i===0,remaining:10,
  })),
  rotation_modes:{bank:"fixed"},
});
const modalMocks={
  "@tauri-apps/api/core":{invoke:async()=>{}},
  "../ui/SettingsDialog":{SettingsDialog:({open,children})=>open?
    React.createElement("section",{"aria-label":"二级题库浮窗"},children):null},
  "../ui/ConfirmDialog":{ConfirmDialog:()=>null},
};
async function render(list){
  const {QuestionBankSettingsPanel}=load("components/QuestionBankSettingsPanel.tsx",{
    "bridge.ts":{
      questionBankList:list,
      questionBankCheckToken:async()=>{throw Error("must not check");},
      questionBankImportTokens:async()=>{throw Error("must not import");},
      questionBankRemoveToken:async()=>{throw Error("must not remove");},
      questionBankSelectToken:async()=>{throw Error("must not select");},
      questionBankSetRotation:async()=>{throw Error("must not rotate");},
      friendlyBridgeError:error=>String(error?.message||error),
    },
    ...modalMocks,
  });
  let view;
  await act(async()=>view=create(React.createElement(QuestionBankSettingsPanel,{desktop:true})));
  return view;
}
function button(view,label){
  const b=view.root.findAllByType("button").find(x=>textOf(x).includes(label));
  assert.ok(b,"button missing: "+label);
  return b;
}

test("manual reload recovers from hanging initial read and ignores late failure",async()=>{
  const old=deferred();let calls=0;
  const view=await render(()=>++calls===1?old.promise:Promise.resolve(snapshot(2)));
  try{
    assert.match(textOf(view.root),/正在读取本机题库配置/);
    assert.equal(button(view,"刷新列表").props.disabled,false);
    await act(async()=>button(view,"刷新列表").props.onClick());
    assert.equal(calls,2);
    assert.match(textOf(view.root),/已重新载入本机题库和 Token 配置/);
    assert.match(textOf(view.root),/已保存 Token2/);
    assert.equal(button(view,"管理").props.disabled,false,
      "a newer successful reload must unblock management even while initial read hangs");
    await act(async()=>old.reject(new Error("OLD_READ_FAILURE")));
    assert.doesNotMatch(textOf(view.root),/OLD_READ_FAILURE/);
    assert.match(textOf(view.root),/已保存 Token2/);
  }finally{await act(async()=>view.unmount());}
});

test("explicit reload displays token changes saved elsewhere without checking quota",async()=>{
  let count=1,calls=0;
  const view=await render(async()=>{calls++;return snapshot(count);});
  try{
    assert.match(textOf(view.root),/已保存 Token1/);
    count=3;
    await act(async()=>button(view,"刷新列表").props.onClick());
    assert.equal(calls,2,"reload only reads shared vault once");
    assert.match(textOf(view.root),/已保存 Token3/);
    assert.match(textOf(view.root),/已重新载入本机题库和 Token 配置/);
    await act(async()=>button(view,"管理").props.onClick());
    assert.match(textOf(view.root),/Token 3/);
    assert.equal(calls,2,"opening secondary settings is not an extra request");
  }finally{await act(async()=>view.unmount());}
});

test("pending reload disables management and failures leave last confirmed snapshot",async()=>{
  const pending=deferred();let calls=0;
  const view=await render(()=>++calls===1?Promise.resolve(snapshot(1)):
    calls===2?pending.promise:Promise.resolve(snapshot(2)));
  try{
    await act(async()=>button(view,"管理").props.onClick());
    await act(async()=>button(view,"刷新列表").props.onClick());
    assert.equal(button(view,"刷新中…").props.disabled,true);
    assert.equal(button(view,"管理").props.disabled,true);
    assert.equal(button(view,"检测全部").props.disabled,true);
    assert.equal(view.root.findAllByType("select")[0].props.disabled,true);
    await act(async()=>pending.reject(new Error("TEMPORARY_LIST_FAILURE")));
    assert.match(textOf(view.root),/TEMPORARY_LIST_FAILURE/);
    assert.match(textOf(view.root),/已保存 Token1/);
    assert.equal(button(view,"刷新列表").props.disabled,false);
    await act(async()=>button(view,"刷新列表").props.onClick());
    assert.doesNotMatch(textOf(view.root),/TEMPORARY_LIST_FAILURE/);
    assert.match(textOf(view.root),/已保存 Token2/);
  }finally{await act(async()=>view.unmount());}
});

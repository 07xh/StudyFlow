const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};
const snapshot=count=>({
  providers:[{id:"yanxi",name:"言溪题库",description:"",supports_check:true}],
  tokens:Array.from({length:count},(_,i)=>({
    id:String(i+1).padStart(32,"0"),provider_id:"yanxi",
    label:"Token "+String(i+1).padStart(3,"0"),active:i===0,validity:"unchecked",
  })),
  rotation_modes:{yanxi:"fixed"},
});

async function setup(initialCount){
  const original=global.window;
  const bus=new EventTarget();
  global.window=bus;
  const stale=deferred();
  let calls=0,view;
  let count=initialCount;
  const mock={
    questionBankList:()=>++calls===2?stale.promise:Promise.resolve(snapshot(count)),
    questionBankImportTokens:async(provider,lines)=>{
      assert.equal(provider,"yanxi");
      assert.equal(lines,"example-new-token");
      count++;
      return {...snapshot(count),added:1,skipped:0};
    },
    questionBankRemoveToken:async id=>{
      assert.equal(id,String(initialCount).padStart(32,"0"));
      count--;return snapshot(count);
    },
    questionBankCheckToken:async()=>{throw Error("unexpected check");},
    questionBankSelectToken:async()=>{throw Error("unexpected selection");},
    questionBankSetRotation:async()=>{throw Error("unexpected rotation");},
    friendlyBridgeError:error=>String(error?.message||error),
  };
  try{
    const {QuestionBankSettingsPanel}=load("components/QuestionBankSettingsPanel.tsx",{
      "bridge.ts":mock,
      "@tauri-apps/api/core":{invoke:async()=>{}},
      "../ui/SettingsDialog":{SettingsDialog:({open,children})=>open?
        React.createElement("section",{"aria-label":"题库管理"},children):null},
      "../ui/ConfirmDialog":{ConfirmDialog:()=>null},
    });
    await act(async()=>view=create(React.createElement(QuestionBankSettingsPanel,{desktop:true})));
    const button=part=>{
      const found=view.root.findAllByType("button").find(x=>textOf(x).includes(part));
      assert.ok(found,"missing button: "+part);return found;
    };
    await act(async()=>button("管理").props.onClick());
    const beginExternalRead=async()=>{
      await act(async()=>bus.dispatchEvent(new Event("studyflow:question-bank-config-changed")));
      assert.equal(calls,2,"external event must start a read while idle");
    };
    return {view,button,stale,beginExternalRead,getCalls:()=>calls,cleanup:async()=>{
      await act(async()=>view.unmount());global.window=original;
    }};
  }catch(cause){
    if(view)await act(async()=>view.unmount());
    global.window=original;
    throw cause;
  }
}

test("delayed external list success cannot overwrite newly imported Token",async()=>{
  const ctx=await setup(1);
  try{
    await ctx.beginExternalRead();
    const field=ctx.view.root.findByType("textarea");
    await act(async()=>field.props.onChange({target:{value:"example-new-token"}}));
    await act(async()=>ctx.button("批量导入并加密保存").props.onClick());
    assert.match(textOf(ctx.view.root),/已保存 Token2/);
    assert.match(textOf(ctx.view.root),/已导入 1 条/);
    await act(async()=>ctx.stale.resolve(snapshot(1)));
    assert.match(textOf(ctx.view.root),/已保存 Token2/,
      "old event read must not erase authoritative import response");
    assert.match(textOf(ctx.view.root),/Token 002/);
    assert.match(textOf(ctx.view.root),/已导入 1 条/);
    assert.equal(ctx.getCalls(),2,"local import must not cause redundant list reads");
  }finally{await ctx.cleanup();}
});

test("delayed external list failure cannot display obsolete error after Token deletion",async()=>{
  const ctx=await setup(2);
  try{
    await ctx.beginExternalRead();
    const remove=ctx.view.root.findAllByType("button")
      .find(x=>x.props["aria-label"]==="删除 Token Token 002");
    assert.ok(remove);
    await act(async()=>remove.props.onClick());
    assert.match(textOf(ctx.view.root),/已保存 Token1/);
    assert.match(textOf(ctx.view.root),/Token 已从本机加密保险库中删除/);
    await act(async()=>ctx.stale.reject(new Error("OLD_LIST_READ_FAILED")));
    assert.doesNotMatch(textOf(ctx.view.root),/OLD_LIST_READ_FAILED/,
      "an obsolete list error cannot make a completed mutation appear broken");
    assert.match(textOf(ctx.view.root),/已保存 Token1/);
    assert.doesNotMatch(textOf(ctx.view.root),/Token 002/);
    assert.equal(ctx.getCalls(),2);
  }finally{await ctx.cleanup();}
});

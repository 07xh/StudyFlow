const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
const Q1={title:"同一题号的题目",question_type:"单选",options:[{key:"A",text:"甲"}]};
const Q2={title:"同一题号的题目",question_type:"单选",options:[{key:"A",text:"乙"}]};
const BANK_A={providers:[{id:"a",name:"旧题库"}],
  tokens:[{id:"1".repeat(32),provider_id:"a",label:"旧 Token",active:true}]};
const BANK_B={providers:[{id:"b",name:"新题库"}],
  tokens:[{id:"2".repeat(32),provider_id:"b",label:"新 Token",active:true}]};
const answer=(value,remaining=null)=>({
  found:true,answer:value,remaining,status:"matched",provider_id:"b",
  provider_name:"新题库",token_id:"2".repeat(32),token_label:"新 Token",verified:false,
});

async function withAction(list,query,check){
  const original=global.window;
  const bus=new EventTarget();
  global.window=bus;
  let view;
  let signals=0;
  bus.addEventListener("studyflow:question-bank-config-changed",()=>signals++);
  try{
    const {QuestionBankQuestionAction}=load("components/QuestionBankQuestionAction.tsx",{
      "bridge.ts":{
        questionBankList:list,questionBankQuery:query,
        friendlyBridgeError:err=>String(err?.message||err),
      }
    });
    await act(async()=>view=create(React.createElement(QuestionBankQuestionAction,{
      desktop:true,question:Q1,
    })));
    const button=label=>{
      const found=view.root.findAllByType("button").find(b=>textOf(b).includes(label));
      assert.ok(found,"missing button "+label);
      return found;
    };
    const change=async question=>act(async()=>view.update(React.createElement(
      QuestionBankQuestionAction,{desktop:true,question},
    )));
    await check({view,button,change,signals:()=>signals});
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
}

test("late answer for old options never appears under a changed question, but still invalidates balance",async()=>{
  const previous=deferred(),calls=[];
  await withAction(async()=>BANK_B,async(provider,question)=>{
    calls.push([provider,question]);
    return calls.length===1?previous.promise:answer("B_CORRECT",7);
  },async({view,button,change,signals})=>{
    await act(async()=>button("题库查题").props.onClick());
    await act(async()=>button("查询这道题").props.onClick());
    assert.match(textOf(view.root),/查询中…/);
    await change(Q2);
    assert.match(textOf(view.root),/题库查题/);
    assert.doesNotMatch(textOf(view.root),/查询中…/);
    await act(async()=>previous.resolve(answer("A_OLD_WRONG",5)));
    assert.doesNotMatch(textOf(view.root),/A_OLD_WRONG|剩余次数：5/);
    assert.equal(signals(),1,"old request may update balance in the shared vault");
    await act(async()=>button("题库查题").props.onClick());
    await act(async()=>button("查询这道题").props.onClick());
    assert.equal(calls.length,2);
    assert.deepEqual(calls.map(x=>x[1].options[0].text),["甲","乙"]);
    assert.match(textOf(view.root),/B_CORRECT/);
    assert.doesNotMatch(textOf(view.root),/A_OLD_WRONG/);
    assert.equal(signals(),2);
  });
});

test("late list from previous question does not overwrite the newly opened provider",async()=>{
  const oldList=deferred();
  let reads=0;
  await withAction(()=>++reads===1?oldList.promise:Promise.resolve(BANK_B),
    async()=>answer("unused"),async({view,button,change})=>{
      await act(async()=>button("题库查题").props.onClick());
      assert.match(textOf(view.root),/正在读取本机题库/);
      await change(Q2);
      await act(async()=>button("题库查题").props.onClick());
      assert.equal(reads,2);
      const selected=()=>view.root.findAllByType("select")[0]?.props.value;
      assert.equal(selected(),"b");
      await act(async()=>oldList.resolve(BANK_A));
      assert.equal(selected(),"b");
      assert.match(textOf(view.root),/新题库/);
      assert.doesNotMatch(textOf(view.root),/旧题库/);
    });
});

test("closing and reopening while first bank read hangs discards its late failure",async()=>{
  const first=deferred();
  let reads=0;
  await withAction(()=>++reads===1?first.promise:Promise.resolve(BANK_B),
    async()=>answer("unused"),async({view,button})=>{
      await act(async()=>button("题库查题").props.onClick());
      await act(async()=>button("收起题库").props.onClick());
      await act(async()=>button("题库查题").props.onClick());
      assert.equal(reads,2);
      assert.match(textOf(view.root),/新题库/);
      await act(async()=>first.reject(new Error("OLD_LIST_FAILURE")));
      assert.doesNotMatch(textOf(view.root),/OLD_LIST_FAILURE/);
      assert.match(textOf(view.root),/新 Token/);
    });
});

test("a previously displayed answer is hidden when the same row changes question",async()=>{
  await withAction(async()=>BANK_B,async()=>answer("OLD_RESULT"),
    async({view,button,change})=>{
      await act(async()=>button("题库查题").props.onClick());
      await act(async()=>button("查询这道题").props.onClick());
      assert.match(textOf(view.root),/OLD_RESULT/);
      await change(Q2);
      assert.doesNotMatch(textOf(view.root),/OLD_RESULT/);
      assert.equal(button("题库查题").props["aria-expanded"],false);
    });
});

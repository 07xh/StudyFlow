const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');

const key='a'.repeat(64);
const textOf=node=>typeof node==='string'?node:
  (node.children??[]).map(textOf).join('');

/** 选项是 label > input + span，按选项文本定位才可靠（顺序即卷面顺序）。 */
const optionInput=(view,label)=>view.root.findAllByType('label')
  .find(node=>textOf(node).includes(label)).findByType('input');

const catalog={
  course_key:key,course_id:'2095430049486426112',class_id:'339597',
  course_name:'AI 课程',threshold:90,
  knowledge:[{knowledge_id:'1853343377786015744',name:'知识点甲',theme:'主题一',
    study_progress:80,free_exam:false,mastery:40,band:'low'}],
  count:1,pending_count:1,average_mastery:40,verified_at:'2026-11-21T10:00:00Z'
};

const round={
  course_key:key,knowledge_id:'1853343377786015744',
  exam_test_id:4263949,exam_paper_id:454449917,question_num:1,
  questions:[{question_id:939136618,content:'中国特色社会主义进入',question_type:1,
    type_name:'单选',options:[
      {id:671372791,content:'旧阶段'},{id:671372794,content:'新时代'}]}],
  high_mastery:40,mastery:null,mastery_change:null,threshold:90,
  opened_at:'2026-11-21T10:00:00Z'
};

const submitted={
  knowledge_id:'1853343377786015744',exam_test_id:4263949,exam_paper_id:454449917,
  submitted:true,
  round_score:{correct:1,total:1,percent:100},
  graded:[{questionId:939136618,questionType:1,graded:true,isCorrect:true,
    answers:[{answer:'671372794',isCorrect:true}],
    correctOptionIds:[671372794],correctTexts:['新时代'],analysis:'官方解析文本'}],
  mastery_before:{high:40,this_round_start:null},
  mastery_after:{mastery:85,band:'high',reached_threshold:false},
  mastery_error:null,high_mastery_now:85,threshold:90,reached_threshold:false,
  next_round_hint:'practice_more',verified_at:'2026-11-21T10:05:00Z'
};

function bridgeMock(state){
  const calls=[];
  state.calls=calls;
  return {
    friendlyBridgeError:error=>String(error?.message||error),
    masteryCatalog:async(courseKey,withMastery)=>{
      calls.push(['catalog',courseKey,withMastery]);return catalog;
    },
    masteryActiveRound:async()=>{calls.push(['active']);return state.active??null;},
    masteryStartRound:async()=>{calls.push(['start']);return round;},
    masterySaveAnswer:async(courseKey,knowledgeId,questionId,answer)=>{
      calls.push(['save',String(questionId),answer]);return {saved:true,complete:true};
    },
    masterySubmitRound:async()=>{calls.push(['submit']);return submitted;},
    masteryDiscardRound:async()=>{calls.push(['discard']);return {discarded:true};},
  };
}

async function mount(mock,props={}){
  const {MasteryPanel}=load('components/MasteryPanel.tsx',{'bridge.ts':mock});
  let view;
  await act(async()=>{
    view=create(React.createElement(MasteryPanel,{courseKey:key,courseTitle:'AI 课程',desktop:true,...props}));
  });
  return view;
}

test('mastery panel answers, saves, submits and shows this round score apart from mastery',async()=>{
  const state={};
  const mock=bridgeMock(state);
  const view=await mount(mock);

  assert.equal(state.calls[0][0],'catalog');
  assert.equal(state.calls[0][2],true,'掌握度必须走只读读取，而不是建卷');
  assert.match(textOf(view.root),/知识点甲/);

  const row=view.root.findAllByType('button').find(node=>textOf(node).includes('知识点甲'));
  await act(async()=>{row.props.onClick();});
  assert.deepEqual(state.calls.filter(c=>c[0]==='active').length,1,
    '打开知识点应先查是否有未提交的一轮');
  assert.match(textOf(view.root),/中国特色社会主义进入/);

  const option=optionInput(view,'新时代');
  await act(async()=>{option.props.onChange({target:{}});});

  const save=view.root.findAllByType('button').find(node=>textOf(node).includes('保存答案'));
  await act(async()=>{save.props.onClick();});
  const savedCall=state.calls.find(c=>c[0]==='save');
  assert.deepEqual(savedCall,['save','939136618',671372794],
    'answer 要传选项 id，分隔符由协议层拼');

  const submit=view.root.findAllByType('button').find(node=>textOf(node).includes('提交本轮'));
  await act(async()=>{submit.props.onClick();});
  assert.equal(state.calls.filter(c=>c[0]==='submit').length,1,'不提交就不计分');
  // 提交后重新读一次掌握度，界面上的数字才是新的。
  assert.equal(state.calls.filter(c=>c[0]==='catalog').length,2);

  const text=textOf(view.root);
  assert.match(text,/本轮 1\/1/);
  assert.match(text,/不是历史最高掌握度/);
  assert.match(text,/正确答案：新时代/);
  assert.match(text,/官方解析文本/);
  assert.match(text,/85/);
});

test('mastery panel restores an unsubmitted round with saved answers already marked',async()=>{
  const mock=bridgeMock({active:{
    knowledge_id:'1853343377786015744',exam_test_id:4263949,exam_paper_id:454449917,
    questions:round.questions,answers:{'939136618':'671372794'},
    draft:{'939136618':671372794},answered:1,total:1,high_mastery:40,
    opened_at:'2026-11-21T10:00:00Z'
  }});
  const view=await mount(mock);

  await act(async()=>{
    view.root.findAllByType('button').find(node=>textOf(node).includes('知识点甲')).props.onClick();
  });

  assert.match(textOf(view.root),/恢复了一轮未提交的练习/);
  const option=optionInput(view,'新时代');
  assert.equal(option.props.checked,true,'恢复的答案要回填到点选状态');
  assert.equal(optionInput(view,'旧阶段').props.checked,false,'没选的选项不能被点亮');
  const save=view.root.findAllByType('button').find(node=>textOf(node).includes('保存答案'));
  assert.equal(save.props.disabled,true,'已保存过的答案不该再写一遍');
});

test('mastery panel refuses to run outside the desktop shell',async()=>{
  const state={};
  const view=await mount(bridgeMock(state),{desktop:false});
  assert.match(textOf(view.root),/需要在桌面版中运行/);
  assert.equal(state.calls.length,0,'未连接桌面时不应该发起请求');
});

test('lazy section keeps its panel unmounted until first expand, then never drops it',async()=>{
  // 掌握度段落一旦挂载就会去读网络，所以收起状态下不能替用户先请求一轮；
  // 展开过之后要常驻，否则收起再展开会丢掉还没保存的作答。
  const {CollapsibleSection}=load('ui/CollapsibleSection.tsx');
  let live=0;
  const Child=()=>{
    React.useEffect(()=>{live+=1;return()=>{live-=1;};},[]);
    return React.createElement('p',null,'面板内容');
  };
  let view;
  await act(async()=>{
    view=create(React.createElement(CollapsibleSection,
      {id:'test:lazy',title:'AI 掌握度',defaultExpanded:false,lazy:true},
      React.createElement(Child)));
  });
  const toggle=()=>view.root.findAllByType('button')[0];
  assert.equal(live,0,'收起状态不该挂载面板');

  await act(async()=>{toggle().props.onClick();});
  assert.equal(live,1);
  assert.match(textOf(view.root),/面板内容/);

  await act(async()=>{toggle().props.onClick();});
  assert.equal(live,1,'收起只隐藏，不卸载');
  await act(async()=>{toggle().props.onClick();});
  assert.equal(live,1,'重新展开不应重新挂载，否则作答草稿会丢');
});

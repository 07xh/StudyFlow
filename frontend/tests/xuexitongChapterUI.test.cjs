const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

test("third platform chapter UI reuses read-only IPC, filters and avoids redundant reads",async()=>{
  let chapterCalls=0,taskCalls=0;
  const request=async message=>{
    if(message.operation==="xuexitong.chapters.list"){
      chapterCalls++;
      return [
        {id:"42",title:"第一节 电路基础",completed:false,locked:false},
        {id:"43",title:"第二节 交流电",completed:true,locked:false}
      ];
    }
    if(message.operation==="xuexitong.chapter.tasks"){
      assert.equal(message.chapter_id,"42");
      taskCalls++;
      return [
        {id:"video:1",type:"video",chapter_id:"42",title:"讲解视频",completed:false},
        {id:"document:2",type:"document",chapter_id:"42",title:"实验讲义",completed:true}
      ];
    }
    throw new Error("Unexpected mock request: "+message.operation);
  };
  const {XuexitongCourseDetailPanel}=load("components/XuexitongPanels.tsx",{
    "../bridge":{request,friendlyBridgeError:()=> "读取失败"}
  });
  const course={
    platform:"xuexitong",course_id:"9:8:7",title:"电路基础",progress_percent:null
  };
  let view;
  try{
    await act(async()=>{
      view=create(React.createElement(XuexitongCourseDetailPanel,{course,desktop:true}));
    });
    assert.equal(chapterCalls,1);
    const button=label=>view.root.findAllByType("button").find(node=>
      node.props["aria-label"]?.includes(label)
    );
    assert.ok(button("查看任务点"));
    await act(async()=>{button("查看任务点").props.onClick();});
    assert.equal(taskCalls,1);
    assert.equal(view.root.findAllByProps({className:"sf-xxt-task-item"}).length,2);
    const typeSelect=view.root.findAllByType("select").find(node=>
      node.findAllByType("option").some(option=>option.props.value==="video")
    );
    assert.ok(typeSelect);
    await act(async()=>{typeSelect.props.onChange({target:{value:"document"}});});
    assert.equal(view.root.findAllByProps({className:"sf-xxt-task-item"}).length,1);
    await act(async()=>{button("收起任务点").props.onClick();});
    await act(async()=>{button("查看任务点").props.onClick();});
    assert.equal(taskCalls,1,"reopening a chapter should reuse recent server metadata");
    const refresh=view.root.findAllByType("button").find(node=>
      node.props.children==="刷新章节"
    );
    await act(async()=>{refresh.props.onClick();});
    assert.equal(chapterCalls,2);
    await act(async()=>{button("查看任务点").props.onClick();});
    assert.equal(taskCalls,2,"explicit refresh invalidates previous task metadata");
  }finally{
    if(view)await act(async()=>{view.unmount();});
  }
});

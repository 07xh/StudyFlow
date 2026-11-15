const test=require("node:test");
const assert=require("node:assert/strict");
const load=require("./helpers/load.cjs");

const {
  chapterOverview,filterXuexitongChapters,filterXuexitongTasks
}=load("xuexitongCatalog.ts");

const chapters=[
  {id:"11",title:"第一章 电路基础",locked:false,completed:false},
  {id:"12",title:"第二章 电阻",locked:false,completed:true},
  {id:"13",title:"第三章 安全要求",locked:true,completed:false},
  {id:"14",title:"第四章 特殊章节",locked:true,completed:true}
];
const tasks=[
  {id:"video:11",chapter_id:"11",type:"video",title:"课程视频",completed:false},
  {id:"document:12",chapter_id:"11",type:"document",title:"公式讲义",completed:true},
  {id:"workid:13",chapter_id:"11",type:"workid",title:"章节测验",completed:false},
  {id:"audio:14",chapter_id:"11",type:"audio",title:"课堂音频",completed:true},
];

test("chapter counts keep locked items distinct from completed markers",()=>{
  assert.deepEqual(chapterOverview(chapters),{
    total:4,locked:2,completed:1,pending:1
  });
  assert.deepEqual(chapterOverview([]),{
    total:0,locked:0,completed:0,pending:0
  });
});

test("chapter search supports title and ID without changing server status",()=>{
  assert.deepEqual(
    filterXuexitongChapters(chapters,"电路","all").map(c=>c.id),["11"]
  );
  assert.deepEqual(
    filterXuexitongChapters(chapters,"12","completed").map(c=>c.id),["12"]
  );
  assert.deepEqual(
    filterXuexitongChapters(chapters,"","locked").map(c=>c.id),["13","14"]
  );
  assert.deepEqual(
    filterXuexitongChapters(chapters,"","pending").map(c=>c.id),["11"]
  );
  assert.equal(chapters.length,4,"pure filter must not mutate source");
});

test("tasks filter by independent type and server-marked status",()=>{
  assert.deepEqual(
    filterXuexitongTasks(tasks,"","video","all").map(t=>t.id),["video:11"]
  );
  assert.deepEqual(
    filterXuexitongTasks(tasks,"讲义","all","completed").map(t=>t.id),
    ["document:12"]
  );
  assert.deepEqual(
    filterXuexitongTasks(tasks,"","all","pending").map(t=>t.id),
    ["video:11","workid:13"]
  );
  assert.deepEqual(filterXuexitongTasks(tasks,"","other","all"),[]);
});

test("empty data produces no simulated progress or placeholder tasks",()=>{
  assert.deepEqual(filterXuexitongTasks([],"","all","all"),[]);
  assert.deepEqual(filterXuexitongChapters([],"","all"),[]);
});

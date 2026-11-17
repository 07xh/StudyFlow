const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{act,create}=require('react-test-renderer');

function fixture(){
  const saved={window:global.window,document:global.document,HTMLElement:global.HTMLElement};
  const frames=new Map();let serial=0;
  class Element{
    isConnected=true;
    children=[];
    focus(){global.document.activeElement=this;}
    contains(node){return node===this||this.children.includes(node);}
    querySelectorAll(){return this.children;}
    getClientRects(){return [1];}
  }
  const opener=new Element();
  global.HTMLElement=Element;
  global.document={activeElement:opener,body:{style:{overflow:'auto'}}};
  global.window={
    requestAnimationFrame(fn){const id=++serial;frames.set(id,fn);return id;},
    cancelAnimationFrame(id){frames.delete(id);}
  };
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/ui/useModalInteraction.ts'),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
  }).outputText;
  const mod={exports:{}};
  new Function('module','exports','require',code)(mod,mod.exports,require);
  const refs=()=>{
    const first=new Element(),last=new Element(),panel=new Element();
    panel.children=[first,last];
    return {panel:{current:panel},initialFocus:{current:first},first,last};
  };
  const handlers={};
  function Host({id,controls,open=true,busy=false,onClose=()=>{}}){
    handlers[id]=mod.exports.useModalInteraction({open,...controls,busy,onClose});
    return null;
  }
  function key(id,name,shiftKey=false){
    const event={key:name,shiftKey,prevented:false,stopped:false,
      preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
    handlers[id](event);return event;
  }
  return {Host,refs,key,opener,flush(){for(const fn of frames.values())fn();frames.clear();},
    restore(){for(const name of Object.keys(saved)){
      if(saved[name]===undefined)delete global[name];else global[name]=saved[name];
    }}};
}

test('nested dialogs restore child focus to parent and keep scrolling locked until the final close',()=>{
  const f=fixture(),outer=f.refs(),inner=f.refs();let a,b;
  try{
    act(()=>{a=create(React.createElement(f.Host,{id:'outer',controls:outer}));});f.flush();
    assert.equal(document.activeElement,outer.first);
    outer.last.focus();
    act(()=>{b=create(React.createElement(f.Host,{id:'inner',controls:inner}));});f.flush();
    assert.equal(document.activeElement,inner.first);
    assert.equal(document.body.style.overflow,'hidden');
    act(()=>b.unmount());b=null;
    assert.equal(document.activeElement,outer.last);
    assert.equal(document.body.style.overflow,'hidden');
    act(()=>a.unmount());a=null;
    assert.equal(document.activeElement,f.opener);
    assert.equal(document.body.style.overflow,'auto');
  }finally{act(()=>{b?.unmount();a?.unmount();});f.restore();}
});

test('only the top dialog handles Escape and busy confirmation cannot dismiss its parent',()=>{
  const f=fixture(),outer=f.refs(),inner=f.refs();let a,b,outerCloses=0,innerCloses=0;
  const props=busy=>({id:'inner',controls:inner,busy,onClose:()=>innerCloses++});
  try{
    act(()=>{a=create(React.createElement(f.Host,{id:'outer',controls:outer,onClose:()=>outerCloses++}));});
    act(()=>{b=create(React.createElement(f.Host,props(true)));});
    assert.equal(f.key('outer','Escape').stopped,false);
    assert.equal(f.key('inner','Escape').stopped,true);
    assert.equal(outerCloses,0);assert.equal(innerCloses,0);
    act(()=>b.update(React.createElement(f.Host,props(false))));
    assert.equal(f.key('inner','Escape').prevented,true);
    assert.equal(innerCloses,1);assert.equal(outerCloses,0);
  }finally{act(()=>{b?.unmount();a?.unmount();});f.restore();}
});

test('Tab and Shift+Tab stay inside the current dialog, including externally moved focus',()=>{
  const f=fixture(),controls=f.refs();let view;
  try{
    act(()=>{view=create(React.createElement(f.Host,{id:'dialog',controls}));});f.flush();
    assert.equal(f.key('dialog','Tab',true).prevented,true);
    assert.equal(document.activeElement,controls.last);
    assert.equal(f.key('dialog','Tab').prevented,true);
    assert.equal(document.activeElement,controls.first);
    f.opener.focus();f.key('dialog','Tab');
    assert.equal(document.activeElement,controls.first);
  }finally{act(()=>view?.unmount());f.restore();}
});

test('closing a background dialog first preserves the remaining scroll lock and cancels pending focus',()=>{
  const f=fixture(),outer=f.refs(),inner=f.refs();let a,b;
  try{
    act(()=>{a=create(React.createElement(f.Host,{id:'outer',controls:outer}));});
    act(()=>{b=create(React.createElement(f.Host,{id:'inner',controls:inner}));});f.flush();
    act(()=>a.unmount());a=null;
    assert.equal(document.body.style.overflow,'hidden');
    assert.equal(document.activeElement,inner.first);
    act(()=>b.unmount());b=null;
    assert.equal(document.body.style.overflow,'auto');
    act(()=>{a=create(React.createElement(f.Host,{id:'outer',controls:outer}));});
    act(()=>a.unmount());a=null;
    f.opener.focus();f.flush();
    assert.equal(document.activeElement,f.opener);
  }finally{act(()=>{b?.unmount();a?.unmount();});f.restore();}
});

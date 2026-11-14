const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'../../src');
module.exports=function loadSource(relative,mocks={}){
 const cache=new Map();
 function load(file){
  const key=path.relative(root,file);
  if(Object.hasOwn(mocks,key))return mocks[key];
  if(cache.has(file))return cache.get(file).exports;
  const mod={exports:{}};cache.set(file,mod);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
  new Function('module','exports','require',code)(mod,mod.exports,name=>{
   if(Object.hasOwn(mocks,name))return mocks[name];
   if(name.endsWith('.css'))return {};
   if(!name.startsWith('.'))return require(name);
   const base=path.resolve(path.dirname(file),name);
   const found=[base,base+'.ts',base+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
   if(!found)throw Error('Unresolved source '+name);
   return load(found);
  });
  return mod.exports;
 }
 return load(path.resolve(root,relative));
};

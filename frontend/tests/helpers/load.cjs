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
  // In tests, replace Vite's raw eager glob with a local filesystem equivalent.
  // Production still uses import.meta.glob, and raw release notes stay unchanged.
  const source=fs.readFileSync(file,'utf8').replace(/import\.meta\.glob<[^>]+>/g,'__testGlob');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
  function testGlob(pattern,options){
   if(typeof pattern!=='string'||options?.query!=='?raw'||options?.eager!==true||options?.import!=='default')
    throw Error('Unsupported Vite test glob');
   const folder=path.resolve(path.dirname(file),path.dirname(pattern));
   const filename=path.basename(pattern);
   const matcher=new RegExp('^'+filename.replaceAll('.','\\.').replaceAll('*','.*')+'$');
   const keyFolder=path.dirname(pattern).replace(/\\/g,'/');
   return Object.fromEntries(fs.readdirSync(folder).filter(name=>matcher.test(name)).map(name=>[
    path.posix.join(keyFolder,name),fs.readFileSync(path.join(folder,name),'utf8')
   ]));
  }
  new Function('module','exports','require','__testGlob',code)(mod,mod.exports,name=>{
   if(Object.hasOwn(mocks,name))return mocks[name];
   if(name.endsWith('.css'))return {};
   if(!name.startsWith('.'))return require(name);
   const base=path.resolve(path.dirname(file),name);
   const found=[base,base+'.ts',base+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
   if(!found)throw Error('Unresolved source '+name);
   return load(found);
  },testGlob);
  return mod.exports;
 }
 return load(path.resolve(root,relative));
};

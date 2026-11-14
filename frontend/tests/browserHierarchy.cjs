// Empty-account visual smoke. No demo courses or fake platform progress.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../dist'),output=path.resolve(__dirname,'../test-artifacts');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const name=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 const file=name.startsWith(root+path.sep)&&fs.existsSync(name)&&fs.statSync(name).isFile()?name:path.join(root,'index.html');
 res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
 fs.mkdirSync(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});const failures=[];
 try{
  for(const width of [1280,960,720]){
   const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1.25,colorScheme:'light'});
   const page=await context.newPage();page.on('pageerror',error=>failures.push(error.message));
   await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
   const header=await page.locator('.sf-workspace-header').boundingBox(),rail=await page.locator('aside.sf-floating-nav').boundingBox();
   assert.ok(rail.y>=header.y+header.height-1,'Navigation must begin below full-width header');
   assert.equal(await page.getByRole('progressbar').count(),0,'Empty account cannot have percentage progress');
   await page.getByRole('button',{name:'雨课堂',exact:true}).click();
   assert.equal(await page.locator('.sf-platform-login').getByText('读取章节视频',{exact:true}).count(),0);
   assert.equal(await page.getByLabel('课堂 ID',{exact:true}).count(),1);
   assert.equal(await page.locator('.sf-ykt-worker').count(),0,'No invented worker states before launch');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Page cannot overflow horizontally');
   await page.screenshot({path:path.join(output,'yuketang-'+width+'.png'),fullPage:true});
   await page.getByRole('button',{name:'学习任务',exact:true}).click();
   assert.equal(await page.locator('.sf-task-shortcuts,.sf-runtime-task').count(),0);
   await page.getByRole('button',{name:'设置',exact:true}).click();
   await page.getByRole('button',{name:'切换深色主题',exact:true}).click();
   assert.equal(await page.locator('.sf-shell.dark').count(),1);
   await page.screenshot({path:path.join(output,'settings-dark-'+width+'.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await context.close();
  }
  assert.deepEqual(failures,[]);console.log('Hierarchy browser smoke passed: 1280 / 960 / 720px at 125% scale.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

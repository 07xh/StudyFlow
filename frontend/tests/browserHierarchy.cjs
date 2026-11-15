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
   const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1.25,colorScheme:'light',reducedMotion:'reduce'});
   await context.addInitScript(()=>localStorage.setItem('studyflow.appearance.v2','light'));
   const page=await context.newPage();page.on('pageerror',error=>failures.push(error.message));
   await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
   const titlebar=await page.locator('.sf-window-titlebar').boundingBox();
   const header=await page.locator('.sf-workspace-header').boundingBox(),rail=await page.locator('aside.sf-floating-nav').boundingBox();
   assert.ok(titlebar&&header&&rail,'Custom titlebar, fixed status strip and navigation must render');
   assert.ok(header.y>=titlebar.y+titlebar.height-1,'Platform status strip must begin below window controls');
   assert.ok(rail.y>=header.y+header.height-1,'Navigation must begin below full-width header');
   assert.equal(await page.getByRole('button',{name:'设置',exact:true}).count(),1,'Global settings must appear once in the titlebar');
   assert.equal(await page.getByRole('button',{name:'关闭窗口'}).count(),1,'Custom window controls must render');
   assert.equal(await page.getByRole('button',{name:'关闭窗口'}).isDisabled(),true,'Window buttons cannot invoke native commands in browser preview');
   assert.equal(await page.getByRole('progressbar').count(),0,'Empty account cannot have percentage progress');
   assert.equal(await page.getByRole('button',{name:'课程中心',exact:true}).count(),0,'The global course center navigation is removed');
   await page.getByRole('button',{name:'雨课堂',exact:true}).click();
   assert.equal(await page.locator('.sf-platform-courses').count(),1,'The selected platform opens on its course list');
   assert.equal(await page.getByRole('heading',{name:'课程列表',exact:true}).count(),1);
   assert.equal(await page.locator('.sf-filters,.sf-filter').count(),0,'The old global platform filter is removed');
   assert.equal(await page.locator('.sf-platform-card,.sf-platform-login,.sf-fold,.legacy-playback-panel').count(),0,
     'The full platform landing contains only the course library, not account or execution panels');
   const row=page.locator('.sf-platform-toolbar');
   const actionLabels=['账号与连接','参数设置','同步课程列表'];
   const boxes=await Promise.all(actionLabels.map(async label=>page.getByRole('button',{name:label,exact:true}).boundingBox()));
   assert.ok(boxes.every(Boolean),'All platform actions must be visible');
   assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1.5),'Three platform actions must stay in the same row');
   assert.ok(boxes[0].x<boxes[1].x&&boxes[1].x<boxes[2].x,'Action order must be account / settings / sync');
   assert.equal(await page.getByRole('button',{name:'打开课程列表',exact:true}).count(),0);
   assert.equal(await row.evaluate(element=>getComputedStyle(element).flexWrap),'nowrap');
   await page.getByRole('button',{name:'参数设置',exact:true}).click();
   assert.equal(await page.getByRole('dialog',{name:'雨课堂 · 设置'}).count(),1,
     'Platform settings open in a modal rather than replacing the course page');
   assert.equal(await page.locator('.sf-platform-courses').count(),1,
     'Course list stays mounted behind the modal');
   assert.equal(await page.locator('.sf-platform-card').count(),0,
     'Account management should not crowd the playback-parameter category');
   assert.equal(await page.getByText('雨课堂默认参数',{exact:true}).count(),1,
     'Original playback parameters are visible inside the parameter category');
   await page.getByRole('button',{name:'高级管理',exact:true}).click();
   assert.equal(await page.locator('.legacy-playback-panel').count(),0,
     'Advanced platform maintenance cannot mount a duplicate running player');
   assert.equal(await page.getByRole('button',{name:'打开学习任务',exact:true}).count(),1,
     'Task management is linked to the single shared task page');
   assert.equal(await page.getByRole('button',{name:'课堂范围与章节内容，展开'}).count(),1);
   await page.getByRole('button',{name:'关闭设置面板'}).click();
   assert.equal(await page.locator('.sf-platform-settings-view').count(),0);
   assert.equal(await page.locator('.sf-platform-courses').count(),1,'Returning from settings must restore the platform course list');

   const beforeScroll=await page.locator('.sf-workspace-header').boundingBox();
   await page.locator('main').evaluate(element=>{element.scrollTop=element.scrollHeight;});
   const afterScroll=await page.locator('.sf-workspace-header').boundingBox();
   assert.ok(Math.abs(beforeScroll.y-afterScroll.y)<1,'Platform status strip cannot scroll away with content');
   await page.locator('main').evaluate(element=>{element.scrollTop=0;});
   assert.equal(await page.getByRole('button',{name:'保存课堂范围',exact:true}).count(),0,
     'Platform-wide classroom configuration must not occupy the whole course landing');
   await page.mouse.move(0,0);
   await page.screenshot({animations:'disabled',path:path.join(output,'yuketang-overview-'+width+'.png'),fullPage:true});
   await page.getByRole('button',{name:'账号与连接',exact:true}).click();
   assert.equal(await page.getByRole('dialog',{name:'雨课堂 · 设置'}).count(),1);
   assert.equal(await page.locator('.sf-platform-login').getByLabel('Session ID',{exact:true}).count(),1);
   assert.equal(await page.locator('.sf-platform-login').getByLabel('课堂 ID',{exact:true}).count(),0);
   assert.equal(await page.locator('.sf-platform-login').getByText('读取章节视频',{exact:true}).count(),0);
   await page.getByRole('button',{name:'高级管理',exact:true}).click();
   await page.getByRole('button',{name:'课堂范围与章节内容，展开'}).click();
   assert.equal(await page.getByLabel('课堂 ID',{exact:true}).count(),1);
   assert.equal(await page.getByRole('button',{name:'保存课堂范围',exact:true}).count(),1,
     'Classroom scope is available after expanding the platform management section');
   assert.equal(await page.locator('.sf-ykt-worker').count(),0,'No invented worker states before launch');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Page cannot overflow horizontally');
   await page.mouse.move(0,0);
   await page.screenshot({animations:'disabled',path:path.join(output,'yuketang-'+width+'.png'),fullPage:true});
   await page.keyboard.press('Escape');
   assert.equal(await page.getByRole('dialog',{name:'雨课堂 · 设置'}).count(),0,
     'Escape closes the second-level settings dialog');
   await page.getByRole('button',{name:'学习任务',exact:true}).click();
   assert.equal(await page.locator('.sf-task-shortcuts,.sf-runtime-task').count(),0);
   await page.getByRole('button',{name:'设置',exact:true}).click();
   await page.getByRole('button',{name:'切换深色主题',exact:true}).click();
   assert.equal(await page.locator('.sf-shell.dark').count(),1);
   await page.mouse.move(0,0);
   await page.screenshot({animations:'disabled',path:path.join(output,'settings-dark-'+width+'.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await context.close();
  }
  assert.deepEqual(failures,[]);console.log('Hierarchy browser smoke passed: 1280 / 960 / 720px at 125% scale.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

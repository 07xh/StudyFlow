// Real empty-account UI regression: portal styles, fixed navigation and keyboard return.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../dist'),output=path.resolve(__dirname,'../test-artifacts');
const server=http.createServer((req,res)=>{
 const name=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 const file=name.startsWith(root+path.sep)&&fs.existsSync(name)&&fs.statSync(name).isFile()?name:path.join(root,'index.html');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]??'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 fs.mkdirSync(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const errors=[];
 try{
  for(const theme of ['light','dark'])for(const [width,height] of [[1280,900],[960,720],[720,650]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1.25,reducedMotion:'reduce'});
   await context.addInitScript(theme=>{
    localStorage.setItem('studyflow.appearance.v2',theme);
    localStorage.setItem('studyflow.section.expanded.v1.platform:zhidao:progress','true');
    localStorage.setItem('studyflow.section.expanded.v1.platform:zhidao:data','true');
   },theme);
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
   await page.getByRole('button',{name:'知到',exact:true}).click();
   const trigger=page.getByRole('button',{name:'平台设置',exact:true});await trigger.click();
   await page.getByRole('button',{name:'高级管理',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'知到 · 设置'});
   assert.equal(await dialog.locator('.sf-zd-progress-grid').evaluate(e=>getComputedStyle(e).display),'grid','Progress layout must survive the portal');
   assert.equal(await dialog.locator('.sf-zd-progress-auto').evaluate(e=>getComputedStyle(e).display),'flex','Auto verification label and switch must occupy a row');
   assert.equal(await dialog.locator('.sf-fold').first().evaluate(e=>getComputedStyle(e).borderTopStyle),'solid','Fold groups must retain their card border');
   assert.equal(await dialog.locator('select').evaluate(e=>getComputedStyle(e).minHeight),'38px','Course selector uses shared control sizing');
   assert.equal(await dialog.locator('select').isDisabled(),true);
   assert.equal(await dialog.getByRole('switch').isDisabled(),true);
   assert.equal(await dialog.getByRole('progressbar').count(),0,'No progress may be invented for an empty account');
   const navigation=dialog.getByRole('navigation',{name:'平台设置分类'});
   const before=await navigation.boundingBox();
   await dialog.locator('.sf-settings-modal-body').evaluate(e=>{e.scrollTop=e.scrollHeight;});
   const after=await navigation.boundingBox();
   assert.ok(Math.abs(before.y-after.y)<1,'Settings categories stay visible while scrolling');
   await page.getByRole('button',{name:'账号与连接',exact:true}).last().click();
   assert.equal(await dialog.locator('.sf-settings-modal-body').evaluate(e=>e.scrollTop),0,'Switching category resets only its content scroll');
   await page.getByRole('button',{name:'高级管理',exact:true}).click();
   assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false,'Dialog cannot overflow horizontally');
   assert.equal(await dialog.locator('.sf-settings-modal-body').evaluate(e=>e.scrollWidth>e.clientWidth),false,'Long settings content must fit');
   const box=await dialog.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=height+1,'Dialog stays inside the window');
   await page.screenshot({path:path.join(output,'settings-'+theme+'-'+width+'.png')});
   await page.keyboard.press('Escape');
   assert.equal(await dialog.count(),0);await trigger.waitFor();assert.equal(await trigger.evaluate(e=>e===document.activeElement),true,'Escape restores focus to the opener');
   const settingsButton=page.getByRole('button',{name:'应用设置',exact:true});
   await settingsButton.click();
   const global=page.getByRole('dialog',{name:'设置',exact:true});
   await global.waitFor({state:'visible'});
   assert.equal(await global.count(),1,'Global settings must float above the workspace');
   assert.equal(await page.locator('.sf-platform-courses').count(),1,'The underlying workspace stays mounted');
   const globalRect=await global.boundingBox();
   assert.ok(globalRect.x>=0&&globalRect.y>=0&&globalRect.x+globalRect.width<=width+1&&globalRect.y+globalRect.height<=height+1,'Floating settings fits');
   assert.equal(await global.getByRole('navigation',{name:'设置分类'}).count(),1);
   await global.getByRole('button',{name:'版本与更新'}).click();
   assert.equal(await global.getByRole('heading',{name:'版本与更新'}).count(),1);
   await global.getByRole('button',{name:'关于与开源'}).click();
   assert.equal(await global.getByRole('heading',{name:'关于与开源',exact:true}).count(),1);
   await global.getByRole('button',{name:'通用设置'}).click();
   assert.equal(await global.getByRole('group',{name:'主题模式'}).count(),1);
   assert.equal(await global.evaluate(e=>e.scrollWidth>e.clientWidth),false,'Global settings must fit horizontally');
   await page.screenshot({path:path.join(output,'settings-global-'+theme+'-'+width+'.png')});
   await page.keyboard.press('Escape');
   await global.waitFor({state:'detached'});
   assert.equal(await settingsButton.evaluate(e=>e===document.activeElement),true,'Settings restores focus to the opener');
   assert.equal(await page.locator('.sf-platform-courses').count(),1,'Closing settings preserves platform content');
   await context.close();
  }
  assert.deepEqual(errors,[]);console.log('Settings browser regression passed: light/dark at 1280, 960 and 720px (125% scale).');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

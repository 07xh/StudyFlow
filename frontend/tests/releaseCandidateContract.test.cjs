const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const repo=p=>fs.readFileSync(path.join(__dirname,"../..",p),"utf8");
test("release rc.28 metadata, installer, bundled notes and publisher are aligned",()=>{
 const version="0.1.1-rc.28";
 for(const file of ["src-tauri/tauri.conf.json","src-tauri/Cargo.toml","package.json","frontend/package.json"]){
   assert.ok(repo(file).includes(version),file);
 }
 const lock=JSON.parse(repo("frontend/package-lock.json"));
 assert.equal(lock.version,version);
 assert.equal(lock.packages[""].version,version);
 assert.ok(repo("pyproject.toml").includes('version = "0.1.1rc28"'));
 const workflow=repo(".github/workflows/build-windows.yml");
 assert.ok(workflow.includes("Publish verified "+version+" pre-release"));
 assert.ok(workflow.includes("gh release create v"+version));
 assert.ok(workflow.includes("docs/RELEASE_CANDIDATE_0.1.1_RC28.md"));
 assert.ok(repo("docs/RELEASE_CANDIDATE_0.1.1_RC28.md").includes("搜索"));
});

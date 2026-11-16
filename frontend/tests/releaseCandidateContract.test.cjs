const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const repo=p=>fs.readFileSync(path.join(__dirname,"../..",p),"utf8");

test("candidate metadata, installer, bundled notes and publisher are aligned",()=>{
  const version=JSON.parse(repo("src-tauri/tauri.conf.json")).version;
  assert.match(version,/^\d+\.\d+\.\d+-rc\.\d+$/);
  for(const file of ["src-tauri/Cargo.toml","package.json","frontend/package.json"]){
    assert.ok(repo(file).includes(version),file);
  }
  const lock=JSON.parse(repo("frontend/package-lock.json"));
  assert.equal(lock.version,version);
  assert.equal(lock.packages[""].version,version);
  assert.ok(repo("pyproject.toml").includes('version = "'+version.replace("-rc.","rc")+'"'));
  const workflow=repo(".github/workflows/build-windows.yml");
  assert.ok(workflow.includes("Publish verified candidate pre-release"));
  assert.ok(workflow.includes('gh release create "$tag"'));
  assert.ok(workflow.includes('current_main=$(git ls-remote origin refs/heads/main'));
  assert.ok(workflow.includes('if gh release view "$tag" --repo'));
  const notesFile="docs/RELEASE_CANDIDATE_"+version.replace("-rc.","_RC")+".md";
  assert.ok(repo(notesFile).includes(version),"Release notes must correspond to installed version");
  assert.ok(workflow.includes("RELEASE_CANDIDATE_${version/-rc./_RC}.md"),"Publisher must use version-specific notes");
});

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("release version is aligned across desktop, frontend, npm, and Python",()=>{
  const version=JSON.parse(read("src-tauri/tauri.conf.json")).version;
  assert.match(version,/^\d+\.\d+\.\d+-rc\.\d+$/);
  assert.equal(JSON.parse(read("frontend/package.json")).version,version);
  assert.equal(JSON.parse(read("package.json")).version,version);
  const lock=JSON.parse(read("frontend/package-lock.json"));
  assert.equal(lock.version,version);
  assert.equal(lock.packages[""].version,version);
  assert.ok(read("src-tauri/Cargo.toml").includes('version = "'+version+'"'));
  const pythonVersion=version.replace("-rc.","rc");
  assert.ok(read("pyproject.toml").includes('version = "'+pythonVersion+'"'));
  assert.ok(read("src/studyflow/__init__.py").includes('__version__ = "'+pythonVersion+'"'));
  const notePath="docs/RELEASE_CANDIDATE_"+version.replace("-rc.","_RC")+".md";
  assert.match(read(notePath),new RegExp(version.replaceAll(".","\\.")));
});

test("release publisher derives tag and release notes from version without overwriting another build",()=>{
  const workflow=read(".github/workflows/build-windows.yml");
  assert.match(workflow,/tag="v\$\{version\}"/);
  assert.match(workflow,/notes_file="docs\/RELEASE_CANDIDATE_\$\{version\/-rc\.\/_RC\}\.md"/);
  assert.match(workflow,/\[ "\$current_main" != "\$GITHUB_SHA" \]/);
  assert.match(workflow,/Release \$tag already exists/);
  assert.match(workflow,/--notes-file "\$notes_file"/);
});

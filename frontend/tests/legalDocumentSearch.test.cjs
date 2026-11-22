const test=require("node:test");
const assert=require("node:assert/strict");
const load=require("./helpers/load.cjs");
const {findLegalMatches,LEGAL_SEARCH_MAX_HIGHLIGHTS}=load("ui/legalDocumentSearch.ts");

test("literal document search finds Chinese and case-insensitive text without changing source",()=>{
 const source="GPL-3.0 和中文许可 GPL-3.0 / gpl-3.0.";
 const before=source.slice();
 const result=findLegalMatches(source,"  GpL-3.0 ");
 assert.equal(result.total,3);
 assert.deepEqual(result.positions.map(hit=>source.slice(hit.start,hit.end)),
   ["GPL-3.0","GPL-3.0","gpl-3.0"]);
 assert.equal(source,before);
 assert.equal(findLegalMatches(source,"中文").total,1);
 assert.equal(findLegalMatches(source,"   ").total,0);
});

test("regex metacharacters are treated as plain license text",()=>{
 const source="v(3).0 GPL+ (v3) [section] GPL+";
 assert.equal(findLegalMatches(source,"GPL+").total,2);
 assert.equal(findLegalMatches(source,"(v3)").total,1);
 assert.equal(findLegalMatches(source,"[section]").total,1);
 assert.equal(findLegalMatches(source,".").total,1);
});

test("common words remain bounded for huge legal files while preserving total",()=>{
 const source="a ".repeat(1500);
 const result=findLegalMatches(source,"a");
 assert.equal(result.total,1500);
 assert.equal(result.positions.length,LEGAL_SEARCH_MAX_HIGHLIGHTS);
 assert.equal(result.positions[0].start,0);
 assert.equal(result.positions.at(-1).end,2*LEGAL_SEARCH_MAX_HIGHLIGHTS-1);
 const tiny=findLegalMatches(source,"a",3);
 assert.equal(tiny.total,1500);
 assert.equal(tiny.positions.length,3);
 assert.deepEqual(findLegalMatches("","anything"),{total:0,positions:[]});
});

/** Literal, case-insensitive search for local legal/source documents.
 * The content remains unchanged: match spans are display-only and bounded to
 * avoid thousands of React nodes when a very short query is entered.
 */
export type LegalMatch={start:number;end:number};
export type LegalSearchResult={positions:LegalMatch[];total:number};
export const LEGAL_SEARCH_MAX_HIGHLIGHTS=250;

export function findLegalMatches(
  text:string,query:string,maxHighlights=LEGAL_SEARCH_MAX_HIGHLIGHTS
):LegalSearchResult{
  if(!text||typeof query!=="string")return {positions:[],total:0};
  const needle=query.trim().slice(0,80);
  if(!needle)return {positions:[],total:0};
  // Treat regex metacharacters literally: users search license text, not patterns.
  const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const matcher=new RegExp(escaped,"giu");
  const positions:LegalMatch[]=[];
  let total=0;
  for(const match of text.matchAll(matcher)){
    if(match.index===undefined||!match[0].length)continue;
    if(positions.length<Math.max(0,maxHighlights)){
      positions.push({start:match.index,end:match.index+match[0].length});
    }
    total++;
  }
  return {positions,total};
}

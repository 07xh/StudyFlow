/* JSONL/native status replies are plain data objects; retain the previous
   reference when their displayed contents are unchanged. This prevents
   expensive React list reconciliation on idle background polls. */
const NONE:ReadonlySet<string>=new Set();
export function sameStatusSnapshot(
  previous:unknown,next:unknown,ignored:ReadonlySet<string>=NONE
):boolean{
  if(Object.is(previous,next))return true;
  if(!previous||!next||typeof previous!=="object"||typeof next!=="object")return false;
  if(Array.isArray(previous)||Array.isArray(next)){
    if(!Array.isArray(previous)||!Array.isArray(next)||previous.length!==next.length)return false;
    return previous.every((value,index)=>sameStatusSnapshot(value,next[index],ignored));
  }
  const left=previous as Record<string,unknown>;
  const right=next as Record<string,unknown>;
  const keys=Object.keys(left).filter(key=>!ignored.has(key));
  if(keys.length!==Object.keys(right).filter(key=>!ignored.has(key)).length)return false;
  return keys.every(key=>Object.prototype.hasOwnProperty.call(right,key)&&
    sameStatusSnapshot(left[key],right[key],ignored));
}

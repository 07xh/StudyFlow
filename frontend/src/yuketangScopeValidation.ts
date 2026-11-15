import type {Config} from "./bridge";

/** Validate only public classroom identifiers. Never include session tokens in errors. */
export function yuketangScopeIssues(config:Pick<Config,"classroom_id"|"university_id">):string[]{
  const fields=[
    {value:config.classroom_id,label:"课堂 ID"},
    {value:config.university_id,label:"学校 ID"}
  ];
  return fields.flatMap(({value,label})=>{
    const trimmed=value.trim();
    if(!trimmed)return ["未填写"+label];
    if(!/^\d{1,24}$/.test(trimmed))return [label+"应为 1–24 位数字"];
    return [];
  });
}

// Local UI invalidation only. Never include token IDs or secret values in events.
export const QUESTION_BANK_CONFIG_CHANGED="studyflow:question-bank-config-changed";

export function announceQuestionBankConfigChanged():void{
  if(typeof window==="undefined"||typeof window.dispatchEvent!=="function")return;
  window.dispatchEvent(new Event(QUESTION_BANK_CONFIG_CHANGED));
}

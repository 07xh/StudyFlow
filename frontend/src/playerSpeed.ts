/** Keyboard-editable speed drafts stay strings until save; never coerce mid-typing. */
export const SPEED_PRESETS=Object.freeze(['0.5','0.75','1','1.25','1.5','2','2.5','3','4']);

/** Convert a complete draft to a canonical string accepted by the bridge.
 * Empty input, intermediate dots and out-of-range values remain unsaved.
 * Accept "1." and ".75" when committing; preserve them as typed until then.
 */
export function normalizePlayerSpeedInput(raw:string):string|null {
  const value=raw.trim();
  if(!/^(?:[0-4](?:\.[0-9]{0,2})?|\.[0-9]{1,2})$/.test(value))return null;
  const speed=Number(value);
  if(!Number.isFinite(speed)||speed<0.5||speed>4)return null;
  return String(speed);
}

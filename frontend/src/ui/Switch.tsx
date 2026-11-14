import type {ChangeEvent,InputHTMLAttributes} from "react";
/** Native-input accessible switch adapted from LightC-UI 2.18.3's Switch. */
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,"type"|"onChange">&{
  onChange?:(checked:boolean,event:ChangeEvent<HTMLInputElement>)=>void
};
export function Switch({className="",onChange,...props}:Props){
  return <span className={"sf-switch "+className}>
    <input {...props} type="checkbox" role="switch" aria-checked={Boolean(props.checked)}
      onChange={event=>onChange?.(event.currentTarget.checked,event)}/>
    <span aria-hidden="true" className="sf-switch-thumb"/>
  </span>;
}

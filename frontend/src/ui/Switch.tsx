import type {ChangeEvent,InputHTMLAttributes} from "react";

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,"type"|"onChange">&{
  onChange?:(checked:boolean,event:ChangeEvent<HTMLInputElement>)=>void
};

/** StudyFlow switch built on the native checkbox control. */
export function Switch({className="",onChange,...inputProps}:Props){
  const classes=["sf-switch",className].filter(Boolean).join(" ");
  return <span className={classes}>
    <input {...inputProps} type="checkbox" role="switch"
      onChange={event=>onChange?.(event.currentTarget.checked,event)}/>
    <span aria-hidden="true" className="sf-switch-thumb"/>
  </span>;
}

export type AutoConnection={providerId:string;state:string;requestedDates:string[];consentedAt?:string;connected?:boolean};
export const primaryServices=['korail','tmoneyTransit','kobus','hipass'];
const active=['queued','opening','login','collecting'];
export function collectionPlan(connections:AutoConnection[],dates:string[]){
 const key=[...new Set(dates)].sort().join(',');
 const stop:string[]=[],start:string[]=[];
 for(const connection of connections){
  if(!primaryServices.includes(connection.providerId)||!connection.consentedAt)continue;
  const same=[...connection.requestedDates].sort().join(',')===key;
  if(active.includes(connection.state)){if(!same){if(key&&!connection.connected&&['queued','opening','login'].includes(connection.state))start.push(connection.providerId);else stop.push(connection.providerId);}continue;}
  if(key&&connection.connected!==false&&(!same||connection.state==='stopped'))start.push(connection.providerId);
 }
 return {start,stop};
}

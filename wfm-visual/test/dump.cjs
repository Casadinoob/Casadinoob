const path=require("path");const {chromium}=require("playwright");
(async()=>{const {generate}=await import("../scripts/sample-data.mjs");const base=generate({days:6});
const ALL=["interval","skill","team","level","agent","avatarUrl","forecastVolume","actualVolume","forecastAht","actualAht","requiredFte","scheduledFte","serviceLevel","adherence"];
const mk=(roles,rows)=>({columns:roles.map((r,i)=>({displayName:r,index:i,roles:{[r]:true}})),rows:rows.map(r=>roles.map(k=>r[k]))});
const R=base.map(r=>({interval:new Date(r.t),skill:r.skill,team:r.team,level:r.level,agent:r.agent,avatarUrl:r.avatar,forecastVolume:r.fv,actualVolume:r.av,forecastAht:r.fa,actualAht:r.aa,requiredFte:r.rf,scheduledFte:r.sf,serviceLevel:r.sl,adherence:r.ad}));
const x=R.map(r=>({...r}));x.forEach((r,i)=>{if(i%50===0)r.forecastVolume=-5;if(i%40===0&&r.serviceLevel!==null)r.serviceLevel=540;if(i%70===0)r.interval=null;if(i%60===0&&r.actualAht)r.actualAht=0;if(r.agent&&i%30===0)r.requiredFte=2;});
const sets={D:mk(ALL,x.concat(x.slice(0,25))),E:mk(["interval","forecastVolume","actualVolume","requiredFte","scheduledFte"],R.filter(r=>!r.agent))};
const drop=path.resolve(".tmp/drop");const b=await chromium.launch();
for(const [n,table] of Object.entries(sets)){const pg=await b.newPage({viewport:{width:1100,height:760}});
await pg.setContent(`<html><head><style>html,body{margin:0;height:100%}#v{position:absolute;inset:0}</style></head><body><div id="v"></div></body></html>`);
await pg.addStyleTag({path:path.join(drop,"visual.css")});await pg.evaluate(()=>{window.powerbi={visuals:{plugins:{}}}});await pg.addScriptTag({path:path.join(drop,"visual.js")});
await pg.evaluate(({table})=>{const p=Object.values(window.powerbi.visuals.plugins)[0];const sel={getSelectionIds(){return[]},select(){},clear(){}};
const host={createSelectionManager:()=>sel,createSelectionIdBuilder:()=>({withTable(){return this},createSelectionId(){return{}}}),tooltipService:{show(){},hide(){}},persistProperties(){},fetchMoreData(){return true},eventService:{renderingStarted(){},renderingFinished(){},renderingFailed(){}},colorPalette:{},hostCapabilities:{},locale:"en-US"};
window.v=p.create({element:document.getElementById("v"),host});window.v.update({dataViews:[{table,metadata:{columns:[],objects:undefined}}],viewport:{width:1100,height:760},type:2,viewMode:1,operationKind:0});},{table});
await pg.click(".hb > button");await pg.waitForTimeout(150);
console.log(n,await pg.evaluate(()=>[...document.querySelectorAll("ul.iss li")].map(l=>l.innerText.replace(/\n/g," | "))));
await pg.screenshot({path:process.argv[2]+"/"+n+"-open.png"});await pg.close();}
await b.close();})();

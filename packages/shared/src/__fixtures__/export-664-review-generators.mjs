// Historical #652 independent review matrices, retained verbatim.
export function round7(){
const schemes=['javascript:alert(1)','JaVaScRiPt:alert(1)','vbscript:msgbox(1)','data:text/html,x','data :x','java\tscript:alert(1)','java\nscript:alert(1)','jav&#x61;script:alert(1)','&#106;avascript:alert(1)','java&Tab;script&colon;alert(1)','d&#97;ta:image/png;base64,AAAA','data:image/png;base64,AAAA','tel:+123','mailto:x@y.test'];
const payloads=[];
for(const scheme of schemes){for(const attr of ['href','src','xlink:href'])for(const q of ['"',"'",''])payloads.push(`<a ${attr}=${q}${scheme}${q}>LABEL</a>`);payloads.push(`[LABEL](${scheme})`,`![LABEL](${scheme})`,`[LABEL][r]\n\n[r]: ${scheme}`,`![LABEL][r]\n\n[r]: <${scheme}>`,`<${scheme}>`);}
for(const tag of ['script','ScRiPt','style','StYlE','iframe','object','embed'])for(const ws of ['',' ','\t','\n','\r','\f'])payloads.push(`<${ws}${tag}\n >BODY</${tag}>`);
for(const tag of ['img','svg','div','a','textarea'])for(const name of ['onload','OnErRoR','onclick','onfocus'])for(const ws of ['',' ','\t','\n','\r','\f'])for(const q of ['"',"'",''])payloads.push(`<${tag}/${name}${ws}=${q}alert(1)${q}>BODY</${tag}>`);
for(const tag of ['img','svg','div'])payloads.push(`<${tag} onerror>`,`<${tag} title="x>y"\n onload = "run()">`);
const prefixes=['','`<i title="`\n\n','~~~\n<i title="\n~~~\n\n',"~~~\n<i title='\n~~~\n\n",'<!-- <i title=" -->\n','<!-- <i title=\' -->\n','<textarea><i title="</textarea>\n\n','<div title="x>y">safe</div>\n\n'];
const wraps=[x=>x,x=>`> <div>\n> ~~~\n${x}`,x=>x.split('\n').map(l=>'> '+l).join('\n'),x=>x.split('\n').map((l,i)=>(i?'  > ':'- > ')+l).join('\n'),x=>`<Note>\n${x}\n</Note>`,x=>`> > <div>\n> > ~~~\n${x}`,x=>`- <div>\n  ~~~\n${x}`];
let state=0x652633;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
const sources=new Set();for(const p of payloads)for(const prefix of prefixes)sources.add(prefix+p);
while(sources.size<16384)sources.add(wraps[next()%wraps.length](prefixes[next()%prefixes.length]+payloads[next()%payloads.length])+`\n\nEND_${sources.size}`);

return sources;
}

export function round12(){
const explicit=['<embed>\n> <!--\n> <img onerror=OWN()>','> <script>\n</script>','12. <script>x</script>\n    FOLLOW\n    <!--\n<img onerror=OWN()>'];
const tags=['script','style','iframe','object','embed','ScRiPt'];
const prefixes=['','> ','- ','12. ','> - ','- > ','> > ','  ','\t'];
const contexts=['','<!--\n','<textarea>','<title>','<xmp>','<noembed>','<noframes>','<noscript>','<plaintext>','<![CDATA[','<?pi ','<!DOCTYPE a [','<svg><foreignObject>','<math><mtext>','<template>'];
const tails=['\n<img src=x onerror=OWN()><a href="javascript:OWN()">LINK</a>','\n\n~~~\nCODE\n~~~','\n</textarea>\n    CODE\n<img onerror=OWN()>','\n-->\n\nOUTSIDE','\n\n> <!--\n<img onerror=OWN()>','\n\n```\n<script>CODE</script>\n```','\n    FOLLOW\n    <!--\n<img onerror=OWN()>','\n</script>\n\n# AFTER'];
let seed=0x15c652; const rnd=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%n};
const cases=[...explicit];
for(let i=0;i<22000;i++){
 const tag=tags[rnd(tags.length)],p=prefixes[rnd(prefixes.length)], ctx=contexts[rnd(contexts.length)];
 const close=rnd(3)?`</${tag}>`:'';
 let s=`${p}<${tag}${rnd(3)?'':' data-x="a>b"'}>BODY${close}\n${p}${ctx}KEPT${tails[rnd(tails.length)]}`;
 if(rnd(3)===0)s='> ~~~\n> PRECODE\n'+s;
 if(rnd(4)===0)s='BEFORE `INLINE`\n\n'+s+'\n\nAFTER *TEXT*';
 if(rnd(5)===0)s='| a | b |\n|---|---|\n| '+s.replaceAll('\n',' ')+' | tail |';
 if(rnd(4)===0)s=s.replaceAll('\n',rnd(2)?'\r\n':'\r');
 cases.push(s);
}
const pieces=['<embed>','<script>','<style>','<iframe>','<object>','</script>','</style>','</iframe>','</object>','</textarea>','</title>','</pre>','<!--','-->','--!>','<textarea>','<title>','<xmp>','<noscript>','<noembed>','<plaintext>','<![CDATA[','<?a','<!DOCTYPE html PUBLIC "','<svg>','<math>','<template>','~~~','```','    CODE','BODY *TEXT* `CODE`','<img onerror=OWN()>','<a href="java&#115;cript:OWN()">LINK</a>','<div title="','<SCRIPT data-x="',''];
for(let i=0;i<12000;i++){let lines=[];for(let j=0,n=3+rnd(10);j<n;j++)lines.push(prefixes[rnd(prefixes.length)]+pieces[rnd(pieces.length)]);cases.push(lines.join('\n'));}

return cases;
}

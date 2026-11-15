export function* compoundShapes(){
 const schemes=['javascript:ATTACK','JaVaScRiPt:ATTACK','vbscript:ATTACK','data:image/png;base64,AAAA','jav&#x61;script:ATTACK','java&Tab;script&colon;ATTACK','&#106;avascript:ATTACK','/safe.png','https://safe.test/a,b.png'];
 const attrs=['srcset','imagesrcset','ping','archive','profile','itemtype','attributionsrc'];
 const prefixes=['','/safe.png 1x, ','/safe.png, ','/safe.png future(a,b), ','/safe.png 1x, /other.png 2x, ','/safe/ping ','/safe\t','/safe,','/safe.png invalid descriptor, '];
 const wraps=[s=>s,s=>'> '+s,s=>'- '+s,s=>'> - '+s,s=>`<noscript>${s}</noscript>`,s=>`<template>${s}</template>`,s=>'`<i title="`\n\n'+s,s=>`| A | B |\n|---|---|\n| ${s} | cell |`,s=>'~~~\n'+s+'\n~~~',s=>'<div title="\n\n'+s];
 for(let i=0;i<8192;i++){
  const scheme=schemes[i%schemes.length],attr=attrs[Math.floor(i/schemes.length)%attrs.length],prefix=prefixes[Math.floor(i/(schemes.length*attrs.length))%prefixes.length];
  const tag=attr==='archive'?(i%2?'applet':'object'):(attr==='srcset'?'img':attr==='imagesrcset'?'link':'a');
  const value=prefix+scheme+(attr.endsWith('srcset')?' 2x':'');
  let source=wraps[Math.floor(i/17)%wraps.length](`<${tag} ${attr}="${value}">LABEL</${tag}>`);
  if(i%3===0)source=source.replaceAll('\n','\r');else if(i%3===1)source=source.replaceAll('\n','\r\n');
  yield source+'\n\nCOMPOUND_'+i;
 }
}

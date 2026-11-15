export function* newShapes() {
  const values=['javascript:ATTACK()','JaVaScRiPt:ATTACK()','vbscript:ATTACK()','data:text/html,ATTACK','data:image/png;base64,AAAA','java\tscript:ATTACK()','java\nscript:ATTACK()','\x01java\x7fscript:ATTACK()','jav&#x61;script:ATTACK()','&#106;avascript:ATTACK()','java&Tab;script&colon;ATTACK()','d&#97;ta&colon;image/png;base64,AAAA','&#x6a;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;ATTACK()','https://example.test/a','/safe.png'];
  const payloads=[];
  for(const value of values){
    for(const attr of ['href','src','xlink:href','action','formaction','data','poster','background','cite','longdesc','usemap','profile','manifest','codebase','classid','archive','ping','srcset','imagesrcset','icon'])
      for(const q of ['"',"'",'']) payloads.push(`<a ${attr}=${q}${value}${q}>LABEL</a>`,`<svg><a ${attr}=${q}${value}${q}>LABEL</a></svg>`);
    payloads.push(`[LABEL](${value})`,`![LABEL](${value})`,`[LABEL](<${value}>)`,`![LABEL](<${value}>)`,`[LABEL][ref]\n\n[ref]: ${value}`,`[ref]: <${value}>\n\n![LABEL][ref]`,`<${value}>`,`[unused]: ${value}`);
  }
  for(const tag of ['img','svg','a','div']) for(const attr of ['onerror','OnLoAd','ONCLICK','on']) for(const ws of ['',' ','\t','\n','\r','\f']) for(const quote of ['"',"'",'']) payloads.push(`<${tag}/${attr}${ws}=${quote}ATTACK()${quote}>BODY</${tag}>`);
  payloads.push('<img onerror>','<img src="x"onerror=ATTACK()>',"<img src='x'onerror=ATTACK()>",'\x3e<img\n>onerror=ATTACK()>','<svg/onload=ATTACK()>','<a href="java\n> script:ATTACK()">LABEL</a>','`<i title="`\n\n<img onerror\f=ATTACK()>','<div title="\n\n<img onerror=ATTACK()>','<div title="\n\n12. <a href=javascript:ATTACK()>LABEL</a>','<a href="java\n- script:ATTACK()">LABEL</a>');
  const contexts=['','`<i title="`\n\n',"`<i title='`\n\n",'<!--\n\n','<textarea>\n\n','<title>','<xmp>','<noembed>','<noscript>','<plaintext>','<?pi\n\n','<!DOCTYPE html PUBLIC "\n\n','<div title="\n\n','<svg><foreignObject>','<math><mtext>','<template>','~~~\nCODE\n~~~\n\n'];
  payloads.push('[X](onerror=ATTACK)','[X](href=javascript:ATTACK)','[X](/safe "onerror=ATTACK")',"[X](/safe \"' onerror=ATTACK '\")");
  const wraps=[s=>s,s=>s.split('\n').map(l=>'> '+l).join('\n'),s=>s.split('\n').map(l=>'> > '+l).join('\n'),s=>s.split('\n').map((l,i)=>(i?'  ':'- ')+l).join('\n'),s=>s.split('\n').map((l,i)=>(i?'    ':'12. ')+l).join('\n'),s=>s.split('\n').map((l,i)=>(i?'  > ':'- > ')+l).join('\n'),s=>s.split('\n').map((l,i)=>(i?'>   ':'> - ')+l).join('\n'),s=>'<Note>\n'+s+'\n</Note>',s=>'<CodeGroup>\n'+s.split('\n').map(l=>'    '+l).join('\n')+'\n</CodeGroup>',s=>'| A | B |\n|---|---|\n| '+s.replaceAll('\n',' ')+' | CELL |',s=>'~~~html\n'+s+'\n~~~',s=>s.split('\n').map(l=>'    '+l).join('\n')];
  const tails=['','\n\nAFTER *TEXT*','\n\n~~~html\n<img onerror=CODE()>\n~~~','\n\tCODE','\n-->\nAFTER','\n</textarea>\nAFTER','\n\n- NEXT\n- LAST'];
  let seed=0x664652;
  const rnd=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%n;};
  // Every payload appears, every container is used deterministically, then
  // seeded context/container/tail interactions fill the 32,768 unique shapes.
  for(let i=0;i<32768;i++){
    let s=wraps[i%wraps.length]((i<payloads.length?'':contexts[rnd(contexts.length)])+payloads[i%payloads.length]+tails[rnd(tails.length)]);
    if(i%7===0)s='BEFORE `INLINE`\n\n'+s;
    if(i%11===0)s=s.replaceAll('\n','\r\n');
    if(i%13===0)s=s.replaceAll('\n','\r');
    yield s+'\n\nSHAPE_'+i;
  }
}

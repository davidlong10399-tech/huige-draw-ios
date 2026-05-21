const fs=require('fs');
for(const f of ['package.json','app.json','eas.json','tsconfig.json']){
 const p='F:/Lenovo/ai-studio-ios/'+f;
 let s=fs.readFileSync(p,'utf8');
 if(s.charCodeAt(0)===0xFEFF) s=s.slice(1);
 JSON.parse(s);
 fs.writeFileSync(p,s,'utf8');
 console.log(f,'ok');
}

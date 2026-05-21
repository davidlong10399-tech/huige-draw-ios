const fs=require('fs');
const p='F:/Lenovo/ai-studio-ios/eas.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.cli = { ...(j.cli||{}), version: '>= 10.0.0', appVersionSource: 'remote' };
j.build = j.build || {};
j.build.preview = { ...(j.build.preview||{}), distribution:'internal', ios:{simulator:false} };
j.build.production = { ...(j.build.production||{}), ios:{simulator:false} };
fs.writeFileSync(p, JSON.stringify(j,null,2),'utf8');
console.log(JSON.stringify(j,null,2));
